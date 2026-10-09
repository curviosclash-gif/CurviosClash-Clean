const fs = require('node:fs/promises');
const path = require('node:path');
const { createMarketingSessionStore } = require('./marketing-session-store.cjs');
const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');

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

function installMarketingSessionIpc({ ipcMain, getWindow, isTrusted, configPath, ffmpeg }) {
    if (!configPath) return { attach() {}, finish: async () => {} };
    const configPromise = fs.readFile(configPath, 'utf8').then(JSON.parse);
    let store;
    let finishPromise;
    let replayReader;
    function handle(name, action) {
        ipcMain.handle(`marketing:${name}`, async (event, payload) => {
            if (!isTrusted(event)) throw new Error('untrusted_marketing_sender');
            return action(payload);
        });
    }
    handle('config', async () => {
        const config = await configPromise;
        if (config.action === 'render') {
            const replay = JSON.parse(await fs.readFile(config.replayPath, 'utf8'));
            replayReader = replaySnapshots(config.journalPath, config.selection);
            return { action: 'render', replay };
        }
        return { action: 'capture', humans: config.humans, bots: config.bots };
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
        await fs.writeFile(config.resultPath, JSON.stringify(result, null, 2), { flag: 'wx' });
        setTimeout(() => getWindow()?.close(), 100);
        return { saved: true };
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
