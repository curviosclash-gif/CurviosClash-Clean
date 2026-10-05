// MCP server (stdio) that lets an agent play the real desktop app with typed tools:
// start a match, pause and step the simulation, steer the ship, read a situation report
// and the event log, take screenshots that come back as images.
//
//   npm run build:app:test      (the app is launched from dist-app-test)
//   .mcp.json registers this server as "curvios-playtest" for Claude Code.
//
// The app is launched on the first tool call that needs it and holds the machine-wide
// Playwright lock until `close`, the end of the client connection, or
// CURVIOS_PLAYTEST_IDLE_MS (default 10 min) without a tool call.
import { readFile } from 'node:fs/promises';
import * as D from './playtest-driver.mjs';
import { createMcpDispatcher, serveMcpOverStdio, toolResult } from './playtest-mcp-protocol.mjs';

// stdout carries the protocol; every log line (lock messages included) goes to stderr.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);

const IDLE_MS = Number(process.env.CURVIOS_PLAYTEST_IDLE_MS) || 600_000;
const LOCK_WAIT_MS = Number(process.env.CURVIOS_PLAYTEST_LOCK_WAIT_MS) || 120_000;

let session = null;
let lock = null;
let idleTimer = null;
let launchedAt = 0;

async function closeSession() {
    await D.closeApp(session).catch(() => {});
    session = null;
    lock?.release?.();
    lock = null;
}

function touchIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (!session) return;
        console.error(`[playtest-mcp] idle for ${IDLE_MS} ms: closing the app and releasing the Playwright lock`);
        closeSession();
    }, IDLE_MS);
    idleTimer.unref?.();
}

async function ensureSession({ visible } = {}) {
    if (session && !session.closed && (visible === undefined || session.visible === visible)) return { session, relaunched: false };
    if (!lock) {
        try {
            lock = await D.acquireLock('playtest mcp', { waitMs: LOCK_WAIT_MS, log: (line) => console.error(line) });
        } catch (error) {
            if (error?.code === 'PLAYWRIGHT_LOCK_TIMEOUT') {
                throw new Error(`another Playwright run holds the machine lock (waited ${LOCK_WAIT_MS} ms); try again later. ${error.message}`);
            }
            throw error;
        }
    }
    const relaunched = Boolean(session);
    if (session) await D.closeApp(session).catch(() => {});
    session = await D.launchApp({ visible: visible ?? session?.visible ?? process.env.CURVIOS_PLAYTEST_VISIBLE === '1' });
    launchedAt = Date.now();
    return { session, relaunched };
}

/** Wraps a tool body: launches the app on demand and notes a crash relaunch in the result. */
function withApp(run) {
    return async (args) => {
        touchIdleTimer();
        const { session: current, relaunched } = await ensureSession();
        const value = await run(current, args);
        if (relaunched && value && typeof value === 'object' && !Array.isArray(value.content)) {
            return { ...value, note: 'the app had closed or crashed and was relaunched; match state was lost' };
        }
        return value;
    };
}

const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const vec3 = (description) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description });
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const ACTION_PROPERTIES = {
    pitchAxis: num('-1..1, nose up (+) / down (-)'),
    yawAxis: num('-1..1, turn right (+) / left (-)'),
    rollAxis: num('-1..1, roll right (+) / left (-)'),
    pitchUp: bool('digital pitch up'), pitchDown: bool('digital pitch down'),
    yawLeft: bool('digital turn left'), yawRight: bool('digital turn right'),
    rollLeft: bool('digital roll left'), rollRight: bool('digital roll right'),
    boost: bool('hold boost'), shootMG: bool('fire the machine gun'), shootRocket: bool('fire a rocket'),
    shootItem: bool('shoot the selected item'), nextItem: bool('select the next item'), dropItem: bool('drop the selected item'),
    useItem: num('inventory index to use, -1 for none', { minimum: -1 }),
    shootItemIndex: num('inventory index to shoot, -1 for the selected one', { minimum: -1 }),
};

const tools = [
    {
        name: 'status',
        description: 'Whether the app is running, where shots and reports go, and whether this server holds the Playwright lock. Never launches anything.',
        inputSchema: schema(),
        run: async () => ({
            running: Boolean(session && !session.closed), crashed: Boolean(session?.closed), lockHeld: Boolean(lock),
            visible: session?.visible ?? null, uptimeMs: session ? Date.now() - launchedAt : 0, outDir: D.OUT_DIR, idleCloseMs: IDLE_MS,
        }),
    },
    {
        name: 'launch',
        description: 'Starts (or restarts) the desktop app from dist-app-test with a throwaway profile. Other tools launch it on demand; use this to switch visibility or to start clean.',
        inputSchema: schema({ visible: bool('show the window on screen (default: off-screen at full frame rate)') }),
        run: async ({ visible = false }) => {
            touchIdleTimer();
            if (session) await D.closeApp(session).catch(() => {});
            session = null;
            await ensureSession({ visible });
            return { launched: true, visible };
        },
    },
    {
        name: 'start_match',
        description: 'Starts a match directly (menu skipped). Check `problems`: a map that the mode excludes falls back silently. The autopilot choice carries over into the new match. Pass paused:true to start frozen and drive it with step/act.',
        inputSchema: schema({
            map: str('map key, e.g. standard, sunflower_meadow, clockwork_canyon'),
            mode: str('game mode', { enum: ['CLASSIC', 'HUNT', 'ARCADE', 'ESCORT'] }),
            bots: num('number of bots (default 2)', { minimum: 0, maximum: 12 }),
            vehicle: str('vehicle id for player 1'),
            difficulty: str('bot difficulty (default NORMAL)'),
            winsNeeded: num('rounds to win (default 99)', { minimum: 1 }),
            seed: num('integer seed: fixed arcade seed and seeded Math.random in the renderer (fewer random differences, no guarantee)'),
            paused: bool('freeze the simulation right after the start'),
            hunt: { type: 'object', description: 'extra hunt settings' },
            arcade: { type: 'object', description: 'extra arcade settings' },
        }, ['map']),
        run: withApp((current, args) => D.startMatch(current, args)),
    },
    {
        name: 'observe',
        description: 'Situation report: own ship (hp, speed, position, forward, inventory), every other ship relative to your nose (ahead/right/up in world units, offNoseDeg), round state, last event number, and the bot observation vector with names (WALL_DISTANCE_FRONT etc., 0..1).',
        inputSchema: schema({ vector: bool('include the named observation vector (default true)') }),
        run: withApp((current, { vector = true }) => D.observe(current, { vector })),
    },
    {
        name: 'act',
        description: 'Holds a control input on your ship for ms of game time (keyboard is ignored meanwhile). When paused, the game advances exactly that long and stays paused, so observe -> act -> observe is one decision step. Fields not given stay neutral.',
        inputSchema: schema({ ...ACTION_PROPERTIES, ms: num('how long to hold it, in game milliseconds (default 250)', { minimum: 1 }) }),
        run: withApp((current, { ms = 250, ...action }) => D.act(current, action, ms)),
    },
    {
        name: 'pause',
        description: 'Freezes (paused:true) or resumes (paused:false) the simulation. Rendering continues, so screenshots still work.',
        inputSchema: schema({ paused: bool('true to freeze, false to resume') }, ['paused']),
        run: withApp((current, { paused }) => D.setPaused(current, paused)),
    },
    {
        name: 'step',
        description: 'Advances a paused game by ms of game time in 1/60 s steps, with the current pilot (autopilot or neutral input), and stays paused.',
        inputSchema: schema({ ms: num('game milliseconds to advance (default 100)', { minimum: 1 }) }),
        run: withApp((current, { ms = 100 }) => D.step(current, ms)),
    },
    {
        name: 'autopilot',
        description: 'Lets the game\'s own bot policy fly your ship (enabled:true) or hands control back (enabled:false). Survives new rounds and matches.',
        inputSchema: schema({ enabled: bool('on or off'), policy: str('bot policy type, default: the match bot policy') }, ['enabled']),
        run: withApp(async (current, { enabled, policy = null }) => {
            if (enabled) return { autopilot: await D.enableAutopilot(current, policy) };
            await D.disableAutopilot(current);
            return { autopilot: false };
        }),
    },
    {
        name: 'events',
        description: 'Game events since `since` (the lastSeq of a previous call): deaths (with isHuman and cause), round ends (humanWon), hunt damage, feedback and feed lines. Keeps the last 1000.',
        inputSchema: schema({ since: num('only events with a higher seq (default 0)', { minimum: 0 }) }),
        run: withApp((current, { since = 0 }) => D.readEvents(current, since)),
    },
    {
        name: 'screenshot',
        description: 'Screenshot of the game window, returned as an image and saved in the output folder.',
        inputSchema: schema({ name: str('file name without extension (default: shot-<time>)') }),
        run: withApp(async (current, { name }) => {
            const file = await D.shot(current, name || `shot-${Date.now()}`);
            const data = (await readFile(file)).toString('base64');
            return toolResult({ file }, { images: [{ data, mimeType: 'image/png' }] });
        }),
    },
    {
        name: 'sample',
        description: 'Records hp, position, speed, alive and score every intervalMs for durationMs (inside the game, real time), plus distance flown and deaths.',
        inputSchema: schema({
            durationMs: num('how long to record (default 5000)', { minimum: 0, maximum: 120000 }),
            intervalMs: num('time between samples (default 1000)', { minimum: 16 }),
        }),
        run: withApp(async (current, { durationMs = 5000, intervalMs = 1000 }) => {
            const samples = await D.sample(current, durationMs, intervalMs);
            return { distance: D.distanceTravelled(samples), deaths: D.countDeaths(samples), samples };
        }),
    },
    {
        name: 'fps',
        description: 'Average frame rate and 95th-percentile frame time over ms.',
        inputSchema: schema({ ms: num('measuring time (default 3000)', { minimum: 500, maximum: 30000 }) }),
        run: withApp((current, { ms = 3000 }) => D.measureFps(current, ms)),
    },
    {
        name: 'give_item',
        description: 'Debug: puts an item straight into your inventory (e.g. BOMBER_STRIKE). Say so in any report, it was not picked up in play.',
        inputSchema: schema({ type: str('item type') }, ['type']),
        run: withApp((current, { type }) => D.giveItem(current, type)),
    },
    {
        name: 'teleport',
        description: 'Debug: moves your ship once to pos, optionally facing target; physics takes over right after.',
        inputSchema: schema({ pos: vec3('[x, y, z]'), target: vec3('[x, y, z] to face') }, ['pos']),
        run: withApp((current, { pos, target = null }) => D.teleport(current, pos, target)),
    },
    {
        name: 'hold_aim',
        description: 'Debug: pins your ship at pos facing target for ms while keys are held (default KeyX = MG), e.g. to shoot a structure. god keeps health full.',
        inputSchema: schema({
            pos: vec3('[x, y, z]'), target: vec3('[x, y, z]'), ms: num('duration (default 4000)', { minimum: 100, maximum: 60000 }),
            keys: { type: 'array', items: { type: 'string' }, description: 'keys held the whole time' },
            tapKeys: { type: 'array', items: { type: 'string' }, description: 'keys tapped repeatedly' },
            sweep: num('aim circle radius around the target (default 0)'), god: bool('keep health full (default true)'),
        }, ['pos', 'target']),
        run: withApp(async (current, args) => { await D.holdAim(current, args); return D.snapshot(current); }),
    },
    {
        name: 'press_key',
        description: 'Presses one real key (Playwright key name, e.g. Escape, KeyQ) for holdMs. For flying, prefer act.',
        inputSchema: schema({ key: str('key name'), holdMs: num('hold time (default 80)', { minimum: 1, maximum: 10000 }) }, ['key']),
        run: withApp(async (current, { key, holdMs = 80 }) => { await D.press(current, key, holdMs); return { pressed: key }; }),
    },
    {
        name: 'return_to_menu',
        description: 'Ends the match and returns to the main menu; also clears pause and held input.',
        inputSchema: schema(),
        run: withApp(async (current) => ({ state: await D.returnToMenu(current) })),
    },
    {
        name: 'errors',
        description: 'Console and page errors from the game since sinceMs (epoch ms; default: since launch), without known Chromium noise.',
        inputSchema: schema({ sinceMs: num('epoch milliseconds') }),
        run: withApp((current, { sinceMs = 0 }) => ({ errors: D.errorsSince(current, sinceMs) })),
    },
    {
        name: 'eval',
        description: 'Escape hatch: evaluates a JavaScript expression in the game renderer (window.GAME_INSTANCE is the game) and returns its JSON value. Awaits promises. Prefer the typed tools.',
        inputSchema: schema({ expression: str('expression, e.g. window.GAME_INSTANCE.state') }, ['expression']),
        run: withApp((current, { expression }) => current.page.evaluate(expression)),
    },
    {
        name: 'close',
        description: 'Closes the app and releases the Playwright lock so other test runs can go. The next tool call launches it again.',
        inputSchema: schema(),
        run: async () => { clearTimeout(idleTimer); const wasRunning = Boolean(session); await closeSession(); return { closed: wasRunning }; },
    },
];

const dispatch = createMcpDispatcher({
    name: 'curvios-playtest',
    version: '1.0.0',
    instructions: 'Plays CurviosClash in the real desktop app (needs "npm run build:app:test" first). '
        + 'Typical loop: start_match {map, mode, paused:true} -> observe -> act {yawAxis, shootMG, ms} -> observe/events, '
        + 'or autopilot {enabled:true} + sample. Rounds are tagged as automation and never count as human play. '
        + 'give_item, teleport, hold_aim and eval are debug shortcuts: name them as such in any report. '
        + 'Call close when done so other Playwright runs can use the machine.',
    tools,
});

serveMcpOverStdio(dispatch, {
    onClose: async () => {
        await closeSession();
        process.exit(0);
    },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { closeSession().finally(() => process.exit(0)); });
}
