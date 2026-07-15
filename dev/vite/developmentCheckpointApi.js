import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function safeReadJson(filePath) {
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}
function createJsonResponse(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
}

export function developmentCheckpointApiPlugin() {
    const CHECKPOINT_API_PATH = '/api/bot/latest-checkpoint';
    const LATEST_INDEX_PATH = path.resolve(__dirname, 'data', 'training', 'runs', 'latest.json');

    function resolveCheckpointFromIndex() {
        const indexJson = safeReadJson(LATEST_INDEX_PATH);
        const checkpointRelPath = indexJson?.artifacts?.checkpoint?.path
            || indexJson?.checkpointPath
            || null;
        if (typeof checkpointRelPath !== 'string' || !checkpointRelPath.trim()) return null;
        const absPath = path.resolve(__dirname, checkpointRelPath.trim());
        if (!existsSync(absPath)) return null;
        const raw = safeReadJson(absPath);
        if (!raw) return null;
        if (raw.checkpoint && typeof raw.checkpoint === 'object') return raw.checkpoint;
        if (raw.contractVersion === 'v35-dqn-checkpoint-v1' || raw.contractVersion === 'v34-dqn-checkpoint-v1') return raw;
        return null;
    }

    const registerMiddleware = (middlewares) => {
        middlewares.use((req, res, next) => {
            const reqPath = String(req.url || '').split('?')[0];
            if (req.method !== 'GET' || reqPath !== CHECKPOINT_API_PATH) {
                next();
                return;
            }
            const checkpoint = resolveCheckpointFromIndex();
            if (!checkpoint) {
                createJsonResponse(res, 404, { ok: false, error: 'no-checkpoint-available' });
                return;
            }
            createJsonResponse(res, 200, { ok: true, checkpoint });
        });
    };

    return {
        name: 'development-checkpoint-api',
        configureServer(server) {
            registerMiddleware(server.middlewares);
        },
    };
}
