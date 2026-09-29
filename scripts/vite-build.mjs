import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// `vite build` with the esbuild stream fallback preloaded (see esbuild-stream-fallback.cjs).
const require = createRequire(import.meta.url);
const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const fallback = fileURLToPath(new URL('./esbuild-stream-fallback.cjs', import.meta.url));

const result = spawnSync(process.execPath, ['--require', fallback, vite, 'build', ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true,
});
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
