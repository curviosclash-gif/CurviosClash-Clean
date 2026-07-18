const http = require('node:http');
const path = require('node:path');
const { createReadStream, existsSync, readFileSync } = require('node:fs');
const { access, constants: fsConstants } = require('node:fs/promises');

const MIME_TYPES = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
});

function sendText(res, statusCode, message) {
    res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(message);
}

function toFilePath(rootDir, requestPath) {
    const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
    const resolvedRoot = path.resolve(rootDir);
    const resolvedPath = path.resolve(rootDir, `.${normalizedPath}`);

    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
        return null;
    }

    return resolvedPath;
}

function resolveDesktopConnectSources(rootDir) {
    const sources = ["'self'", 'http://*:*', 'ws://127.0.0.1:*', 'ws://localhost:*'];
    try {
        const policy = JSON.parse(readFileSync(path.join(rootDir, 'desktop-network-policy.json'), 'utf8'));
        const origin = new URL(String(policy?.signalingOrigin || '')).origin;
        if ((origin.startsWith('ws://') || origin.startsWith('wss://')) && !sources.includes(origin)) {
            sources.push(origin);
        }
    } catch {
        // Online signaling stays disabled when no build-time origin is present.
    }
    return sources;
}

function createCspHeader(connectSources) {
    return [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        `connect-src ${connectSources.join(' ')}`,
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-src 'none'",
        "form-action 'none'",
    ].join('; ');
}

function createStaticRequestHandler(rootDir) {
    const cspHeader = createCspHeader(resolveDesktopConnectSources(rootDir));
    return async (req, res) => {
        try {
            const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
            const filePath = toFilePath(rootDir, decodeURIComponent(requestUrl.pathname || '/'));

            if (!filePath) {
                sendText(res, 403, '403 - Zugriff verweigert');
                return;
            }

            try {
                await access(filePath, fsConstants.R_OK);
            } catch {
                sendText(res, 404, '404 - Nicht gefunden');
                return;
            }

            const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
            const headers = { 'Content-Type': contentType };
            if (contentType.startsWith('text/html')) {
                headers['Content-Security-Policy'] = cspHeader;
            }
            res.writeHead(200, headers);
            const stream = createReadStream(filePath);
            stream.on('error', () => {
                if (!res.headersSent) {
                    sendText(res, 500, '500 - Interner Serverfehler');
                } else {
                    res.end();
                }
            });
            stream.pipe(res);
        } catch {
            if (!res.headersSent) {
                sendText(res, 500, '500 - Interner Serverfehler');
            }
        }
    };
}

function closeServer(server) {
    return new Promise((resolve) => {
        try {
            server.close(() => resolve());
        } catch {
            resolve();
        }
    });
}

async function startStaticServer({ rootDir, host = '127.0.0.1', port = 0 }) {
    const resolvedRoot = path.resolve(rootDir);
    const indexPath = path.join(resolvedRoot, 'index.html');

    if (!existsSync(indexPath)) {
        throw new Error(`Desktop-App-Build fehlt: ${indexPath}`);
    }

    const server = http.createServer(createStaticRequestHandler(resolvedRoot));

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.removeListener('error', reject);
            resolve();
        });
    });

    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : port;

    return {
        host,
        port: actualPort,
        server,
        url: `http://${host}:${actualPort}`,
        close: () => closeServer(server),
    };
}

module.exports = {
    startStaticServer,
};
