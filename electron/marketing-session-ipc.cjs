const fs = require('node:fs/promises');
const path = require('node:path');
const { isAbsolute } = path;
const { createMarketingSessionStore } = require('./marketing-session-store.cjs');
const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');

const MAX_REPLAY_BYTES = 256 * 1024 * 1024;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;

function isInside(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..' + path.sep)
        && relative !== '..' && !path.isAbsolute(relative));
}

function assertExternal(repositoryRoot, candidate) {
    if (isInside(repositoryRoot, candidate)) throw new Error('marketing_path_inside_repository');
}

async function resolveExternalPath(repositoryRoot, file, { mustExist = false } = {}) {
    if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('marketing_path_must_be_absolute');
    let resolved;
    if (mustExist) resolved = await fs.realpath(file);
    else resolved = path.resolve(await fs.realpath(path.dirname(file)), path.basename(file));
    assertExternal(repositoryRoot, resolved);
    return resolved;
}

async function validateConfig(config, repositoryRoot) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid_marketing_config');
    if (config.action === 'capture') {
        if (![1, 2].includes(config.humans) || !Number.isInteger(config.bots) || config.bots < 1 || config.bots > 8) {
            throw new Error('invalid_marketing_participants');
        }
        if (typeof config.directory !== 'string' || !isAbsolute(config.directory)) throw new Error('invalid_marketing_directory');
        const parent = await fs.realpath(path.dirname(config.directory));
        assertExternal(repositoryRoot, parent);
        config.directory = path.resolve(parent, path.basename(config.directory));
        assertExternal(repositoryRoot, config.directory);
        if (config.settings !== undefined) {
            const serialized = JSON.stringify(config.settings);
            if (Buffer.byteLength(serialized) > 2 * 1024 * 1024 + 64 * 1024 || !config.settings || typeof config.settings !== 'object'
                || Array.isArray(config.settings) || typeof config.settings.mapKey !== 'string'
                || config.settings.mapKey.length < 1 || config.settings.mapKey.length > 128
                || !['EASY', 'NORMAL', 'HARD'].includes(config.settings.botDifficulty)
                || !config.settings.controls || typeof config.settings.controls !== 'object'
                || Array.isArray(config.settings.controls)) throw new Error('invalid_marketing_settings');
            if (config.settings.mapKey.startsWith('editor_')
                && (!/^editor_[a-z0-9][a-z0-9_-]{0,63}$/.test(config.settings.mapKey)
                    || !config.settings.localMap || typeof config.settings.localMap !== 'object'
                    || Array.isArray(config.settings.localMap) || !Array.isArray(config.settings.localMap.size)
                    || config.settings.localMap.size.length < 3
                    || !config.settings.localMap.size.slice(0, 3).every((dimension) => Number.isFinite(dimension) && dimension > 0)
                    || (config.settings.localMap.obstacles !== undefined && !Array.isArray(config.settings.localMap.obstacles)))) {
                throw new Error('invalid_marketing_local_map');
            }
        }
        return config;
    }
    if (config.action !== 'render') throw new Error('invalid_marketing_action');
    config.replayPath = await resolveExternalPath(repositoryRoot, config.replayPath, { mustExist: true });
    config.journalPath = await resolveExternalPath(repositoryRoot, config.journalPath, { mustExist: true });
    config.resultPath = await resolveExternalPath(repositoryRoot, config.resultPath);
    config.output = await resolveExternalPath(repositoryRoot, config.output);
    const replayStat = await fs.stat(config.replayPath);
    if (replayStat.size > MAX_REPLAY_BYTES) throw new Error('marketing_replay_too_large');
    const journalStat = await fs.stat(config.journalPath);
    if (journalStat.size > MAX_REPLAY_BYTES) throw new Error('marketing_journal_too_large');
    const selection = config.selection;
    if (!selection || !Number.isInteger(selection.match) || !Number.isInteger(selection.round)
        || !Number.isFinite(selection.startMs) || !Number.isFinite(selection.endMs)
        || selection.startMs < 0 || selection.endMs <= selection.startMs
        || !Array.isArray(selection.subjects) || selection.subjects.length !== 2
        || selection.subjects.some((subject) => !Number.isInteger(subject) || subject < 0)) {
        throw new Error('invalid_marketing_selection');
    }
    return config;
}

async function* replaySnapshots(file, selection) {
    const input = createReadStream(file);
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            for (const record of JSON.parse(line).records) {
                if (record.type === 'snapshot' && record.match === selection.match && record.round === selection.round
                    && record.timeMs <= selection.endMs + 100) yield record.snapshot;
            }
        }
    } finally { lines.close(); input.destroy(); }
}
async function* replaySnapshots(file, selection) {
    const input = createReadStream(file);
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            for (const record of JSON.parse(line).records) {
                if (record.type === 'snapshot' && record.match === selection.match && record.round === selection.round
                    && record.timeMs <= selection.endMs + 100) yield record.snapshot;
            }
        }
    } finally { lines.close(); input.destroy(); }
}

function installMarketingSessionIpc({ ipcMain, getWindow, isTrusted, configPath, ffmpeg, repositoryRoot = path.resolve(__dirname, '..') }) {
    if (!configPath) return { attach() {}, finish: async () => {} };
    const configPromise = fs.readFile(configPath, 'utf8').then(JSON.parse).then((config) => validateConfig(config, repositoryRoot));
    let store;
    let finishPromise;
    let replayReader;
    const actions = new Map();
    function handle(name, action) {
        actions.set(name, action);
    }
    handle('config', async () => {
        const config = await configPromise;
        if (config.action === 'render') {
            const replay = JSON.parse(await fs.readFile(config.replayPath, 'utf8'));
            replayReader = replaySnapshots(config.journalPath, config.selection);
            return { action: 'render', replay };
        }
        return { action: 'capture', humans: config.humans, bots: config.bots, settings: config.settings || null };
    });
    handle('replay-batch', async () => {
        if (!replayReader) throw new Error('replay_not_open');
        const snapshots = [];
        for (let i = 0; i < 8; i++) {
            const next = await replayReader.next();
            if (next.done) break;
            snapshots.push(next.value);
        }
        return snapshots;
    });
    handle('begin', async (setup) => {
        const config = await configPromise;
        if (config.action !== 'capture' || store) throw new Error('capture_not_available');
        if (![1, 2].includes(setup?.humans) || !Number.isInteger(setup?.bots) || setup.bots < 1 || setup.bots > 8
            || setup.confirmedHumans !== setup.humans) throw new Error('invalid_participants');
        const space = await fs.statfs(path.dirname(config.directory));
        if (Number(space.bavail) * Number(space.bsize) < 10 * 1024 ** 3) throw new Error('At least 10 GB free storage required');
        store = await createMarketingSessionStore({ directory: config.directory, ffmpeg,
            metadata: { setup, build: config.build, assets: config.assets,
                snapshotTargetFps: 60,
                provenance: config.testOnly ? 'technical-test' : 'local-game-session' } });
        return { ready: true };
    });
    handle('append', (payload) => {
        if (!store) throw new Error('session_not_started');
        return store.append(payload);
    });
    handle('finish', (details) => {
        finishPromise ||= store?.finish(details?.error ? 'partial' : 'complete', details);
        return finishPromise;
    });
    handle('render-result', async (result) => {
        const config = await configPromise;
        if (config.action !== 'render') throw new Error('render_not_active');
        const body = JSON.stringify(result, null, 2);
        if (Buffer.byteLength(body) > MAX_RESULT_BYTES) throw new Error('marketing_result_too_large');
        await fs.writeFile(config.resultPath, body, { flag: 'wx' });
        setTimeout(() => getWindow()?.close(), 100);
        return { saved: true };
    });
    ipcMain.handle('marketing:request', async (event, name, payload) => {
        if (!isTrusted(event)) throw new Error('untrusted_marketing_sender');
        const action = actions.get(name);
        if (!action) throw new Error('unsupported_marketing_request');
        return action(payload);
    });
    return {
        attach() {
            const win = getWindow();
            win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
                if (request.frame !== win.webContents.mainFrame) { callback({}); return; }
                callback({ video: win.webContents.mainFrame, audio: win.webContents.mainFrame, enableLocalEcho: true });
            });
        },
        async finish() {
            finishPromise ||= store?.finish('partial', { error: 'window_closed_without_final_flush' });
            return finishPromise;
        },
    };
}
module.exports = { installMarketingSessionIpc };
