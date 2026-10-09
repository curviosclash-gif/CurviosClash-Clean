import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { run, root, electron, ffmpeg, ffprobe, hashBuild } from './session-tools.mjs';
import { processSession } from './process-session.mjs';
import { acquirePlaywrightRunLock, releasePlaywrightRunLockOnExit } from '../playwright-run-lock.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const humans = Number(option('--humans', 1));
const bots = Number(option('--bots', 3));
if (![1, 2].includes(humans) || !Number.isInteger(bots) || bots < 1 || bots > 8) throw new Error('Use --humans 1|2 --bots 1..8');
const base = path.resolve(option('--output', path.join(os.homedir(), 'Videos', 'CurviosClash')));
const commonGit = (await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
const repository = path.dirname(commonGit);
const inside = (file, parent) => {
    const relative = path.relative(parent.toLowerCase(), file.toLowerCase());
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
const checkOutput = (file) => {
    if (inside(file, root) || inside(file, repository)) throw new Error('Recordings must be stored outside the repository');
};
checkOutput(base);
await mkdir(base, { recursive: true });
checkOutput(await realpath(base));
await run(ffmpeg, ['-version']); await run(ffprobe, ['-version']);
const lock = await acquirePlaywrightRunLock({ label: 'human marketing recording and production' });
releasePlaywrightRunLockOnExit(lock.release);
try {
    const name = `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const directory = path.join(base, name);
    const configPath = path.join(base, `${name}.json`);
    const build = { sha256: await hashBuild(path.join(root, 'dist-app')),
        commit: (await run('git', ['rev-parse', 'HEAD'])).stdout.trim(),
        dirty: Boolean((await run('git', ['status', '--porcelain'])).stdout.trim()) };
    await writeFile(configPath, JSON.stringify({ action: 'capture', humans, bots, directory, build }), { flag: 'wx' });
    console.log(`Aufnahmeziel: ${directory}. Modellaufrufe: 0. Nach Spielende startet die Auswertung.`);
    try {
        await run(electron, ['.'], { cwd: path.join(root, 'electron'), windowsHide: false, env: {
            CURVIOS_MARKETING_CONFIG: configPath, CURVIOS_USER_DATA_ROOT: path.join(base, 'player-profile'),
            CURVIOS_ELECTRON_SHOW_WINDOW: '1', CURVIOS_ELECTRON_TEST_RENDER: 'off',
        } });
    } catch (error) { console.error(`Spielprozess beendet: ${error.message}`); }
    let started = true;
    try { await readFile(path.join(directory, 'session.json')); }
    catch { console.log('Keine Aufnahme gestartet.'); started = false; }
    if (started) {
        const result = await processSession(directory);
        if (process.platform === 'win32') {
            const explorer = spawn('explorer.exe', [result.directory], { detached: true, stdio: 'ignore', windowsHide: true });
            explorer.on('error', (error) => console.warn(`Ergebnisordner bitte selbst öffnen: ${error.message}`));
            explorer.unref();
        }
    }
} finally { lock.release(); }
