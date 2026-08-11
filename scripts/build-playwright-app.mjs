import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCli = String(process.env.npm_execpath || '').trim();
if (!npmCli) {
    throw new Error('npm_execpath fehlt; starte den Test-Build ueber npm run build:app:test.');
}

const child = spawn(process.execPath, [npmCli, 'run', 'build:app'], {
    stdio: 'inherit',
    env: {
        ...process.env,
        PW_RUN_TAG: String(process.env.PW_RUN_TAG || `desktop-test-build-${process.pid}`),
    },
    windowsHide: true,
});

child.on('error', (error) => {
    console.error(`[playwright:build] Desktop-Test-Build konnte nicht gestartet werden: ${error.message}`);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
