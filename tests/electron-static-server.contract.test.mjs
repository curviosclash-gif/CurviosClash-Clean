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
        await writeFile(
            path.join(rootDir, 'desktop-network-policy.json'),
            JSON.stringify({ signalingOrigin: 'wss://signal.example.test' }),
            'utf8',
        );
        server = await startStaticServer({ rootDir, port: 0 });

        const response = await fetch(server.url);
        const csp = response.headers.get('content-security-policy') || '';
        const connectSrc = csp.split(';').find((part) => part.trim().startsWith('connect-src')) || '';

        assert.match(csp, /connect-src[^;]*'self'/);
        assert.match(connectSrc, /http:\/\/\*:\*/);
        assert.match(connectSrc, /ws:\/\/127\.0\.0\.1:\*/);
        assert.match(connectSrc, /wss:\/\/signal\.example\.test/);
        assert.doesNotMatch(connectSrc, /ws:\/\/\*:\*/);
        assert.doesNotMatch(connectSrc, /wss:\/\/\*:\*/);
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

test('desktop static server CSP allows GLB texture and embedded map fetches', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'curvios-static-csp-glb-'));
    let server = null;
    try {
        await writeFile(path.join(rootDir, 'index.html'), '<!doctype html><title>Curvios</title>', 'utf8');
        server = await startStaticServer({ rootDir, port: 0 });

        const response = await fetch(server.url);
        const csp = response.headers.get('content-security-policy') || '';
        const directives = csp.split(';').map((part) => part.trim());
        const connectSrc = directives.find((part) => part.startsWith('connect-src')) || '';
        const connectTokens = connectSrc.split(/\s+/).slice(1);

        // GLTFLoader fetches embedded textures from blob: URLs and embedded maps from data: URLs.
        assert.ok(connectTokens.includes('blob:'), `connect-src is missing blob:: ${connectSrc}`);
        assert.ok(connectTokens.includes('data:'), `connect-src is missing data:: ${connectSrc}`);

        // The relaxation stays confined to connect-src.
        assert.ok(directives.includes("default-src 'self'"), csp);
        assert.ok(directives.includes("script-src 'self' 'unsafe-inline'"), csp);
        assert.ok(directives.includes("object-src 'none'"), csp);
    } finally {
        await server?.close?.();
        await rm(rootDir, { recursive: true, force: true });
    }
});
