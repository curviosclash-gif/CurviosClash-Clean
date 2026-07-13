import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import net from 'node:net';
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

function probeTcpPort(host, port, timeoutMs = 250) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timer = setTimeout(() => {
            socket.destroy();
            resolve({ open: false, error: 'timeout' });
        }, timeoutMs);

        socket.once('error', (error) => {
            clearTimeout(timer);
            socket.destroy();
            const code = String(error?.code || '');
            if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
                resolve({ open: false, error: code || 'refused' });
                return;
            }
            resolve({ open: false, error: code || 'error' });
        });

        socket.connect(Number(port), host, () => {
            clearTimeout(timer);
            socket.end();
            resolve({ open: true, error: null });
        });
    });
}

async function waitForHttpReady(url, timeoutMs, outLogStream) {
    const startedAt = Date.now();
    let delayMs = 150;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(new Error('probe-timeout')), 2_000);
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    cache: 'no-store',
                    signal: controller.signal,
                    headers: { 'cache-control': 'no-store' },
                });
                if (response && response.ok) {
                    outLogStream.write(`[playwright-dev-server] http-ready url=${url} status=${response.status}\n`);
                    return true;
                }
            } finally {
                clearTimeout(timer);
            }
        } catch {
            // ignore
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(1_000, Math.round(delayMs * 1.3));
    }
    outLogStream.write(`[playwright-dev-server] http-not-ready url=${url} timeoutMs=${timeoutMs}\n`);
    return false;
}

function closeStream(stream) {
    return new Promise((resolve) => {
        stream.end(resolve);
    });
}

const host = readArg('--host', String(process.env.TEST_HOST || '127.0.0.1').trim() || '127.0.0.1');
const port = readArg('--port', String(process.env.TEST_PORT || '5173').trim() || '5173');
const runTag = sanitizeRunTag(process.env.PW_RUN_TAG || 'playwright');
const runProfile = String(process.env.PW_RUN_PROFILE || 'dev-runtime').trim() || 'dev-runtime';
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

outLogStream.write(`[playwright-dev-server] runProfile=${runProfile} runTag=${runTag} host=${host} port=${port}\n`);
errLogStream.write(`[playwright-dev-server] runProfile=${runProfile} runTag=${runTag} host=${host} port=${port}\n`);
outLogStream.write(`[playwright-dev-server] viteCliPath=${viteCliPath}\n`);

let devProcess = null;

try {
    const tcpProbe = await probeTcpPort(host, port, 300);
    if (tcpProbe.open) {
        throw new Error(
            `[playwright-dev-server] Port already in use host=${host} port=${port}. ` +
            `Set PW_BASE_PORT/PW_PORT_SPAN or free the port.`
        );
    }

    devProcess = spawnNodeCommand([
        viteCliPath,
        '--host',
        host,
        '--port',
        port,
        '--strictPort',
        '--clearScreen',
        'false',
        '--logLevel',
        'error',
    ], outLogStream, errLogStream);

    outLogStream.write(`[playwright-dev-server] vitePid=${devProcess.pid}\n`);

    const forwardSignal = (signal) => {
        if (devProcess?.exitCode === null) {
            devProcess.kill(signal);
        }
    };

    process.once('SIGINT', forwardSignal);
    process.once('SIGTERM', forwardSignal);

    await waitForHttpReady(`http://${host}:${port}/_pw/health`, 30_000, outLogStream);
    await waitForHttpReady(`http://${host}:${port}/`, 60_000, outLogStream);
    await waitForHttpReady(`http://${host}:${port}/src/core/main.js`, 60_000, outLogStream);

    await new Promise((resolve, reject) => {
        devProcess.once('error', (error) => {
            reject(new Error(`[playwright-dev-server] vite failed to start: ${error.message}`));
        });
        devProcess.once('exit', (code, signal) => {
            process.removeListener('SIGINT', forwardSignal);
            process.removeListener('SIGTERM', forwardSignal);
            if (signal) {
                reject(new Error(`[playwright-dev-server] vite exited via signal ${signal}`));
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
