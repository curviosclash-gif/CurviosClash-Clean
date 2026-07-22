import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

const STATE_DIR = join(tmpdir(), 'opencode');
const SNAPSHOT_FILE = join(STATE_DIR, 'council-perf-snapshot.json');
const ROOT = resolve(import.meta.dirname || '.', '..');

function ensureDir() { if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true }); }

function tryRunProfile() {
    try {
        const raw = execSync('npm run council:perf:snapshot -- --quick --raw', {
            encoding: 'utf8', timeout: 180_000, stdio: 'pipe', cwd: ROOT,
        });
        const data = JSON.parse(raw);
        return { source: 'npm_run_profile', data };
    } catch {
        return null;
    }
}

function staticFallback() {
    const distDir = join(ROOT, 'dist', 'assets');
    if (!existsSync(distDir)) return null;

    const jsFiles = readdirSync(distDir)
        .filter((f) => f.endsWith('.js'))
        .map((f) => {
            const s = statSync(join(distDir, f));
            return { name: f, sizeKb: Math.round(s.size / 1024) };
        })
        .sort((a, b) => b.sizeKb - a.sizeKb)
        .slice(0, 10);

    const topFiles = jsFiles.map((f) => f.name);
    const totalJsKb = jsFiles.reduce((sum, f) => sum + f.sizeKb, 0);

    return {
        source: 'static_fallback',
        data: {
            generatedAt: new Date().toISOString(),
            config: { method: 'static', distFiles: jsFiles.length },
            snapshot: {
                frameMs: { avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 },
                subsystems: {},
                spikes: { recent: 0, events: [] },
            },
            static: { topFiles, totalJsKb },
        },
    };
}

ensureDir();

let result = tryRunProfile();
if (!result) result = staticFallback();

if (result) {
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(result, null, 2), 'utf8');
    process.stdout.write(`VERDICT: SNAPSHOT_READY (${result.source})\n`);
    process.stdout.write(`Snapshot: ${SNAPSHOT_FILE}\n`);
} else {
    const empty = {
        source: 'no_data',
        data: {
            generatedAt: new Date().toISOString(),
            config: { method: 'none' },
            snapshot: { frameMs: {}, subsystems: {}, spikes: { recent: 0, events: [] } },
        },
    };
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(empty, null, 2), 'utf8');
    process.stdout.write('VERDICT: NO_DATA (weder Profiler noch dist/ vorhanden)\n');
    process.stdout.write(`Snapshot: ${SNAPSHOT_FILE}\n`);
}
