// Round telemetry for agents: operation "telemetry" of the curvios-playtest MCP server.
// Reads the open test session's telemetry through GAME_DEBUG.getTelemetry(): overview with
// filters, or an export written next to the run. Clearing stays a human decision (F7 console).
// Without a session, `npm run telemetry:report` reads the desktop history from disk.

import fs from 'node:fs/promises';
import path from 'node:path';

export const TELEMETRY_ACTIONS = Object.freeze(['overview', 'export']);

async function callLive(session, op, payload) {
    const result = await session.page.evaluate(async ({ op: liveOp, payload: livePayload }) => {
        const api = globalThis.GAME_DEBUG?.getTelemetry?.();
        if (!api) return { ok: false, detail: 'GAME_DEBUG.getTelemetry fehlt: npm run build:app:test neu bauen.' };
        try {
            if (liveOp === 'overview') return { ok: true, value: await api.overview(livePayload.filters) };
            if (liveOp === 'export') return { ok: true, value: await api.exportData(livePayload.filters, livePayload.format) };
            return { ok: false, detail: `unknown op ${liveOp}` };
        } catch (error) {
            return { ok: false, detail: String(error?.message || error) };
        }
    }, { op, payload });
    if (!result || result.ok !== true) throw Object.assign(new Error(result?.detail || 'telemetry failed'), { status: 'failed' });
    return result.value;
}

/**
 * @param {{ args: any, getSession: () => any, runDir?: string }} options
 */
export async function runTelemetryOperation({ args, getSession, runDir = '' }) {
    const action = String(args.telemetryAction || 'overview');
    if (!TELEMETRY_ACTIONS.includes(action)) throw new Error(`unknown telemetryAction ${action}; use ${TELEMETRY_ACTIONS.join(', ')}`);
    const filters = args.filters && typeof args.filters === 'object' ? args.filters : {};
    const session = getSession();
    if (action === 'overview') return { action, ...(await callLive(session, 'overview', { filters })) };
    const format = args.format === 'csv' ? 'csv' : 'json';
    const exported = await callLive(session, 'export', { filters, format });
    const target = path.join(runDir || process.cwd(), exported.fileName);
    await fs.writeFile(target, exported.text, 'utf8');
    return { action, format, rounds: exported.rounds, file: target };
}
