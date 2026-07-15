import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function createJsonResponse(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
}
export function playwrightHealthApiPlugin() {
    const HEALTH_PATH = '/_pw/health';

    const registerMiddleware = (middlewares) => {
        middlewares.use((req, res, next) => {
            const reqPath = String(req.url || '').split('?')[0];
            if (req.method !== 'GET' || reqPath !== HEALTH_PATH) {
                next();
                return;
            }
            createJsonResponse(res, 200, { ok: true, service: 'vite', path: HEALTH_PATH });
        });
    };

    return {
        name: 'playwright-health-api',
        configureServer(server) {
            registerMiddleware(server.middlewares);
        },
        configurePreviewServer(server) {
            registerMiddleware(server.middlewares);
        },
    };
}

export function playwrightTestRuntimeBridgePlugin(env = process.env) {
    const enabled = !!env?.PW_RUN_TAG;
    const appInitializerPath = path.resolve(__dirname, 'src', 'core', 'AppInitializerLifecycle.js');
    const testBridgePath = path.resolve(__dirname, 'tests', 'support', 'E2ETestRuntimeBridge.js');
    const normalizeModuleId = (value) => String(value || '')
        .split('?')[0]
        .replace(/\\/g, '/')
        .toLowerCase();
    const normalizedInitializerPath = normalizeModuleId(appInitializerPath);

    return {
        name: 'playwright-test-runtime-bridge',
        enforce: 'pre',
        resolveId(source, importer) {
            if (!enabled || source !== './E2ETestRuntimeBridge.js') return null;
            if (normalizeModuleId(importer) !== normalizedInitializerPath) return null;
            return testBridgePath;
        },
    };
}
