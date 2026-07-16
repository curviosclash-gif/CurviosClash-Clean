import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer } = require('../electron/static-server.cjs');

test('desktop static server CSP allows LAN HTTP lobby requests', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'curvios-static-csp-'));
    let server = null;
    try {
        await writeFile(path.join(rootDir, 'index.html'), '<!doctype html><title>Curvios</title>', 'utf8');
        server = await startStaticServer({ rootDir, port: 0 });

        const response = await fetch(server.url);
        const csp = response.headers.get('content-security-policy') || '';
        const connectSrc = csp.split(';').find((part) => part.trim().startsWith('connect-src')) || '';

        assert.match(csp, /connect-src[^;]*'self'/);
        assert.match(connectSrc, /http:\/\/\*:\*/);
        assert.match(connectSrc, /ws:\/\/\*:\*/);
        assert.match(connectSrc, /wss:\/\/\*:\*/);
        assert.equal(connectSrc.trim().split(/\s+/).includes('http:'), false);
        assert.equal(connectSrc.trim().split(/\s+/).includes('ws:'), false);
        assert.equal(connectSrc.trim().split(/\s+/).includes('wss:'), false);
        assert.match(csp, /frame-src 'none'/);
        assert.match(csp, /form-action 'none'/);
    } finally {
        await server?.close?.();
        await rm(rootDir, { recursive: true, force: true });
    }
});
