// Keeps one desktop app open and runs playtest steps sent by playtest-client.mjs, so an
// agent can play step by step without relaunching Electron for every check.
//
//   npm run build:app:test
//   npm run playtest:daemon            (holds the Playwright lock until quit)
//   npm run playtest:send -- step.mjs  (file body = async function body with D, S, state, relaunch)
//   npm run playtest:send -- --quit
//
// Every request needs the session token from daemon.json in the output folder; requests
// with an Origin header are refused, so no web page can reach this endpoint.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import * as D from './playtest-driver.mjs';
import { isAuthorizedPlaytestRequest } from './playtest-support.mjs';

const port = Number(process.env.CURVIOS_PLAYTEST_PORT) || 47123;
const token = randomBytes(24).toString('hex');
const stateFile = path.join(D.OUT_DIR, 'daemon.json');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const lock = await D.acquireLock('playtest daemon');
let session = await D.launchApp({ visible: process.env.CURVIOS_PLAYTEST_VISIBLE === '1' });
const state = {};
let busy = false;

async function shutdown(server) {
    server.close();
    await D.closeApp(session);
    await fs.rm(stateFile, { force: true });
    lock.release();
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
        process.exit(0);
    }
    if (busy) {
        response.statusCode = 409;
        response.end('busy');
        return;
    }
    busy = true;
    try {
        const relaunch = async () => {
            await D.closeApp(session);
            session = await D.launchApp();
            return 'relaunched';
        };
        const step = new AsyncFunction('D', 'S', 'state', 'relaunch', body);
        const result = await step(D, session, state, relaunch);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(result ?? null, null, 1));
    } catch (error) {
        response.statusCode = 500;
        response.end(String(error?.stack || error));
    } finally {
        busy = false;
    }
});

server.listen(port, '127.0.0.1', async () => {
    await fs.writeFile(stateFile, JSON.stringify({ port, token, pid: process.pid }), { encoding: 'utf8', mode: 0o600 });
    console.log(`[playtest] ready on 127.0.0.1:${port}, output ${D.OUT_DIR}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { shutdown(server).finally(() => process.exit(0)); });
}
