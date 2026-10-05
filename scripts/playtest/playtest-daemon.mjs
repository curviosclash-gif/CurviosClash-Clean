// Keeps one desktop app open and runs playtest steps sent by playtest-client.mjs, so an
// agent can play step by step without relaunching Electron for every check. For agents
// that speak MCP, playtest-mcp.mjs offers the same building blocks as typed tools.
//
//   npm run build:app:test
//   npm run playtest:daemon            (holds the Playwright lock until quit)
//   npm run playtest:send -- step.mjs  (file body = async function body with D, S, state, relaunch)
//   npm run playtest:send -- --quit
//
// Every request needs the session token from the daemon state file; requests with an
// Origin header are refused, so no web page can reach this endpoint. A step that runs
// longer than CURVIOS_PLAYTEST_STEP_TIMEOUT_MS (default 5 min) is stopped by relaunching
// the app; a crashed app is relaunched before the next step.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import * as D from './playtest-driver.mjs';
import { isAuthorizedPlaytestRequest, resolveDaemonStateFile, withTimeout } from './playtest-support.mjs';

const port = Number(process.env.CURVIOS_PLAYTEST_PORT) || 47123;
const stepTimeoutMs = Number(process.env.CURVIOS_PLAYTEST_STEP_TIMEOUT_MS) || 300_000;
const token = randomBytes(24).toString('hex');
const stateFile = resolveDaemonStateFile();
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const lock = await D.acquireLock('playtest daemon');
let session = await D.launchApp({ visible: process.env.CURVIOS_PLAYTEST_VISIBLE === '1' });
const state = {};
let busy = false;
let stopping = false;

async function shutdown(server, code = 0) {
    if (stopping) return;
    stopping = true;
    server.close();
    await D.closeApp(session);
    await fs.rm(stateFile, { force: true });
    lock.release();
    process.exit(code);
}

const server = http.createServer(async (request, response) => {
    if (!isAuthorizedPlaytestRequest(request, token)) {
        response.statusCode = 403;
        response.end('forbidden');
        return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    if (request.url === '/quit') {
        response.end('bye');
        await shutdown(server);
        return;
    }
    if (busy) {
        response.statusCode = 409;
        response.end('busy');
        return;
    }
    busy = true;
    try {
        if (session.closed) {
            console.error('[playtest] app was closed or crashed; relaunching before this step');
            session = await D.relaunchApp(session);
            response.setHeader('x-playtest-relaunched', '1');
        }
        const relaunch = async () => {
            session = await D.relaunchApp(session);
            return 'relaunched';
        };
        const step = new AsyncFunction('D', 'S', 'state', 'relaunch', body);
        const result = await withTimeout(step(D, session, state, relaunch), stepTimeoutMs);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(result ?? null, null, 1));
    } catch (error) {
        if (error?.code === 'PLAYTEST_TIMEOUT') {
            // JavaScript cannot cancel a running step; a fresh app ends it for good.
            session = await D.relaunchApp(session).catch((relaunchError) => {
                console.error(`[playtest] relaunch after timeout failed: ${relaunchError?.message || relaunchError}`);
                return session;
            });
            response.statusCode = 504;
            response.end(`${error.message}; the app was relaunched, state from the step is gone`);
            return;
        }
        response.statusCode = 500;
        response.end(String(error?.stack || error));
    } finally {
        busy = false;
    }
});

server.on('error', (error) => {
    console.error(`[playtest] control server failed: ${error?.message || error}`);
    shutdown(server, 1);
});

server.listen(port, '127.0.0.1', async () => {
    await fs.writeFile(stateFile, JSON.stringify({ port, token, pid: process.pid, outDir: D.OUT_DIR }), { encoding: 'utf8', mode: 0o600 });
    console.log(`[playtest] ready on 127.0.0.1:${port}, output ${D.OUT_DIR}, step timeout ${stepTimeoutMs} ms`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { shutdown(server); });
}
