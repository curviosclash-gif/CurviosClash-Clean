// Map balancing for agents: operation "balancing" of the curvios-playtest MCP server.
// File scope reads and writes data/balancing without a running game (no machine lock);
// live scope changes the match in the open test session through GAME_DEBUG.getMapBalancingLive().
// Every write goes through MapBalancingContract via the shared electron/map-balancing-store.cjs.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMapBalancingStore, resolveMapBalancingStoreRoot } = require('../../electron/map-balancing-store.cjs');

export const BALANCING_ACTIONS = Object.freeze(['list_maps', 'get', 'set', 'reset', 'save', 'discard', 'authoritative']);
export const BALANCING_MODES = Object.freeze(['normal', 'fight', 'arcade']);
const LIVE_ONLY = new Set(['save', 'discard', 'authoritative']);
const WRITING = new Set(['set', 'reset', 'save', 'discard', 'authoritative']);

/** @param {{ repoRoot: string, env?: Record<string, string | undefined> }} options */
export function createBalancingStoreForRepo({ repoRoot, env = process.env }) {
    return createMapBalancingStore(resolveMapBalancingStoreRoot({ isPackaged: false, projectRoot: env.CURVIOS_MAP_BALANCING_ROOT || repoRoot }));
}

/** MCP values arrive as strings, numbers or booleans; the contract wants numbers or booleans. */
export function coerceBalancingValue(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === 'on') return true;
    if (trimmed === 'false' || trimmed === 'off') return false;
    const parsed = Number(trimmed);
    return trimmed !== '' && Number.isFinite(parsed) ? parsed : value;
}

function blocked(message) {
    return Object.assign(new Error(message), { status: 'blocked' });
}

async function callLive(session, op, payload) {
    const result = await session.page.evaluate(({ op: liveOp, payload: livePayload }) => {
        const api = globalThis.GAME_DEBUG?.getMapBalancingLive?.();
        if (!api) return { ok: false, reason: 'no_live_api', detail: 'GAME_DEBUG.getMapBalancingLive fehlt: npm run build:app:test neu bauen.' };
        switch (liveOp) {
            case 'get': return api.describe({ mapKey: livePayload.mapKey, modePath: livePayload.modePath });
            case 'set': return api.setValue(livePayload.field, livePayload.value, { mapKey: livePayload.mapKey });
            case 'reset': return api.resetValue(livePayload.field, { mapKey: livePayload.mapKey });
            case 'discard': return api.discard({ mapKey: livePayload.mapKey });
            case 'mark-saved': return api.markSaved(livePayload.mapKey, livePayload.layer);
            case 'authoritative': return api.setAuthoritative(livePayload.value);
            default: return { ok: false, reason: 'unknown_op' };
        }
    }, { op, payload });
    if (!result || result.ok !== true) {
        throw Object.assign(new Error(result?.detail || result?.reason || 'live balancing failed'), { status: 'failed' });
    }
    return result;
}

function compact(description) {
    if (!description || !Array.isArray(description.fields)) return description;
    return {
        ...description,
        fields: description.fields.map((row) => ({
            key: row.key, group: row.group, value: row.value, origin: row.origin, mapValue: row.mapValue,
            inherited: row.inherited, min: row.min, max: row.max, step: row.step,
        })),
    };
}

/**
 * @param {{ args: any, store: any, getSession: () => any, recordIntervention?: (session: any, entry: object) => void }} options
 */
export async function runBalancingOperation({ args, store, getSession, recordIntervention = () => {} }) {
    const action = String(args.balancingAction || 'get');
    if (!BALANCING_ACTIONS.includes(action)) throw new Error(`unknown balancingAction ${action}; use ${BALANCING_ACTIONS.join(', ')}`);
    const scope = args.scope || (LIVE_ONLY.has(action) ? 'live' : 'file');
    const mapKey = typeof args.map === 'string' ? args.map : '';
    const modePath = BALANCING_MODES.includes(args.modePath) ? args.modePath : undefined;
    const field = typeof args.field === 'string' ? args.field : '';
    const value = coerceBalancingValue(args.value);

    if (action === 'list_maps') {
        if (!store.writable) throw blocked(store.message);
        return { action, scope: 'file', maps: await store.listMaps() };
    }
    if ((action === 'set' || action === 'reset') && !field) throw new Error(`balancing ${action} needs field`);
    if (action === 'set' && value === undefined) throw new Error('balancing set needs value');

    if (scope === 'file') {
        if (LIVE_ONLY.has(action)) throw new Error(`balancing ${action} works on the running game only (scope live)`);
        if (!store.writable) throw blocked(store.message);
        if (!mapKey) throw new Error(`balancing ${action} with scope file needs map`);
        if (action === 'set') await store.setValue(mapKey, field, value);
        if (action === 'reset') await store.resetValue(mapKey, field);
        return { action, scope, description: compact(await store.describe({ mapKey, modePath })) };
    }

    const session = getSession();
    const payload = { mapKey, modePath, field, value };
    if (action === 'save') {
        if (!store.writable) throw blocked(store.message);
        const live = await callLive(session, 'get', payload);
        const saved = await store.saveMapLayer(live.value.mapKey, live.value.layer);
        const marked = await callLive(session, 'mark-saved', { mapKey: live.value.mapKey, layer: saved.layer });
        recordIntervention(session, { helper: 'balancing_save', args: { map: live.value.mapKey, path: saved.path } });
        return { action, scope, saved: { path: saved.path, backupPath: saved.backupPath, removed: saved.removed }, description: compact(marked.value) };
    }
    const result = await callLive(session, action, payload);
    if (WRITING.has(action)) recordIntervention(session, { helper: `balancing_${action}`, args: { map: result.value.mapKey, field, value } });
    return { action, scope, liveApplied: result.liveApplied === true, description: compact(result.value) };
}
