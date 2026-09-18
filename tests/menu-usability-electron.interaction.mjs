import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { acquirePlaywrightRunLock } from '../scripts/playwright-run-lock.mjs';
let desktopRunLock;
before(async () => { desktopRunLock = await acquirePlaywrightRunLock({ label: 'Leuchtspuren desktop menu and LAN' }); });
after(() => desktopRunLock?.release());
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron, expect } from '@playwright/test';

const requireElectron = createRequire(new URL('../electron/package.json', import.meta.url));

test('desktop menu supports complete navigation, settings and lobby entry at three window sizes', { timeout: 180_000 }, async () => {
    const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'curvios-menu-usability-'));
    const boot = path.join(artifacts, 'boot.cjs');
    // Isolate saves and Electron caches without relying on Windows profile variables.
    await fs.writeFile(boot, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(artifacts)});require(${JSON.stringify(path.resolve('electron/main.cjs'))});`);
    const env = { ...process.env, PW_RUN_TAG: `menu-${Date.now()}`, CURVIOS_ELECTRON_SHOW_WINDOW: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: requireElectron('electron'), args: [boot], env });
    console.log(`Menu screenshots and isolated profile: ${artifacts}`);
    try {
        const page = await app.firstWindow();
        await page.waitForSelector('#main-menu[data-shell-ready="true"]', { timeout: 60_000 });
        const settle = async () => page.evaluate(async () => {
            await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
                .map((animation) => animation.finished.catch(() => {})));
        });
        const capture = async (name) => {
            await settle();
            await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
        };
        const gamepad = async (index) => page.evaluate((buttonIndex) => {
            const original = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
            const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
            Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ buttons }] });
            try {
                const runtime = window.GAME_INSTANCE.uiManager.menuNavigationRuntime;
                runtime._pollGamepadButtons();
                buttons[buttonIndex].pressed = true;
                runtime._pollGamepadButtons();
                buttons[buttonIndex].pressed = false;
                runtime._pollGamepadButtons();
            } finally {
                if (original) Object.defineProperty(navigator, 'getGamepads', original);
                else delete navigator.getGamepads;
            }
        }, index);
        await expect(page.locator('#btn-quick-last-settings')).toContainText('Sofort spielen');
        await expect(page.locator('#quick-last-summary')).toContainText('Schwer');
        await capture('home');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.locator('.menu-trail-cyan').evaluate((element) => getComputedStyle(element).animationName), 'none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        for (const size of [[1280, 720], [1600, 900], [1920, 1080]]) {
            await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), size);
            await expect(page.locator('#btn-quick-last-settings')).toBeInViewport();
            await expect(page.locator('[data-session-type="splitscreen"]')).toBeInViewport();
            await expect(page.locator('.menu-utility-shell [data-level4-section="utilities"]')).toBeInViewport();
            await capture('home-' + size[0]);
        }
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720));

        // Every visible main action must be reachable from the quick start using arrows.
        const reachability = await page.evaluate(() => {
            const runtime = window.GAME_INSTANCE.uiManager.menuNavigationRuntime;
            const actions = runtime._getVisibleMainActions();
            const visited = new Set([actions[0]]);
            const pending = [actions[0]];
            while (pending.length) {
                const action = pending.shift();
                for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
                    action.focus();
                    action.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
                    const next = document.activeElement;
                    if (actions.includes(next) && !visited.has(next)) { visited.add(next); pending.push(next); }
                }
            }
            return { count: actions.length, missing: actions.filter((action) => !visited.has(action)).map((action) => action.textContent.trim()) };
        });
        assert.ok(reachability.count >= 10);
        assert.deepEqual(reachability.missing, []);

        const settingsEntry = page.locator('.menu-utility-shell [data-level4-section="gameplay"]');
        await settingsEntry.click();
        await expect(page.locator('#submenu-level4')).toBeVisible();
        await page.locator('#level4-tab-audio').click();
        await page.locator('#audio-enabled-toggle').uncheck();
        await page.locator('#audio-enabled-toggle').check();
        await expect(page.locator('#submenu-level4')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(settingsEntry).toBeFocused();

        await page.locator('[data-session-type="single"]').click();
        for (const mode of ['arcade', 'fight', 'normal']) {
            await expect(page.locator(`[data-mode-path="${mode}"] .menu-choice-copy`)).toBeVisible();
        }
        await capture('styles');
        await page.locator('[data-mode-path="normal"]').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-mode-path="normal"]')).toBeFocused();
        await page.keyboard.press('Enter');
        await page.locator('.start-step-tab[data-start-section-target="match"]').click();
        await expect(page.locator('#menu-selection-summary')).toContainText('2 Bots · Schwer · 5 Siege');
        await expect(page.locator('#match-field-hint')).not.toContainText('gameMode');
        await page.locator('#btn-open-level4').click();
        await capture('settings-rules');

        for (const [section, control] of [['audio', 'audio-master-volume-slider'], ['graphics', 'graphics-style-select'], ['recording', 'normal-camera-perspective-select'], ['hud', 'hud-scale-slider']]) {
            await page.locator(`#level4-tab-${section}`).click();
            await expect(page.locator(`#${control}`)).toBeVisible();
            assert.equal(await page.locator(`#${control}`).count(), 1);
        }
        await page.locator('#level4-tab-audio').click();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#level4-tab-graphics')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#level4-tab-recording')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('#level4-section-recording')).toHaveAttribute('aria-hidden', 'false');
        await page.locator('#normal-camera-perspective-select').focus();
        await gamepad(15);
        await expect(page.locator('#normal-camera-perspective-select')).toHaveValue('cinematic_soft');
        await page.locator('#level4-tab-audio').click();
        const volume = page.locator('#audio-master-volume-slider');
        await volume.focus();
        const before = Number(await volume.inputValue());
        await page.keyboard.press('ArrowRight');
        await expect(volume).toBeFocused();
        assert.equal(Number(await volume.inputValue()), before + 1);
        await gamepad(15);
        assert.equal(Number(await volume.inputValue()), before + 2);
        await gamepad(13);
        await expect(volume).not.toBeFocused();
        const audioValue = await volume.inputValue();

        await page.locator('#level4-tab-gameplay').click();
        const combat = page.locator('#level4-group-combat');
        await combat.locator('summary').focus();
        await gamepad(0);
        await expect(combat).toHaveJSProperty('open', true);
        await gamepad(13);
        await expect(page.locator('#fire-rate-slider')).toBeFocused();
        await page.locator('#btn-level4-reset').click();
        await expect(page.locator('#btn-level4-reset')).toHaveAttribute('data-reset-armed', 'true');
        await page.locator('#btn-level4-reset').click();
        await page.locator('#level4-tab-audio').click();
        await expect(volume).toHaveValue(audioValue);
        await capture('settings-audio');

        for (const [width, height] of [[1920, 1080], [1280, 720], [1024, 640]]) {
            await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
            await capture(`settings-${width}`);
            const overflow = await page.locator('#submenu-level4').evaluate((element) => element.scrollWidth - element.clientWidth);
            assert.ok(overflow <= 1, `settings overflow at ${width}: ${overflow}`);
            await expect(page.locator('#btn-close-level4')).toBeInViewport();
        }
        await page.keyboard.press('Escape');
        await expect(page.locator('#btn-open-level4')).toBeFocused();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720));
        await page.locator('[data-session-type="multiplayer"]').click();
        await page.locator('[data-connection-intent-target="host"]').click();
        await expect(page.locator('#btn-multiplayer-host')).toBeVisible();
        await expect(page.locator('#btn-multiplayer-join')).toBeHidden();
        await expect(page.locator('#multiplayer-open-lobbies-controls')).toBeHidden();
        await capture('lobby-create');
        await page.locator('[data-connection-intent-target="join"]').click();
        await expect(page.locator('#btn-multiplayer-host')).toBeHidden();
        await expect(page.locator('#btn-multiplayer-join')).toBeVisible();
        await expect(page.locator('#multiplayer-open-lobbies-controls')).toBeVisible();
        await page.locator('#multiplayer-manual-address summary').focus();
        await gamepad(0);
        await expect(page.locator('#multiplayer-host-address')).toBeVisible();
        await capture('lobby-join');
        // Autosave survives closing and reloading the renderer in this isolated profile.
        await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE.settings.localSettings.audio.masterVolume)).toBe(Number(audioValue) / 100);
        await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE.settingsManager.loadSettings().localSettings.audio.masterVolume)).toBe(Number(audioValue) / 100);
        await page.reload();
        await page.waitForSelector('#main-menu[data-shell-ready="true"]');
        await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE.settings.localSettings.audio.masterVolume)).toBe(Number(audioValue) / 100);
        await page.locator('#btn-main-tutorial').click();
        await expect(page.locator('#main-menu')).toBeHidden({ timeout: 30_000 });
        const tutorial = await page.evaluate(() => ({ map: window.GAME_INSTANCE.settings.mapKey, bots: window.GAME_INSTANCE.settings.numBots, session: window.GAME_INSTANCE.settings.localSettings.sessionType }));
        assert.deepEqual(tutorial, { map: 'tutorial_classic', bots: 0, session: 'single' });
    } finally {
        await app.close();
    }
});


test('desktop LAN lobby creates, joins, readies, starts and leaves through menu controls', { timeout: 180_000 }, async () => {
    const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'curvios-menu-lan-'));
    const apps = [];
    console.log('Lobby screenshots:', artifacts);
    try {
        for (const role of ['host', 'client']) {
            const profile = path.join(artifacts, role);
            await fs.mkdir(profile);
            const boot = path.join(profile, 'boot.cjs');
            await fs.writeFile(boot, 'const {app}=require("electron");app.setPath("appData",' + JSON.stringify(profile) + ');require(' + JSON.stringify(path.resolve('electron/main.cjs')) + ');');
            const env = { ...process.env, PW_RUN_TAG: 'menu-lan-' + role + Date.now(), CURVIOS_ELECTRON_SHOW_WINDOW: '1' };
            delete env.ELECTRON_RUN_AS_NODE;
            apps.push(await _electron.launch({ executablePath: requireElectron('electron'), args: [boot], env }));
        }
        const [host, client] = await Promise.all(apps.map((app) => app.firstWindow()));
        for (const page of [host, client]) {
            await page.waitForSelector('#main-menu[data-shell-ready="true"]', { timeout: 60_000 });
            await page.locator('[data-session-type="multiplayer"]').click();
        }
        await host.locator('[data-connection-intent-target="host"]').click();

        await host.locator('#btn-multiplayer-host').click();
        await expect(host.locator('#multiplayer-session-controls')).toBeVisible({ timeout: 25_000 });
        const code = await host.locator('#multiplayer-share-code').textContent();
        const address = await host.locator('#multiplayer-share-address').textContent();
        console.log('LAN menu connection:', code, address);
        await client.locator('#multiplayer-lobby-code').fill(code);
        await client.locator('#multiplayer-manual-address summary').click();
        await client.locator('#multiplayer-host-address').fill(address);
        await client.locator('#btn-multiplayer-join').click();
        await expect(client.locator('#multiplayer-session-controls')).toBeVisible({ timeout: 25_000 });
        await expect(host.locator('#multiplayer-member-list .mp-player-card')).toHaveCount(2);
        await client.locator('#btn-multiplayer-leave').click();
        await expect(client.locator('#multiplayer-connection-controls')).toBeVisible();
        await expect(host.locator('#multiplayer-member-list .mp-player-card')).toHaveCount(1);
        await client.locator('#multiplayer-lobby-code').fill(code);
        await client.locator('#btn-multiplayer-join').click();
        await expect(client.locator('#multiplayer-session-controls')).toBeVisible({ timeout: 25_000 });
        await client.locator('#multiplayer-ready-toggle').click();
        await expect(client.locator('#multiplayer-ready-toggle')).toBeChecked({ timeout: 15_000 });
        await expect(host.locator('#btn-multiplayer-start')).toBeEnabled({ timeout: 15_000 });
        const personalMap = await client.evaluate(() => window.GAME_INSTANCE.settings.mapKey);
        await client.locator('.lobby-settings').click();
        await expect(client.locator('#submenu-level4')).toBeVisible();
        await client.keyboard.press('Escape');
        await expect(client.locator('.lobby-settings')).toBeFocused();
        await client.keyboard.press('Escape');
        await expect(client.locator('#submenu-multiplayer')).toBeVisible();
        await host.locator('#btn-lobby-edit-match').click();
        await expect(host.locator('#submenu-game')).toBeVisible();
        await host.locator('#btn-setup-mode').click();
        await host.locator('[data-mode-path="normal"]').click();
        await host.locator('#map-select').selectOption('maze');
        await host.locator('.start-step-tab[data-start-section-target="match"]').click();
        await host.locator('#bot-difficulty').selectOption('EASY');
        await host.locator('#btn-setup-lobby').click();
        await expect(host.locator('#btn-lobby-edit-match')).toBeFocused();
        await expect(host.locator('#lobby-map-preview-mount')).toHaveAttribute('data-preview-status', 'ready');
        await expect(client.locator('#lobby-match-summary')).toContainText('Leicht');
        await expect(client.locator('#multiplayer-ready-toggle')).not.toBeChecked();
        await expect(host.locator('#btn-multiplayer-start')).toBeDisabled();
        assert.equal(await client.evaluate(() => window.GAME_INSTANCE.settings.mapKey), personalMap);
        for (const size of [[1280, 720], [1600, 900], [1920, 1080]]) {
            await apps[0].evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), size);
            await expect(host.locator('#btn-multiplayer-start')).toBeInViewport();
            await expect(host.locator('#btn-multiplayer-leave')).toBeInViewport();
            await host.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await host.screenshot({ path: path.join(artifacts, 'lobby-' + size[0] + '.png') });
        }
        await client.locator('#multiplayer-ready-toggle').check();
        await expect(host.locator('#btn-multiplayer-start')).toBeEnabled({ timeout: 15_000 });
        await host.locator('#btn-multiplayer-start').click();
        for (const page of [host, client]) await expect(page.locator('#main-menu')).toBeHidden({ timeout: 30_000 });
        for (const page of [client, host]) {
            await page.evaluate(() => window.GAME_INSTANCE._returnToMenu());
            await expect(page.locator('#main-menu')).toBeVisible();
        }
        // Multiplayer returns directly to its room; leaving remains explicit.
        for (const page of [client, host]) {
            if (await page.locator('[data-session-type="multiplayer"]').isVisible()) {
                await page.locator('[data-session-type="multiplayer"]').click();
            }
            const leave = page.locator('#btn-multiplayer-leave');
            await expect(page.locator('#submenu-multiplayer')).toBeVisible();
            if (await leave.isVisible()) await leave.click();
            await expect(page.locator('#multiplayer-connection-controls')).toBeVisible();
        }
    } finally {
        for (const app of apps.reverse()) await app.close();
    }
});
