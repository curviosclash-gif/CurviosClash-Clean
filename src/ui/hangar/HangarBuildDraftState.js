import {
    HANGAR_SLOT_DEFINITIONS,
    createDefaultHangarSlots,
    resolveHangarPart,
    resolveLegacyHangarStoneId,
    resolveHangarSlot,
} from './HangarPartCatalog.js';
import { DEFAULT_FIGHT_MACHINE_GUN_ID, normalizeFightMachineGunId } from '../../shared/contracts/FightMachineGunContract.js';

export const HANGAR_BUILD_SCHEMA_VERSION = 'arcade-hangar-build.v4';

function normalizeId(value, fallback) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return normalized || fallback;
}

export function cloneHangarBuild(build) {
    if (!build || typeof build !== 'object') return null;
    return { ...build, slots: { ...(build.slots || {}) }, tags: [...(build.tags || [])] };
}

export function createDefaultHangarBuild(vehicleId = 'ship5', options = {}) {
    const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
    const normalizedVehicleId = normalizeId(vehicleId, 'ship5');
    const mode = options.mode === 'fight' ? 'fight' : 'arcade';
    return {
        schemaVersion: HANGAR_BUILD_SCHEMA_VERSION,
        buildId: normalizeId(options.buildId, `build-${normalizedVehicleId}-${nowMs}`),
        mode,
        vehicleId: normalizedVehicleId,
        name: String(options.name || 'Standardkonfiguration').trim() || 'Standardkonfiguration',
        favorite: options.favorite === true,
        tags: [],
        hitboxClass: String(options.hitboxClass || 'standard').trim().toLowerCase(),
        slots: createDefaultHangarSlots(),
        ...(mode === 'fight' ? { machineGunId: normalizeFightMachineGunId(options.machineGunId || DEFAULT_FIGHT_MACHINE_GUN_ID) } : {}),
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
    };
}

export function normalizeHangarBuild(source, fallback = {}) {
    const record = source && typeof source === 'object' ? source : {};
    const base = createDefaultHangarBuild(record.vehicleId || fallback.vehicleId || 'ship5', {
        buildId: record.buildId || record.presetId || fallback.buildId,
        name: record.name || fallback.name,
        hitboxClass: record.hitboxClass || fallback.hitboxClass,
        mode: record.mode || fallback.mode,
        nowMs: record.createdAtMs || record.updatedAtMs || fallback.nowMs,
    });
    const sourceSlots = record.slots && typeof record.slots === 'object' ? record.slots : null;
    const legacyUpgrades = record.upgrades && typeof record.upgrades === 'object' ? record.upgrades : null;
    const slots = { ...base.slots };
    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const rawPartId = sourceSlots?.[slot.id];
        if (rawPartId === null && Object.hasOwn(sourceSlots || {}, slot.id)) {
            slots[slot.id] = null;
            continue;
        }
        const part = resolveHangarPart(rawPartId);
        if (part?.kind === 'stone' && part.compatibleSlots.includes(slot.id)) {
            slots[slot.id] = part.id;
            continue;
        }
        const legacyTier = legacyUpgrades?.[slot.id]
            || legacyUpgrades?.[`${slot.id}_t2`]
            || 'T1';
        const legacyPartId = resolveLegacyHangarStoneId(rawPartId || legacyTier, slot.id);
        if (legacyPartId) slots[slot.id] = legacyPartId;
    }
    const mode = record.mode === 'fight' || fallback.mode === 'fight' ? 'fight' : 'arcade';
    return {
        ...base,
        schemaVersion: HANGAR_BUILD_SCHEMA_VERSION,
        mode,
        favorite: record.favorite === true,
        tags: [...new Set((Array.isArray(record.tags) ? record.tags : []).map((tag) => String(tag).trim().slice(0, 24)).filter(Boolean))].slice(0, 8),
        slots,
        ...(mode === 'fight' ? { machineGunId: normalizeFightMachineGunId(record.machineGunId || fallback.machineGunId) } : {}),
        createdAtMs: Math.max(0, Number(record.createdAtMs) || base.createdAtMs),
        updatedAtMs: Math.max(0, Number(record.updatedAtMs) || base.updatedAtMs),
    };
}

export function installHangarPart(build, partId, slotId, options = {}) {
    const current = normalizeHangarBuild(build);
    const part = resolveHangarPart(partId);
    const slot = resolveHangarSlot(slotId);
    if (!part || !slot) return { ok: false, code: 'unknown_target', build: current };
    if (!part.compatibleSlots.includes(slot.id)) {
        return { ok: false, code: 'incompatible_slot', build: current };
    }
    const next = cloneHangarBuild(current);
    next.slots[slot.id] = part.id;
    const pairedSlot = options.pair === true ? resolveHangarSlot(slot.pair) : null;
    if (pairedSlot && part.compatibleSlots.includes(pairedSlot.id)) {
        next.slots[pairedSlot.id] = part.id;
    }
    next.updatedAtMs = Math.max(current.updatedAtMs + 1, Number(options.nowMs) || Date.now());
    return { ok: true, code: 'installed', build: next, changedSlots: pairedSlot ? [slot.id, pairedSlot.id] : [slot.id] };
}

export function removeHangarPart(build, slotId, options = {}) {
    const current = normalizeHangarBuild(build);
    const slot = resolveHangarSlot(slotId);
    if (!slot) return { ok: false, code: 'unknown_slot', build: current };
    if (slot.required && options.allowRequired !== true) {
        return { ok: false, code: 'required_slot', build: current };
    }
    if (!current.slots[slot.id]) return { ok: false, code: 'slot_empty', build: current };
    const next = cloneHangarBuild(current);
    next.slots[slot.id] = null;
    const pairedSlot = options.pair === true ? resolveHangarSlot(slot.pair) : null;
    if (pairedSlot) next.slots[pairedSlot.id] = null;
    next.updatedAtMs = Math.max(current.updatedAtMs + 1, Number(options.nowMs) || Date.now());
    return { ok: true, code: 'removed', build: next, changedSlots: pairedSlot ? [slot.id, pairedSlot.id] : [slot.id] };
}

export function areHangarBuildsEqual(left, right) {
    const a = normalizeHangarBuild(left);
    const b = normalizeHangarBuild(right);
    return a.vehicleId === b.vehicleId
        && a.hitboxClass === b.hitboxClass
        && a.machineGunId === b.machineGunId
        && HANGAR_SLOT_DEFINITIONS.every((slot) => a.slots[slot.id] === b.slots[slot.id]);
}

export class HangarBuildHistory {
    constructor(initialBuild, limit = 50) {
        this.limit = Math.max(2, Math.floor(Number(limit) || 50));
        this.entries = [];
        this.index = -1;
        this.push(initialBuild);
    }

    push(build) {
        const snapshot = normalizeHangarBuild(build);
        const serialized = JSON.stringify(snapshot);
        if (this.entries[this.index] === serialized) return false;
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push(serialized);
        if (this.entries.length > this.limit) this.entries.shift();
        this.index = this.entries.length - 1;
        return true;
    }

    undo() {
        if (!this.canUndo()) return null;
        this.index -= 1;
        return JSON.parse(this.entries[this.index]);
    }

    redo() {
        if (!this.canRedo()) return null;
        this.index += 1;
        return JSON.parse(this.entries[this.index]);
    }

    canUndo() { return this.index > 0; }
    canRedo() { return this.index >= 0 && this.index < this.entries.length - 1; }
    getState() { return { canUndo: this.canUndo(), canRedo: this.canRedo(), index: this.index, length: this.entries.length }; }
}
