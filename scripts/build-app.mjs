import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const fallback = fileURLToPath(new URL('./esbuild-stream-fallback.cjs', import.meta.url));
const boundary = fileURLToPath(new URL('./check-production-training-boundary.mjs', import.meta.url));

for (const args of [
    ['--require', fallback, vite, 'build', '--mode', 'app'],
    [boundary, 'dist-app'],
]) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.signal) process.kill(process.pid, result.signal);
    if (result.status !== 0) process.exit(result.status ?? 1);
}
