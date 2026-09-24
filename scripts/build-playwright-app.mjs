import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const env = {
    ...process.env,
    CURVIOS_E2E_BUILD: '1',
    PW_RUN_TAG: String(process.env.PW_RUN_TAG || `desktop-test-build-${process.pid}`),
};

for (const args of [
    [path.resolve('node_modules/vite/bin/vite.js'), 'build', '--mode', 'app'],
    [path.resolve('scripts/check-production-training-boundary.mjs'), 'dist-app-test'],
]) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', env, windowsHide: true });
    if (result.error) throw result.error;
    if (result.signal) process.kill(process.pid, result.signal);
    if (result.status !== 0) process.exit(result.status ?? 1);
}
