import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isPortUnavailable, startStaticServer } = require('../electron/static-server.cjs');

function hashSource(text) {
    return `'sha256-${createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`;
}

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
        assert.match(csp, /script-src 'self'(?:\s|;|$)/);
        assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
        assert.match(csp, /style-src 'self' 'unsafe-inline'/);
        assert.match(csp, /frame-src 'none'/);
        assert.match(csp, /frame-ancestors 'none'/);
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
        assert.ok(directives.includes("script-src 'self'"), csp);
        assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
        assert.ok(directives.includes("object-src 'none'"), csp);
    } finally {
        await server?.close?.();
        await rm(rootDir, { recursive: true, force: true });
    }
});

test('desktop static server hashes only the exact inline script text for each HTML page', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'curvios-static-csp-hashes-'));
    let server = null;
    try {
        const indexHtml = '<!doctype html><script type="importmap">\r\n{"imports":{}}\r\n</script><script src="/app.js"></script>';
        const hangarHtml = '<!doctype html><script>window.hangarReady = true;</script>';
        const emptyHtml = '<!doctype html><script src="/external.js"></script>';
        await Promise.all([
            writeFile(path.join(rootDir, 'index.html'), indexHtml, 'utf8'),
            writeFile(path.join(rootDir, 'hangar.html'), hangarHtml, 'utf8'),
            writeFile(path.join(rootDir, 'empty.html'), emptyHtml, 'utf8'),
        ]);
        server = await startStaticServer({ rootDir, port: 0 });

        const policies = new Map();
        for (const [page, html] of [['/', indexHtml], ['/hangar.html', hangarHtml], ['/empty.html', emptyHtml]]) {
            const response = await fetch(new URL(page, server.url));
            const csp = response.headers.get('content-security-policy') || '';
            const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src')) || '';
            const expectedHashes = [...html.replace(/\r\n?/g, '\n').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
                .filter((match) => !/(?:^|\s)src(?:\s|=|$)/i.test(match[1]))
                .map((match) => hashSource(match[2]));

            assert.doesNotMatch(scriptSrc, /'unsafe-inline'/, `${page}: ${scriptSrc}`);
            for (const hash of expectedHashes) assert.ok(scriptSrc.split(/\s+/).includes(hash), `${page}: missing ${hash}`);
            assert.equal(scriptSrc.split(/\s+/).includes(hashSource('window.untrusted = true;')), false);
            assert.match(csp, /style-src 'self' 'unsafe-inline'/);
            policies.set(page, scriptSrc);
        }

        assert.notEqual(policies.get('/'), policies.get('/hangar.html'));
        assert.equal(policies.get('/empty.html'), "script-src 'self'");
    } finally {
        await server?.close?.();
        await rm(rootDir, { recursive: true, force: true });
    }
});

test('a port the system refuses falls back like an occupied one', () => {
    // Windows reserves ports for itself (5357 for device discovery, whole Hyper-V ranges that
    // change per boot). Listening there fails with EACCES, and the app used to end its start
    // with an error box instead of taking a free port.
    for (const code of ['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL']) {
        assert.equal(isPortUnavailable(Object.assign(new Error(code), { code })), true, code);
    }
    for (const code of ['EPERM', 'ENOENT', undefined]) {
        assert.equal(isPortUnavailable(Object.assign(new Error('other'), { code })), false, String(code));
    }
    assert.equal(isPortUnavailable(null), false);
});
