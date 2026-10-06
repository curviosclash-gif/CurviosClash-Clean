/* global window */
// One isolated desktop app process for a playtest run: its own run folder, profile and
// redirected OS folders, a pinned free port, error capture for every window and the
// main process, native dialogs routed into the run folder (recorded as interventions),
// on/off-screen switching for watching, and a close that only ever ends its own process
// tree. Several sessions (LAN host and guest, Settings Studio) can share one run folder.
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPlaytestWindow, filterPlaytestErrors, resolvePlaytestOutDir } from './playtest-support.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireRepo = createRequire(path.join(REPO_ROOT, 'package.json'));
const requireElectron = createRequire(path.join(REPO_ROOT, 'electron', 'package.json'));
const { _electron } = requireRepo('@playwright/test');

export const OFFSCREEN_POSITION = -32000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh, unique folder for one run (all roles of a LAN run share it). */
export async function createRunDir(label = 'run', root = resolvePlaytestOutDir()) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
    const id = `${stamp}-${label.replace(/[^\w-]+/g, '_')}-${Math.random().toString(36).slice(2, 7)}`;
    const runDir = path.join(root, 'runs', id);
    await fs.mkdir(runDir, { recursive: true });
    return { id, runDir };
}

/** Asks the OS for a free loopback port, so two sessions never fall back to random ones. */
export function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

const ENTRIES = Object.freeze({
    game: path.join(REPO_ROOT, 'electron', 'main.cjs'),
    'settings-studio': path.join(REPO_ROOT, 'electron', 'settings-studio', 'main.cjs'),
});

/**
 * Starts one app process. `profileDir` lets a second app (Settings Studio) read and write
 * the same profile as the game, so a saved setting can be checked in the game.
 * @param {{ runDir: string, role?: string, entry?: 'game'|'settings-studio', visible?: boolean,
 *   tag?: string, profileDir?: string|null, buildDir?: string }} options
 */
export async function launchSession({
    runDir, role = 'main', entry = 'game', visible = false, tag = 'claude', profileDir = null,
    buildDir = path.join(REPO_ROOT, 'dist-app-test'),
}) {
    if (entry === 'game' && !existsSync(path.join(buildDir, 'index.html'))) {
        throw Object.assign(new Error('dist-app-test is missing: run "npm run build:app:test" first.'), { code: 'PLAYTEST_BUILD_MISSING' });
    }
    const roleDir = path.join(runDir, role);
    const profile = profileDir || path.join(roleDir, 'profile');
    const paths = Object.fromEntries(['downloads', 'videos', 'documents', 'desktop', 'temp', 'home', 'saves', 'shots']
        .map((name) => [name, path.join(roleDir, name)]));
    await Promise.all([profile, ...Object.values(paths)].map((dir) => fs.mkdir(dir, { recursive: true })));
    const boot = path.join(roleDir, 'boot.cjs');
    // Every OS folder the app could write to points into the run folder; the renderer's
    // localStorage lives in the profile and is keyed by the pinned port below.
    await fs.writeFile(boot, [
        "const { app } = require('electron');",
        `app.setPath('appData', ${JSON.stringify(profile)});`,
        ...['downloads', 'videos', 'documents', 'desktop', 'temp', 'home']
            .map((name) => `app.setPath(${JSON.stringify(name)}, ${JSON.stringify(paths[name])});`),
        `require(${JSON.stringify(ENTRIES[entry])});`,
        '',
    ].join('\n'));
    const port = await findFreePort();
    const env = {
        ...process.env,
        PW_RUN_TAG: `playtest-${role}-${Date.now()}`,
        CURVIOS_E2E_RENDERER: '1',
        CURVIOS_AUTOMATION: tag,
        CURVIOS_ELECTRON_SHOW_WINDOW: entry === 'game' ? '1' : '0',
        CURVIOS_DESKTOP_STATIC_PORT: String(port),
        CURVIOS_SETTINGS_STUDIO_PROJECT_ROOT: path.join(roleDir, 'studio-project'),
        TEMP: paths.temp,
        TMP: paths.temp,
    };
    // An inherited user-data root would win over the throwaway profile.
    delete env.CURVIOS_USER_DATA_ROOT;
    delete env.ELECTRON_RUN_AS_NODE;
    if (!visible) env.CURVIOS_ELECTRON_TEST_RENDER = 'inactive';
    await fs.mkdir(env.CURVIOS_SETTINGS_STUDIO_PROJECT_ROOT, { recursive: true });

    const app = await _electron.launch({
        executablePath: requireElectron('electron'),
        cwd: path.join(REPO_ROOT, 'electron'),
        args: [boot],
        env,
        timeout: 90_000,
    });
    const session = {
        role, entry, app, page: null, runDir, roleDir, profile, paths, port, visible, tag,
        pid: app.process()?.pid ?? null, closed: false, errors: [], heldKeys: new Set(), launchedAt: Date.now(),
    };
    app.on('close', () => { session.closed = true; });
    const pushError = (kind, windowKind, text) => {
        session.errors.push({ kind, window: windowKind, text: String(text).slice(0, 500), at: Date.now() });
        if (session.errors.length > 500) session.errors.shift();
    };
    const watchPage = (page) => {
        const kindOf = () => classifyPlaytestWindow(page.url());
        page.on('pageerror', (error) => pushError('pageerror', kindOf(), error?.message || error));
        page.on('console', (message) => { if (message.type() === 'error') pushError('console', kindOf(), message.text()); });
        page.on('crash', () => pushError('crash', kindOf(), 'renderer crashed'));
    };
    app.on('window', watchPage);
    app.process()?.stderr?.on('data', (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
            if (/\b(error|exception|fatal|crash)/i.test(line) && !/DevTools|Autofill/i.test(line)) pushError('main-stderr', 'main-process', line);
        }
    });

    try {
        session.page = await app.firstWindow({ timeout: 90_000 });
        for (const page of app.windows()) watchPage(page);
        await installMainProcessHooks(session);
        await waitForReady(session);
    } catch (error) {
        await closeSession(session);
        throw Object.assign(new Error(`${role} did not become ready: ${error?.message || error}`), { code: 'PLAYTEST_NOT_READY' });
    }
    return session;
}

async function waitForReady(session) {
    if (session.entry === 'settings-studio') {
        await session.page.waitForFunction(() => Boolean(window.settingsStudioApi), null, { timeout: 60_000 });
        return;
    }
    await session.page.waitForFunction(() => Boolean(window.GAME_INSTANCE?.settings), null, { timeout: 90_000 });
    await session.page.waitForSelector('#main-menu[data-shell-ready="true"]', { timeout: 60_000 });
}

/**
 * Main-process hooks: crash and console capture for every window, native dialogs routed
 * into the run folder, shell calls and downloads recorded instead of opening anything,
 * and a captured tuning hotkey so the tuning console can open without OS focus.
 */
async function installMainProcessHooks(session) {
    await session.app.evaluate(({ app, dialog, shell, session: electronSession, globalShortcut }, paths) => {
        const records = globalThis.__playtestMain || (globalThis.__playtestMain = {
            errors: [], interventions: [], openQueue: [], messageBoxResponse: 0, shortcuts: {},
        });
        const note = (entry) => {
            records.interventions.push({ at: Date.now(), ...entry });
            if (records.interventions.length > 300) records.interventions.shift();
        };
        const fail = (entry) => {
            records.errors.push({ at: Date.now(), ...entry });
            if (records.errors.length > 300) records.errors.shift();
        };
        if (records.installed) return;
        records.installed = true;
        app.on('render-process-gone', (_event, contents, details) => fail({ kind: 'render-process-gone', url: contents?.getURL?.(), reason: details?.reason }));
        app.on('child-process-gone', (_event, details) => {
            if (details?.reason !== 'clean-exit') fail({ kind: 'child-process-gone', type: details?.type, reason: details?.reason });
        });
        app.on('web-contents-created', (_event, contents) => {
            contents.on('unresponsive', () => fail({ kind: 'unresponsive', url: contents.getURL() }));
        });
        const pathModule = process.mainModule?.require?.('node:path') || globalThis.require?.('path');
        const target = (dir, wanted, fallback) => {
            const base = String(wanted || fallback).split(/[\\/]/).pop() || fallback;
            return pathModule ? pathModule.join(dir, base) : `${dir}\\${base}`;
        };
        dialog.showSaveDialog = async (...args) => {
            const options = args.find((arg) => arg && typeof arg === 'object' && !arg.webContents) || {};
            const filePath = target(paths.saves, options.defaultPath, 'saved-file');
            note({ type: 'save-dialog', defaultPath: options.defaultPath || null, filePath });
            return { canceled: false, filePath };
        };
        dialog.showSaveDialogSync = (...args) => {
            const options = args.find((arg) => arg && typeof arg === 'object' && !arg.webContents) || {};
            const filePath = target(paths.saves, options.defaultPath, 'saved-file');
            note({ type: 'save-dialog-sync', defaultPath: options.defaultPath || null, filePath });
            return filePath;
        };
        dialog.showOpenDialog = async () => {
            const filePaths = records.openQueue.shift() || [];
            note({ type: 'open-dialog', filePaths });
            return { canceled: filePaths.length === 0, filePaths };
        };
        dialog.showOpenDialogSync = () => {
            const filePaths = records.openQueue.shift() || [];
            note({ type: 'open-dialog-sync', filePaths });
            return filePaths.length ? filePaths : undefined;
        };
        // A synchronous message box would block the main process and every evaluate.
        dialog.showMessageBox = async (...args) => {
            const options = args.find((arg) => arg && typeof arg === 'object' && !arg.webContents) || {};
            note({ type: 'message-box', message: options.message || null, response: records.messageBoxResponse });
            return { response: records.messageBoxResponse, checkboxChecked: false };
        };
        dialog.showMessageBoxSync = (...args) => {
            const options = args.find((arg) => arg && typeof arg === 'object' && !arg.webContents) || {};
            note({ type: 'message-box-sync', message: options.message || null, response: records.messageBoxResponse });
            return records.messageBoxResponse;
        };
        dialog.showErrorBox = (title, content) => { fail({ kind: 'error-box', title, content: String(content).slice(0, 500) }); };
        shell.openPath = async (target) => { note({ type: 'shell-open-path', target }); return ''; };
        shell.openExternal = async (target) => { note({ type: 'shell-open-external', target }); };
        shell.showItemInFolder = (target) => { note({ type: 'shell-show-item', target }); };
        electronSession.defaultSession.on('will-download', (_event, item) => {
            const filePath = target(paths.downloads, item.getFilename(), 'download');
            item.setSavePath(filePath);
            note({ type: 'download', filePath });
        });
        const register = globalShortcut.register.bind(globalShortcut);
        globalShortcut.register = (accelerator, callback) => {
            records.shortcuts[accelerator] = callback;
            return register(accelerator, callback);
        };
    }, session.paths);
}

/** Main-process errors and interventions recorded since launch. */
export async function readMainProcessRecords(session) {
    if (!session || session.closed) return { errors: [], interventions: [] };
    return session.app.evaluate(() => {
        const records = globalThis.__playtestMain || { errors: [], interventions: [] };
        return { errors: records.errors.slice(), interventions: records.interventions.slice() };
    }).catch(() => ({ errors: [], interventions: [] }));
}

/** Files the next native open dialog returns (consumed one call at a time). */
export async function queueOpenDialog(session, filePaths) {
    await session.app.evaluate((_electron, files) => { globalThis.__playtestMain.openQueue.push(files); }, filePaths);
}

/** Button index every message box answers with until changed (default 0). */
export async function setMessageBoxResponse(session, response) {
    await session.app.evaluate((_electron, value) => { globalThis.__playtestMain.messageBoxResponse = value; }, response);
}

/**
 * Fires a focus-scoped global shortcut (e.g. F7 for the tuning console) without giving
 * any window OS focus: the app is told a window gained focus, which registers the
 * accelerator, and the captured callback is called directly. Recorded as intervention.
 */
export async function triggerFocusShortcut(session, accelerator) {
    return session.app.evaluate(({ app }, key) => {
        const records = globalThis.__playtestMain;
        app.emit('browser-window-focus');
        const callback = records.shortcuts[key];
        if (typeof callback === 'function') callback();
        app.emit('browser-window-blur');
        records.interventions.push({ at: Date.now(), type: 'shortcut-without-focus', accelerator: key, fired: typeof callback === 'function' });
        return typeof callback === 'function';
    }, accelerator);
}

/** All windows of this session with their kind, title and whether they are on screen. */
export async function listWindows(session) {
    if (!session || session.closed) return [];
    const windows = await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
        .filter((window) => !window.isDestroyed())
        .map((window) => ({
            id: window.id, title: window.getTitle(), url: window.webContents.getURL(),
            bounds: window.getBounds(), shown: window.isVisible(),
        })));
    return windows.map((entry) => ({
        ...entry,
        kind: classifyPlaytestWindow(entry.url),
        onScreen: entry.shown && entry.bounds.x > -10000 && entry.bounds.y > -10000,
    }));
}

/** The Playwright page of a window kind ('main', 'hangar', 'editor', ...), waiting up to timeoutMs. */
export async function findWindowPage(session, kind = 'main', timeoutMs = 0) {
    const pick = () => {
        if (kind === 'main' && session.entry === 'game') return session.page;
        return session.app.windows().find((page) => !page.isClosed() && classifyPlaytestWindow(page.url()) === kind) || null;
    };
    const end = Date.now() + timeoutMs;
    let page = pick();
    while (!page && Date.now() < end) {
        await sleep(200);
        page = pick();
    }
    return page;
}

/**
 * Moves every window of the session on screen (cascaded on the primary display) or back
 * off screen. Never focuses, hides or maximises: a hidden window drops to ~1 fps and
 * focus would be taken from the person watching.
 */
export async function setWindowsOnScreen(session, onScreen) {
    if (!session || session.closed) return [];
    await session.app.evaluate(({ BrowserWindow, screen }, args) => {
        const area = screen.getPrimaryDisplay().workArea;
        let offset = 0;
        for (const window of BrowserWindow.getAllWindows()) {
            if (window.isDestroyed()) continue;
            if (args.show) {
                if (!window.isVisible()) window.showInactive();
                const bounds = window.getBounds();
                const width = Math.min(bounds.width, area.width - 80);
                const height = Math.min(bounds.height, area.height - 80);
                window.setBounds({ x: area.x + 40 + offset + args.shift, y: area.y + 40 + offset, width, height });
                window.moveTop?.();
                offset += 36;
            } else {
                window.setPosition(args.offscreen, args.offscreen);
            }
        }
    }, { show: Boolean(onScreen), offscreen: OFFSCREEN_POSITION, shift: session.role === 'guest' ? 120 : 0 });
    return listWindows(session);
}

/** Console, page, crash and main-process errors of every window since sinceMs. */
export async function collectErrors(session, sinceMs = 0) {
    const main = await readMainProcessRecords(session);
    const fromMain = main.errors.map((entry) => ({ kind: entry.kind, window: 'main-process', text: JSON.stringify(entry), at: entry.at }));
    return filterPlaytestErrors([...session.errors, ...fromMain], sinceMs);
}

/**
 * Closes the session: releases held keys, answers any closing prompt, asks the app to
 * close and, if it does not, ends exactly its own process tree. Never touches other
 * Electron processes on the machine.
 */
export async function closeSession(session) {
    if (!session?.app) return;
    if (!session.closed && session.page && !session.page.isClosed()) {
        for (const key of session.heldKeys) await session.page.keyboard.up(key).catch(() => {});
        await session.page.mouse.up().catch(() => {});
    }
    session.heldKeys.clear();
    const closed = await Promise.race([
        session.app.close().then(() => true, () => false),
        sleep(15_000).then(() => false),
    ]);
    const pid = session.pid;
    if (!closed && pid) await killProcessTree(pid);
    session.closed = true;
}

function killProcessTree(pid) {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
        } else {
            try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
            resolve();
        }
    });
}
