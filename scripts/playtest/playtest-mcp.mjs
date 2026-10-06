// MCP server (stdio, official SDK) with exactly one tool, `curvios_playtest`: an agent
// opens an isolated test session of the desktop app, watches it, operates windows,
// mouse, keyboard and menus, flies with the test pilot (direct maneuvers or goal flights
// with live course correction), runs fixed scenarios as jobs, and closes the session.
// There is no free JavaScript execution. Every test helper the agent chooses is recorded
// as an intervention and returned with the results.
//
//   npm run build:app:test     (sessions run on dist-app-test)
//   .mcp.json / .codex/config.toml register this file of the main checkout.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { configurePilot, installControl, maneuver, observe, pilotStatus, readEvents, setPaused, step, stopPilot, updatePilot } from './playtest-control.mjs';
import * as D from './playtest-driver.mjs';
import { buildCatalog, HELPERS, runHelper } from './playtest-helpers.mjs';
import { createJobRegistry, JobBusyError } from './playtest-jobs.mjs';
import {
    readPlaywrightRunLock, readPlaywrightRunLockQueue, resolvePlaywrightRunLockPath, resolvePlaywrightRunLockQueueDir,
} from '../playwright-run-lock.mjs';
import { openLanMatch } from './playtest-lan.mjs';
import { PILOT_VERSION } from './playtest-pilot-runtime.mjs';
import { describeProvenance } from './playtest-provenance.mjs';
import { SCENARIOS, runScenario } from './playtest-scenarios.mjs';
import {
    closeSession, collectErrors, createRunDir, listWindows, launchSession, queueOpenDialog,
    REPO_ROOT, setMessageBoxResponse, setWindowsOnScreen,
} from './playtest-session.mjs';
import { startTray } from './playtest-tray.mjs';
import { listInteractiveElements, performUiAction, UI_ACTIONS } from './playtest-ui.mjs';

// stdout carries the protocol; every log line (lock messages included) goes to stderr.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);

const IDLE_MS = Number(process.env.CURVIOS_PLAYTEST_IDLE_MS) || 10 * 60 * 1000;
const LOCK_WAIT_MS = Number(process.env.CURVIOS_PLAYTEST_LOCK_WAIT_MS) || 5000;
// A queued open waits as long as other Playwright runs do (CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS).
const QUEUE_WAIT_MS = Number(process.env.CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS) || 2 * 60 * 60 * 1000;
const PILOT_MODES = ['maneuver', 'waypoints', 'parcours', 'pursue', 'combat', 'pickup', 'bot', 'off'];
const MANEUVER_FIELDS = ['turn', 'climb', 'roll', 'fireMG', 'boost', 'fireRocket', 'useItem', 'nextItem'];

const jobs = createJobRegistry();
let run = null;
let openingJob = null;
let idleTimer = null;

function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (!run || jobs.active()) { touch(); return; }
        console.error(`[curvios-playtest] no request for ${IDLE_MS} ms: closing the session and releasing the Playwright lock`);
        closeRun('idle timeout').catch(() => {});
    }, IDLE_MS);
    idleTimer.unref?.();
}

async function closeRun(reason) {
    const current = run;
    if (!current) {
        await jobs.cancelAll(reason, 3000);
        return { closed: false };
    }
    run = null;
    await jobs.cancelAll(reason, 30_000);
    for (const session of current.sessions.values()) {
        await stopPilot(session, reason).catch(() => {});
        await closeSession(session).catch(() => {});
    }
    current.tray?.close();
    current.lock?.release?.();
    const summary = { closed: true, runId: current.id, runDir: current.runDir, reason, interventions: current.interventions.length };
    await fs.writeFile(path.join(current.runDir, 'run-summary.json'), `${JSON.stringify({ ...summary, interventions: current.interventions, provenance: current.provenance }, null, 2)}\n`).catch(() => {});
    return summary;
}

function sessionFor(role) {
    if (!run) throw Object.assign(new Error('no open test session: call operation "open" first'), { status: 'blocked' });
    const wanted = role || (run.sessions.has('main') ? 'main' : 'host');
    const session = run.sessions.get(wanted);
    if (!session) throw new Error(`no session with role ${wanted}; open roles: ${[...run.sessions.keys()].join(', ')}`);
    if (session.closed) throw Object.assign(new Error(`the ${wanted} app has closed or crashed; use "close" and "open" again`), { status: 'blocked' });
    return session;
}

async function setWatching(visible) {
    if (!run) return [];
    const windows = [];
    for (const session of run.sessions.values()) windows.push(...await setWindowsOnScreen(session, visible));
    run.visible = visible;
    run.tray?.setVisible(visible);
    return windows;
}

function toolText(value) {
    return { content: [{ type: 'text', text: JSON.stringify(value ?? null, null, 1) }] };
}

// ---- operations -------------------------------------------------------------------------

async function opOpen(args) {
    if (run) return { status: 'already-open', runId: run.id, roles: [...run.sessions.keys()], runDir: run.runDir };
    const provenance = await describeProvenance(REPO_ROOT);
    if (!provenance.build.fresh && args.allowStaleBuild !== true) {
        return { status: 'blocked', reason: `test build does not match the sources: ${provenance.build.reason}. Run "npm run build:app:test" or pass allowStaleBuild:true (recorded).`, provenance };
    }
    if (args.queue === true) {
        // Keep the place in the machine queue across calls: waiting runs as a job, and the
        // session opens as soon as this run is first in line.
        if (openingJob && jobs.get(openingJob)?.state === 'running') return { status: 'queued', job: jobs.get(openingJob), machine: describeMachineLock() };
        const job = jobs.start('open', async ({ signal, progress, log }) => {
            const lock = await D.acquireLock('playtest mcp', {
                waitMs: Math.min(Number(args.waitForLockMs) || QUEUE_WAIT_MS, QUEUE_WAIT_MS),
                log: (line) => {
                    console.error(line);
                    log(line);
                    progress({ waiting: line.replace(/^\[playwright:lock\]\s*/, '') });
                },
            });
            if (signal.aborted) {
                lock.release();
                return { status: 'cancelled', reason: 'cancelled while waiting for the Playwright lock' };
            }
            return launchRun(args, lock, provenance);
        }, { label: 'open (queued for the Playwright lock)' });
        openingJob = job.id;
        return { status: 'queued', job, machine: describeMachineLock(), hint: 'poll with operation job; the session is open when the job is done' };
    }
    let lock;
    try {
        lock = await D.acquireLock('playtest mcp', { waitMs: Number(args.waitForLockMs) || LOCK_WAIT_MS, log: (line) => console.error(line) });
    } catch (error) {
        if (error?.code === 'PLAYWRIGHT_LOCK_TIMEOUT') {
            return {
                status: 'busy', reason: 'another Playwright or playtest run holds the machine; open with queue:true to keep a place in line',
                machine: describeMachineLock(),
            };
        }
        throw error;
    }
    return launchRun(args, lock, provenance);
}

/** Who holds the machine-wide Playwright lock and who waits, for busy answers. */
function describeMachineLock() {
    const lockPath = resolvePlaywrightRunLockPath();
    const holder = readPlaywrightRunLock(lockPath);
    let queue = [];
    try {
        queue = readPlaywrightRunLockQueue(resolvePlaywrightRunLockQueueDir(lockPath), { removeDead: false });
    } catch { /* no queue folder yet */ }
    return {
        holder: holder ? { label: holder.label, kind: holder.kind, since: holder.startedAt, cwd: holder.cwd } : null,
        waiting: queue.map((entry) => ({ label: entry.label, kind: entry.kind, since: entry.enqueuedAt ? new Date(entry.enqueuedAt).toISOString() : null })),
    };
}

async function launchRun(args, lock, provenance) {
    const layout = args.layout || 'single';
    const { id, runDir } = await createRunDir(layout);
    run = { id, runDir, layout, sessions: new Map(), interventions: [], provenance, lock, tray: null, visible: args.visible === true };
    if (!provenance.build.fresh) run.interventions.push({ at: new Date().toISOString(), helper: 'allow_stale_build', args: { reason: provenance.build.reason } });
    try {
        if (layout === 'lan') {
            const lan = await openLanMatch(run, { visible: run.visible, mapKey: args.map || null });
            run.lan = lan;
        } else {
            run.sessions.set('main', await launchSession({ runDir, role: 'main', visible: run.visible }));
            if (layout === 'with-settings-studio') {
                const main = run.sessions.get('main');
                run.sessions.set('studio', await launchSession({ runDir, role: 'studio', entry: 'settings-studio', visible: run.visible, profileDir: main.profile }));
            }
        }
    } catch (error) {
        const failed = await closeRun('open failed');
        return { status: 'blocked', reason: String(error?.message || error), closed: failed };
    }
    run.tray = await startTray({
        onShow: () => { setWatching(true).catch(() => {}); },
        onHide: () => { setWatching(false).catch(() => {}); },
        onStop: () => { closeRun('stopped from the tray icon').catch(() => {}); },
        log: (line) => console.error(line),
    }).catch(() => null);
    run.tray?.setTooltip(`CurviosClash-Test ${layout}: ${id}`);
    run.tray?.setVisible(run.visible);
    return {
        status: 'open', runId: id, layout, runDir, roles: [...run.sessions.keys()], visible: run.visible,
        trayIcon: Boolean(run.tray), lan: run.lan ? { code: run.lan.code, port: run.lan.port, steps: run.lan.steps, localIndexes: run.lan.localIndexes } : undefined,
        provenance,
    };
}

async function opObserve(args) {
    const session = sessionFor(args.role);
    const include = new Set(args.include?.length ? args.include : ['state', 'events']);
    const result = { role: session.role, runId: run.id };
    const images = [];
    if (include.has('screen')) {
        const file = await D.shot(session, `${args.window || 'main'}-${Date.now()}`, args.window || 'main');
        images.push({ type: 'image', data: (await fs.readFile(file)).toString('base64'), mimeType: 'image/png' });
        result.screenshot = file;
    }
    if (include.has('ui')) result.ui = await listInteractiveElements(session, { window: args.window || 'main', within: args.selector || null });
    if (include.has('state') && session.entry === 'game') result.state = await observe(session, { vector: args.vector !== false, player: args.player ?? defaultPlayer(session) });
    if (include.has('events') && session.entry === 'game') result.events = await readEvents(session, args.since || 0);
    if (include.has('errors')) result.errors = await collectErrors(session, args.sinceMs || 0);
    if (include.has('windows')) result.windows = await listWindows(session);
    if (include.has('metrics')) result.metrics = await metricsOf(session);
    if (include.has('pilot') && session.entry === 'game') result.pilot = await pilotStatus(session);
    result.interventions = run.interventions.slice(-10);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }, ...images] };
}

function defaultPlayer(session) {
    if (session.role === 'guest') return run?.lan?.localIndexes?.guest ?? 1;
    return 0;
}

async function metricsOf(session) {
    const page = session.page;
    const renderer = session.entry === 'game' ? await D.measureFps(session, 1500).catch(() => null) : null;
    const heap = await page.evaluate(() => (performance.memory ? {
        usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
    } : null)).catch(() => null);
    const processes = await session.app.evaluate(({ app }) => app.getAppMetrics().map((entry) => ({
        type: entry.type, pid: entry.pid, workingSetMB: Math.round((entry.memory?.workingSetSize || 0) / 1024), cpu: Math.round(entry.cpu?.percentCPUUsage || 0),
    }))).catch(() => []);
    return { fps: renderer, jsHeap: heap, processes, totalWorkingSetMB: processes.reduce((sum, entry) => sum + entry.workingSetMB, 0) };
}

async function opAct(args) {
    const session = sessionFor(args.role);
    const action = args.action;
    if (UI_ACTIONS.includes(action)) return performUiAction(session, { ...args, window: args.window || 'main' });
    switch (action) {
        case 'pause': return setPaused(session, true);
        case 'resume': return setPaused(session, false);
        case 'step': return step(session, Number(args.ms) || 100);
        case 'show_windows': return { windows: await setWatching(true) };
        case 'hide_windows': return { windows: await setWatching(false) };
        case 'queue_open_dialog':
            await queueOpenDialog(session, args.files || []);
            run.interventions.push({ at: new Date().toISOString(), role: session.role, helper: 'queue_open_dialog', args: { files: args.files } });
            return { queued: args.files || [] };
        case 'message_box_answer':
            await setMessageBoxResponse(session, Number(args.value) || 0);
            return { messageBoxResponse: Number(args.value) || 0 };
        case 'helper': return runHelper(run, session, args.helper, args.helperArgs || {});
        default:
            throw new Error(`unknown act action ${action}`);
    }
}

async function opPilot(args) {
    const session = sessionFor(args.role);
    await installControl(session);
    const player = args.player ?? defaultPlayer(session);
    const mode = args.mode || 'maneuver';
    if (args.update === true) return { pilot: await updatePilot(session, args.changes || {}) };
    if (mode === 'off') return { pilot: await stopPilot(session, 'stopped by the agent') };
    if (mode === 'maneuver') {
        const input = Object.fromEntries(MANEUVER_FIELDS.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
        const result = await maneuver(session, input, Number(args.ms) || 250, player);
        return { control: 'direct maneuver through the pilot device (virtual input)', ...result };
    }
    const spec = {
        mode, player, points: args.points, arriveRadius: args.arriveRadius, target: args.target,
        tactic: args.tactic, branch: args.branch, policy: args.policy, type: args.pickupType,
    };
    await configurePilot(session, spec);
    const limitMs = Math.min(Number(args.timeoutMs) || 5 * 60 * 1000, 30 * 60 * 1000);
    const job = jobs.start(`pilot:${mode}`, async ({ signal, progress, log }) => {
        const startedAt = Date.now();
        let status = await pilotStatus(session);
        while (status.status === 'active' && Date.now() - startedAt < limitMs) {
            if (signal.aborted) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
            status = await pilotStatus(session);
            const state = await observe(session, { vector: false, player });
            progress({ pilot: status.status, frames: status.framesActive, parcours: state.parcours, alive: state.self?.alive, combat: status.combat });
            if (state.state !== 'PLAYING') { log(`game left PLAYING (${state.state})`); break; }
        }
        if (status.status === 'active') status = await stopPilot(session, signal.aborted ? 'job cancelled' : 'pilot job ended (limit or game state)');
        return { pilot: status, events: (await readEvents(session, 0)).events.slice(-30) };
    }, { label: `pilot ${mode}` });
    if (args.wait === true) return jobs.wait(job.id, Math.min(Number(args.waitMs) || 60_000, 120_000));
    return { job, control: 'goal flight with live course correction (virtual input device)', hint: 'poll with operation "job", jobId; change goals with pilot update:true' };
}

async function opScenario(args) {
    const scenario = SCENARIOS[args.name];
    if (!scenario) throw new Error(`unknown scenario ${args.name}; available: ${Object.keys(SCENARIOS).join(', ')}`);
    if (!run) return { status: 'blocked', reason: 'no open test session: call operation "open" first' };
    const job = jobs.start(`scenario:${args.name}`, (context) => runScenario(run, args.name, context, args.params || {}, {
        tryLock: async () => {
            // A second client is another process: the lock is re-entrant for this one.
            const probe = [
                `import { acquirePlaywrightRunLock } from ${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'scripts', 'playwright-run-lock.mjs')).href)};`,
                "acquirePlaywrightRunLock({ label: 'busy probe', kind: 'short', waitMs: 1500, log: () => {} })",
                "  .then((lock) => { lock.release(); process.exit(0); }, (error) => process.exit(error?.code === 'PLAYWRIGHT_LOCK_TIMEOUT' ? 75 : 1));",
            ].join('\n');
            const code = await new Promise((resolve) => {
                // Without the holder variable: a child of the holder would otherwise inherit the lock.
                const env = { ...process.env };
                delete env.CURVIOS_PLAYWRIGHT_LOCK_HOLDER;
                execFile(process.execPath, ['--input-type=module', '-e', probe], { windowsHide: true, timeout: 30_000, env }, (error) => resolve(error ? error.code : 0));
            });
            if (code !== 75) throw new Error(`a second client was not refused (probe exit ${code})`);
            return { busy: true, message: 'a second process gets a lock timeout (status busy) instead of the machine', machine: describeMachineLock() };
        },
    }), { label: args.name });
    run.tray?.setTooltip(`CurviosClash-Test: ${args.name}`);
    if (args.wait === true) return jobs.wait(job.id, Math.min(Number(args.waitMs) || 60_000, 120_000));
    return { job, hint: 'poll with operation "job", jobId; cancel with cancel:true' };
}

async function opJob(args) {
    if (!args.jobId) return { active: jobs.active(), jobs: jobs.list() };
    if (args.cancel === true) {
        const cancelled = jobs.cancel(args.jobId, 'cancelled by the agent');
        if (!cancelled) return { status: 'unknown job', jobId: args.jobId };
        for (const session of run?.sessions.values() || []) await stopPilot(session, 'job cancelled').catch(() => {});
        return jobs.wait(args.jobId, 30_000);
    }
    const snapshot = Number(args.waitMs) > 0 ? await jobs.wait(args.jobId, Math.min(Number(args.waitMs), 120_000)) : jobs.get(args.jobId);
    return snapshot || { status: 'unknown job', jobId: args.jobId };
}

async function opCatalog() {
    const session = run?.sessions.get('main') || run?.sessions.get('host') || null;
    const catalog = await buildCatalog(session, {
        scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([name, entry]) => [name, entry.description])),
        pilotModes: PILOT_MODES, maneuverFields: MANEUVER_FIELDS, uiActions: [...UI_ACTIONS, 'pause', 'resume', 'step', 'show_windows', 'hide_windows', 'queue_open_dialog', 'message_box_answer', 'helper'],
    });
    return { ...catalog, pilotVersion: PILOT_VERSION, helpers: HELPERS, session: run ? { runId: run.id, roles: [...run.sessions.keys()] } : null };
}

// ---- the one tool -----------------------------------------------------------------------

const vec3 = z.array(z.number()).length(3);
const inputShape = {
    operation: z.enum(['catalog', 'open', 'observe', 'act', 'pilot', 'scenario', 'job', 'close'])
        .describe('catalog: what exists. open: start an isolated test session (layout single|lan|with-settings-studio). observe: screen image, UI elements, game state, events, errors, windows, metrics. act: mouse, keyboard, forms, pause/step, windows, test helpers. pilot: direct maneuver or goal flight. scenario: start a fixed test as a job. job: progress or cancel. close: end the own session.'),
    role: z.enum(['main', 'host', 'guest', 'studio']).optional().describe('which app of the session (default main, or host in a LAN session)'),
    window: z.enum(['main', 'hangar', 'editor', 'vehicle-lab', 'editor-playtest', 'tuning', 'settings-studio']).optional().describe('window for observe/act (default main)'),
    // open
    layout: z.enum(['single', 'lan', 'with-settings-studio']).optional(),
    visible: z.boolean().optional().describe('open: start on screen instead of hidden; the tray icon can switch later'),
    map: z.string().optional().describe('open lan: map the host selects'),
    allowStaleBuild: z.boolean().optional().describe('open: run although dist-app-test is older than the sources (recorded)'),
    waitForLockMs: z.number().int().min(0).max(7_200_000).optional().describe('open: how long to wait for the machine lock'),
    queue: z.boolean().optional().describe('open: keep a place in the Playwright queue and open as a job when it is our turn (recommended when the machine is busy)'),
    // observe
    include: z.array(z.enum(['screen', 'ui', 'state', 'events', 'errors', 'windows', 'metrics', 'pilot'])).optional().describe('observe: parts to return (default state, events)'),
    since: z.number().int().min(0).optional().describe('observe: events after this seq'),
    sinceMs: z.number().int().min(0).optional().describe('observe: errors after this epoch ms'),
    vector: z.boolean().optional().describe('observe: include the named bot observation vector (default true)'),
    player: z.number().int().min(0).max(9).optional().describe('observe/pilot: player index (default the local player)'),
    // act
    action: z.string().optional().describe(`act: ${[...UI_ACTIONS, 'pause', 'resume', 'step', 'show_windows', 'hide_windows', 'queue_open_dialog', 'message_box_answer', 'helper'].join(', ')}`),
    selector: z.string().optional().describe('act/observe ui: CSS or Playwright selector (from observe ui)'),
    text: z.string().optional(),
    key: z.string().optional().describe('act press/key_down/key_up: Playwright key name, e.g. Escape, KeyW, F8'),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    deltaY: z.number().optional(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    holdMs: z.number().int().min(1).max(10_000).optional(),
    state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional(),
    files: z.array(z.string()).optional().describe('act queue_open_dialog: files the next native open dialog returns'),
    helper: z.enum(Object.keys(HELPERS)).optional().describe('act helper: test helper to run (recorded as intervention)'),
    helperArgs: z.record(z.string(), z.any()).optional(),
    ms: z.number().int().min(1).max(60_000).optional().describe('act step / pilot maneuver: game milliseconds'),
    // pilot
    mode: z.enum(PILOT_MODES).optional().describe('pilot: maneuver (turn/climb/roll/buttons for ms), waypoints, parcours, pursue, combat, pickup, bot (game bot logic), off'),
    turn: z.number().min(-1).max(1).optional().describe('pilot maneuver: + right'),
    climb: z.number().min(-1).max(1).optional().describe('pilot maneuver: + nose up (invert settings are compensated)'),
    roll: z.number().min(-1).max(1).optional(),
    fireMG: z.boolean().optional(),
    boost: z.boolean().optional().describe('pilot maneuver: tap boost'),
    fireRocket: z.boolean().optional(),
    useItem: z.boolean().optional(),
    nextItem: z.boolean().optional(),
    points: z.array(vec3).optional().describe('pilot waypoints: [[x,y,z], ...]'),
    arriveRadius: z.number().min(1).max(100).optional(),
    target: z.number().int().min(0).max(9).optional().describe('pilot pursue/combat: opponent player index (default nearest)'),
    tactic: z.enum(['aggressive', 'balanced', 'evasive']).optional(),
    branch: z.string().optional().describe('pilot parcours: preferred branch checkpoint id part, e.g. TUNNEL'),
    policy: z.string().optional().describe('pilot bot: bot policy type'),
    pickupType: z.string().optional(),
    update: z.boolean().optional().describe('pilot: change the running goal with `changes` instead of starting a new one'),
    changes: z.record(z.string(), z.any()).optional(),
    timeoutMs: z.number().int().min(1000).max(1_800_000).optional(),
    // scenario / job
    name: z.string().optional().describe('scenario: name from catalog'),
    params: z.record(z.string(), z.any()).optional(),
    jobId: z.string().optional(),
    cancel: z.boolean().optional(),
    wait: z.boolean().optional().describe('pilot/scenario/job: wait for the job (at most waitMs, max 120000)'),
    waitMs: z.number().int().min(0).max(120_000).optional(),
};

const server = new McpServer({ name: 'curvios-playtest', version: '2.0.0' }, {
    instructions: 'One tool, curvios_playtest. Start with operation "catalog", then "open" (needs npm run build:app:test). '
        + 'Typical flight loop: act helper start_match {map, mode, paused:true} -> observe -> pilot maneuver {turn, climb, ms} -> observe. '
        + 'Goal flights (pilot waypoints/parcours/combat) and scenarios run as jobs: poll with "job". '
        + 'Helpers (start_match, give_item, teleport, god_mode, set_setting, open_tuning) and dialog answers are interventions and are listed in results. '
        + 'Arcade: observe state.arcade shows phase, sector and objective; leave an intermission with act click on #btn-arcade-intermission-continue while the game is NOT paused. '
        + 'When open answers busy, open again with queue:true to keep a place in the machine queue. '
        + 'Report game bugs separately from tool problems. Call "close" when done; the session closes itself after 10 idle minutes.',
});

server.registerTool('curvios_playtest', {
    title: 'CurviosClash playtest',
    description: 'Play and test the CurviosClash desktop app: open an isolated session, observe screen and game state, operate windows/mouse/keyboard/menus, fly with the test pilot (direct maneuvers or goal flights with course correction), run scenarios as jobs, close. Results distinguish passed, failed, blocked and unclear and list every test helper used.',
    inputSchema: inputShape,
}, async (args) => {
    touch();
    try {
        let value;
        switch (args.operation) {
            case 'catalog': value = await opCatalog(); break;
            case 'open': value = await opOpen(args); break;
            case 'observe': return await opObserve(args);
            case 'act': value = await opAct(args); break;
            case 'pilot': value = await opPilot(args); break;
            case 'scenario': value = await opScenario(args); break;
            case 'job': value = await opJob(args); break;
            case 'close': value = await closeRun('closed by the agent'); break;
            default: throw new Error(`unknown operation ${args.operation}`);
        }
        return toolText(value);
    } catch (error) {
        const status = error instanceof JobBusyError ? 'busy' : (error?.status || 'failed');
        return { content: [{ type: 'text', text: JSON.stringify({ status, operation: args.operation, error: String(error?.message || error).split('\n')[0] }, null, 1) }], isError: true };
    }
});

async function shutdown(code = 0) {
    await closeRun('MCP client disconnected').catch(() => {});
    process.exit(code);
}

process.stdin.on('end', () => { shutdown(0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { shutdown(0); });

await server.connect(new StdioServerTransport());
console.error(`[curvios-playtest] ready (pilot ${PILOT_VERSION}, repo ${REPO_ROOT})`);
