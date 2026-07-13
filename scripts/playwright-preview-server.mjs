import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function readArg(flag, fallback = '') {
    const index = process.argv.indexOf(flag);
    if (index === -1) return fallback;
    return String(process.argv[index + 1] || '').trim() || fallback;
}

function sanitizeRunTag(value) {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || 'playwright';
}

function pipeChildOutput(child, outLogStream, errLogStream) {
    child.stdout?.on('data', (chunk) => {
        process.stdout.write(chunk);
        outLogStream.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
        process.stderr.write(chunk);
        errLogStream.write(chunk);
    });
}

function spawnNodeCommand(args, outLogStream, errLogStream) {
    const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: process.env,
    });
    pipeChildOutput(child, outLogStream, errLogStream);
    return child;
}

function runCommand(args, label, outLogStream, errLogStream) {
    return new Promise((resolve, reject) => {
        const child = spawnNodeCommand(args, outLogStream, errLogStream);

        child.once('error', (error) => {
            reject(new Error(`[playwright-preview-server] ${label} failed to start: ${error.message}`));
        });
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`[playwright-preview-server] ${label} exited via signal ${signal}`));
                return;
            }
            if ((code ?? 1) !== 0) {
                reject(new Error(`[playwright-preview-server] ${label} exited with code ${code ?? 1}`));
                return;
            }
            resolve();
        });
    });
}

function closeStream(stream) {
    return new Promise((resolve) => {
        stream.end(resolve);
    });
}

const host = readArg('--host', String(process.env.TEST_HOST || '127.0.0.1').trim() || '127.0.0.1');
const port = readArg('--port', String(process.env.TEST_PORT || '5173').trim() || '5173');
const runTag = sanitizeRunTag(process.env.PW_RUN_TAG || 'playwright');
const runProfile = String(process.env.PW_RUN_PROFILE || 'preview-smoke').trim() || 'preview-smoke';
const hasExplicitAppMode = String(process.env.VITE_APP_MODE || '').trim().length > 0;
if (!hasExplicitAppMode) {
    process.env.VITE_APP_MODE = runProfile.startsWith('desktop-') ? 'app' : 'web';
}
const appMode = String(process.env.VITE_APP_MODE || 'web').trim() || 'web';
const outLogPath = path.resolve(
    process.cwd(),
    readArg('--out-log', String(process.env.PW_SERVER_LOG_OUT || `tmp-vite-${runTag}.out.log`).trim())
);
const errLogPath = path.resolve(
    process.cwd(),
    readArg('--err-log', String(process.env.PW_SERVER_LOG_ERR || `tmp-vite-${runTag}.err.log`).trim())
);
const viteCliPath = path.resolve('node_modules', 'vite', 'bin', 'vite.js');
const outLogStream = createWriteStream(outLogPath, { flags: 'w' });
const errLogStream = createWriteStream(errLogPath, { flags: 'w' });

outLogStream.write(
    `[playwright-preview-server] runProfile=${runProfile} appMode=${appMode} ` +
    `runTag=${runTag} host=${host} port=${port}\n`
);
errLogStream.write(
    `[playwright-preview-server] runProfile=${runProfile} appMode=${appMode} ` +
    `runTag=${runTag} host=${host} port=${port}\n`
);

let previewProcess = null;

try {
    await runCommand([viteCliPath, 'build'], 'vite build', outLogStream, errLogStream);

    previewProcess = spawnNodeCommand([
        viteCliPath,
        'preview',
        '--host',
        host,
        '--port',
        port,
        '--strictPort',
    ], outLogStream, errLogStream);

    const forwardSignal = (signal) => {
        if (previewProcess?.exitCode === null) {
            previewProcess.kill(signal);
        }
    };

    process.once('SIGINT', forwardSignal);
    process.once('SIGTERM', forwardSignal);

    await new Promise((resolve, reject) => {
        previewProcess.once('error', (error) => {
            reject(new Error(`[playwright-preview-server] vite preview failed to start: ${error.message}`));
        });
        previewProcess.once('exit', (code, signal) => {
            process.removeListener('SIGINT', forwardSignal);
            process.removeListener('SIGTERM', forwardSignal);
            if (signal) {
                reject(new Error(`[playwright-preview-server] vite preview exited via signal ${signal}`));
                return;
            }
            resolve(code ?? 0);
        });
    });
} finally {
    await Promise.all([
        closeStream(outLogStream),
        closeStream(errLogStream),
    ]);
}
