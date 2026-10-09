/* global window */
// Technical capture test only. This never supplies human gameplay evidence.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { acquirePlaywrightRunLock, releasePlaywrightRunLockOnExit } from '../playwright-run-lock.mjs';
import { root, electron as executablePath, run, ffmpeg, ffprobe, sourceDecodeArgs, hashBuild } from './session-tools.mjs';
import { readSessionRecords } from './session-analysis.mjs';
import { processSession } from './process-session.mjs';

const folder = await mkdtemp(path.join(os.tmpdir(), 'curvios-marketing-smoke-'));
const configPath = path.join(folder, 'config.json');
const directory = path.join(folder, 'capture');
const humans = process.argv.includes('--duo') ? 2 : 1;
const botsArg = process.argv.indexOf('--bots');
const bots = botsArg < 0 ? 3 : Number(process.argv[botsArg + 1]);
assert.ok(Number.isInteger(bots) && bots >= 1 && bots <= 8);
const durationArg = process.argv.indexOf('--duration');
const durationSeconds = durationArg < 0 ? 8 : Number(process.argv[durationArg + 1]);
assert.ok(Number.isFinite(durationSeconds) && durationSeconds >= 8 && durationSeconds <= 5400);
await writeFile(configPath, JSON.stringify({ action: 'capture', directory, humans, bots,
    build: { sha256: await hashBuild(path.join(root, 'dist-app')), testOnly: true }, testOnly: true }));
const lock = await acquirePlaywrightRunLock({ label: 'marketing capture smoke' });
releasePlaywrightRunLockOnExit(lock.release);
let app;
try {
    const env = {
        ...process.env, CURVIOS_MARKETING_CONFIG: configPath, CURVIOS_USER_DATA_ROOT: path.join(folder, 'profile'),
        CURVIOS_ELECTRON_TEST_RENDER: 'inactive', CURVIOS_ELECTRON_SHOW_WINDOW: '0',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath, args: ['.'], cwd: path.join(root, 'electron'), env });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => console.error('renderer:', error.message));
    // A correctable setup mistake must not poison the subsequent recording.
    await page.locator('[data-start]').click();
    await page.waitForFunction(() => window.document.querySelector('[data-status]').textContent.length > 0);
    await page.locator('[data-confirm]').check();
    await page.locator('[data-start]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        || Boolean(window.GAME_INSTANCE?.marketingSession?.error), null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.GAME_INSTANCE.marketingSession.error), null);
    const participants = await page.evaluate(() => window.GAME_INSTANCE.entityManager.players.map((p) => p.isBot));
    assert.deepEqual(participants, [...Array(humans).fill(false), ...Array(bots).fill(true)]);
    const started = Date.now();
    let warmMemory = null, lastMemory = null, peakMemory = 0, restarts = 0;
    do {
        await page.waitForTimeout(Math.min(30000, Math.max(1, durationSeconds * 1000 - (Date.now() - started))));
        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return { state: game.state, error: game.marketingSession.error,
                pendingBytes: game.marketingSession.pendingBytes, records: game.marketingSession.records.length };
        });
        assert.equal(state.error, null);
        assert.ok(state.pendingBytes <= 32 * 1024 * 1024 && state.records < 12);
        lastMemory = await app.evaluate(({ app: runtime }) => runtime.getAppMetrics()
            .reduce((sum, metric) => sum + (metric.memory?.workingSetSize || 0), 0) * 1024);
        peakMemory = Math.max(peakMemory, lastMemory);
        const seconds = Math.round((Date.now() - started) / 1000);
        if (seconds >= 300 && warmMemory === null) warmMemory = lastMemory;
        const sample = { seconds, ...state, workingSetBytes: lastMemory, restarts };
        await appendFile(path.join(folder, 'duration-samples.ndjson'), JSON.stringify(sample) + '\n');
        if (durationSeconds > 30) console.log('duration-sample', sample);
        if (state.state === 'MATCH_END' && seconds < durationSeconds) {
            // Technical test only: keep exercising round/match transitions.
            await page.evaluate(async () => { await window.GAME_INSTANCE._returnToMenu(); await window.GAME_INSTANCE.startMatch(); });
            restarts++;
        }
    } while (Date.now() - started < durationSeconds * 1000);
    if (durationSeconds >= 5400) {
        assert.ok(warmMemory > 0 && lastMemory - warmMemory < 512 * 1024 ** 2, 'Working set growth after warmup must remain below 512 MiB');
        console.log('Long-duration memory check passed', { warmMemory, lastMemory, peakMemory, restarts });
    }
    console.log('capture-state', await page.evaluate(() => ({ error: window.GAME_INSTANCE.marketingSession.error,
        sequence: window.GAME_INSTANCE.marketingSession.sequence })));
    if (process.argv.includes('--crash')) {
        const closed = app.waitForEvent('close', { timeout: 45000 });
        await app.evaluate(({ app: runtime }) => runtime.exit(23));
        await closed; app = null;
        const manifest = JSON.parse(await readFile(path.join(directory, 'session.json'), 'utf8'));
        assert.equal(manifest.status, 'recording');
        assert.ok((await readdir(directory)).includes('original.webm.partial'));
        const segments = (await readdir(directory)).filter((name) => name.startsWith('segment-')).sort();
        assert.ok(segments.length >= 2, 'At least one closed segment plus the active segment must survive');
        for (const segment of segments.slice(0, -1)) {
            const decoded = await run(ffmpeg, sourceDecodeArgs(path.join(directory, segment)));
            assert.equal(decoded.stderr.trim(), '');
        }
        console.log(`Crash recovery smoke passed: ${segments.length - 1} closed segments retained. ${directory}`);
    } else {
        const closed = app.waitForEvent('close', { timeout: 45000 });
        await app.evaluate(({ BrowserWindow, app: runtime }, quit) => quit ? runtime.quit() : BrowserWindow.getAllWindows()[0].close(), process.argv.includes('--quit'));
        await closed; app = null;
        const manifest = JSON.parse(await readFile(path.join(directory, 'session.json'), 'utf8'));
        assert.equal(manifest.status, 'complete', JSON.stringify(manifest));
        assert.ok(manifest.bytes > 10000); assert.ok(manifest.records > 30);
        const metadata = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', path.join(directory, 'original.webm')])).stdout);
        assert.ok(metadata.streams.some((s) => s.codec_type === 'video'));
        assert.ok(metadata.streams.some((s) => s.codec_type === 'audio'));
        const decoded = await run(ffmpeg, sourceDecodeArgs(path.join(directory, 'original.webm')));
        assert.equal(decoded.stderr.trim(), '', `Media decode errors: ${decoded.stderr}`);
        assert.ok((await readdir(directory)).some((name) => name.startsWith('segment-')));
        console.log(`Capture smoke passed: ${directory}`);
        if (process.argv.includes('--process')) {
            const result = await processSession(directory);
            assert.equal(result.status, 'rejected');
            assert.ok(result.reasons.includes('incomplete_or_unverified_session'));
            assert.ok((await readFile(path.join(result.directory, 'ERGEBNIS.txt'), 'utf8')).includes('Keine geeigneten'));
            console.log('Technical session rejected by the production pipeline as expected.');
        }
        if (process.argv.includes('--render')) {
            const journalPath = path.join(directory, 'journal.ndjson');
            let match, first, hasSimulationFrames = false;
            for await (const record of readSessionRecords(journalPath, manifest.journalSha256)) {
                if (record.type === 'match-start' && !first) match = record;
                if (record.type === 'snapshot' && !first) first = record;
                if (record.type === 'snapshot' && record.frame > 0 && record.snapshot.frame > 0) hasSimulationFrames = true;
            }
            assert.equal(hasSimulationFrames, true, 'Snapshot and journal must identify actual simulation ticks');
            // Initial GPU/arena loading can stall the first few snapshots.
            const selection = { match: match.match, round: first.round, startMs: first.timeMs + 5000, endMs: first.timeMs + 6000 };
            const replay = { contractVersion: 'cinematic-replay.v2', matchId: 'technical-smoke', sampleFps: 30,
                durationMs: selection.endMs, exportStartMs: selection.startMs, snapshots: [first.snapshot], subjects: [0, 1],
                metadata: { ...match.metadata, localPlayerIndex: 0, hudMode: 'clean',
                    settings: { ...match.metadata.settings, recording: { profile: 'cinematic', orientation: 'portrait', hudMode: 'clean' } } } };
            const replayPath = path.join(folder, 'replay.json');
            const renderConfig = path.join(folder, 'render-config.json');
            const resultPath = path.join(folder, 'render-result.json');
            await writeFile(replayPath, JSON.stringify(replay));
            await writeFile(renderConfig, JSON.stringify({ action: 'render', replayPath, journalPath, selection,
                resultPath, output: path.join(folder, 'technical-render.mp4') }));
            await run(executablePath, ['.'], { cwd: path.join(root, 'electron'), timeout: 180000,
                env: { CURVIOS_MARKETING_CONFIG: renderConfig, CURVIOS_USER_DATA_ROOT: path.join(folder, 'render-profile'),
                    CURVIOS_ELECTRON_TEST_RENDER: 'inactive', CURVIOS_ELECTRON_SHOW_WINDOW: '0' } });
            const rendered = JSON.parse(await readFile(resultPath, 'utf8'));
            assert.equal(rendered.saved, true, JSON.stringify(rendered));
            assert.equal(rendered.frameCount, 60);
            console.log(`Offline replay smoke passed: ${rendered.filePath}`);
        }
    }
} finally { await app?.close(); lock.release(); }
