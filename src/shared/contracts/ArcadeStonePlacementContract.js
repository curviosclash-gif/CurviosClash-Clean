// ============================================
// ArcadeStonePlacementContract.js - Paket 3: Steine einsetzen, umstecken und ihre Wirkung
// Ein Stein der Stufe n wirkt wie n zusätzliche 5-%-Größenschritte seines Bauteils (Haupt- und
// Nebenwert, ohne Lagerstufen, ohne Trefferzone). Wirksam ist min(Stufe, 1 + Level/10); auf einem
// Bauteil unter 125 % wirkt er höchstens als T1. Nur applyArcadeStonePlacement ändert die Belegung,
// und nur mit Bestätigung, wenn ein Stein dafür ein anderes Fahrzeug verlässt.
// Rein: keine Importe aus core/ui/state.
// ============================================

import { ARCADE_STONE_FULL_EFFECT_SIZE_PCT } from './ArcadeVehicleBalanceContract.js';
import { normalizeArcadeSizeProfileFields } from './ArcadeVehicleBuildContract.js';
import { ARCADE_PART_SIZE_GROUPS, resolveArcadeSizeGroupForRole } from './ArcadeVehicleSizeContract.js';
import {
    ARCADE_STONE_SLOT_IDS,
    normalizeArcadeStoneId,
    normalizeArcadeStoneLevel,
    normalizeArcadeStoneWorkshopRecord,
    resolveArcadeStoneLevelCap,
    resolveArcadeStoneRequiredLevel,
    resolveArcadeStoneSlotStatus,
    resolveArcadeStoneVehicleLevel,
} from './ArcadeStoneWorkshopContract.js';

const GROUP_LABELS = Object.freeze({ hull: 'Rumpf', nose: 'Nase', wings: 'Flügel', engines: 'Antriebe', utility: 'Utility' });
const VISUAL_TIER_MAX = 3;

/**
 * @typedef {import('./ArcadeStoneWorkshopContract.js').ArcadeStoneWorkshop} ArcadeStoneWorkshop
 * @typedef {{ code: string, slotId: string, stoneId: string }} ArcadeStonePlacementError
 * @typedef {{ stoneId: string, fromVehicleId: string, fromSlot: string }} ArcadeStoneTransfer
 * @typedef {{ ok: boolean, errors: ArcadeStonePlacementError[], transfers: ArcadeStoneTransfer[],
 *   missing: Array<{ slotId: string, stoneId: string }> }} ArcadeStonePlacementPlan
 * @typedef {{ effective: number, reasons: string[], fullLevel: number }} ArcadeStoneEffectiveLevel
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Steinbelegung eines Hangar-Builds: sieben Plätze, Stein-ID oder null, jede ID höchstens einmal.
 * @param {unknown} value
 * @returns {Record<string, string|null>}
 */
export function normalizeArcadeStoneSlots(value) {
    const source = isRecord(value) ? value : {};
    const seen = new Set();
    /** @type {Record<string, string|null>} */
    const slots = {};
    for (const slotId of ARCADE_STONE_SLOT_IDS) {
        const stoneId = normalizeArcadeStoneId(source[slotId]);
        slots[slotId] = stoneId && !seen.has(stoneId) ? stoneId : null;
        if (stoneId) seen.add(stoneId);
    }
    return slots;
}

/**
 * Steine, die gerade in diesem Fahrzeug stecken, in Platzreihenfolge.
 * @param {unknown} pool
 * @param {unknown} vehicleId
 * @returns {Array<{ stoneId: string, level: number, slotId: string }>}
 */
export function listArcadeStonesForVehicle(pool, vehicleId) {
    if (!isRecord(pool)) return [];
    const vehicle = String(vehicleId || '').trim();
    return normalizeArcadeStoneWorkshopRecord(pool, 0).stones
        .filter((stone) => stone.placement?.vehicleId === vehicle)
        .map((stone) => ({ stoneId: stone.stoneId, level: stone.level, slotId: /** @type {any} */ (stone.placement).slotId }))
        .sort((a, b) => ARCADE_STONE_SLOT_IDS.indexOf(a.slotId) - ARCADE_STONE_SLOT_IDS.indexOf(b.slotId));
}

/**
 * Prüft eine gewünschte Belegung, ohne etwas zu ändern: gesperrte Plätze und doppelte Steine sind
 * Fehler; Steine aus anderen Fahrzeugen sind Wechsel; unbekannte Steine (Vorlage) fehlen.
 * @param {unknown} pool
 * @param {unknown} vehicleId
 * @param {unknown} desiredSlots
 * @param {unknown} profile
 * @returns {ArcadeStonePlacementPlan}
 */
export function resolveArcadeStonePlacementPlan(pool, vehicleId, desiredSlots, profile) {
    const stones = isRecord(pool) ? normalizeArcadeStoneWorkshopRecord(pool, 0).stones : [];
    const vehicle = String(vehicleId || '').trim();
    const desired = isRecord(desiredSlots) ? desiredSlots : {};
    const seen = new Set();
    /** @type {ArcadeStonePlacementPlan} */
    const plan = { ok: true, errors: [], transfers: [], missing: [] };
    for (const slotId of ARCADE_STONE_SLOT_IDS) {
        const stoneId = normalizeArcadeStoneId(desired[slotId]);
        if (!stoneId) continue;
        if (seen.has(stoneId)) {
            plan.errors.push({ code: 'duplicate_stone', slotId, stoneId });
            continue;
        }
        seen.add(stoneId);
        if (!resolveArcadeStoneSlotStatus(profile, slotId).unlocked) {
            plan.errors.push({ code: 'slot_locked', slotId, stoneId });
            continue;
        }
        const stone = stones.find((entry) => entry.stoneId === stoneId);
        if (!stone) plan.missing.push({ slotId, stoneId });
        else if (stone.placement && stone.placement.vehicleId !== vehicle) {
            plan.transfers.push({ stoneId, fromVehicleId: stone.placement.vehicleId, fromSlot: stone.placement.slotId });
        }
    }
    plan.ok = plan.errors.length === 0;
    return plan;
}

/**
 * Aktiviert eine Belegung für ein Fahrzeug im Pool. Ohne confirmTransfers lehnt es jeden Wechsel
 * aus einem anderen Fahrzeug ab (transfer_confirmation_required). Fehlende Steine lassen den Platz
 * leer; Steine dieses Fahrzeugs, die nicht mehr gewünscht sind, werden frei. Der alte Pool bleibt.
 * @param {unknown} pool
 * @param {unknown} vehicleId
 * @param {unknown} desiredSlots
 * @param {unknown} profile
 * @param {{ confirmTransfers?: boolean, nowMs?: number }} [options]
 * @returns {ArcadeStonePlacementPlan & { reason: string, pool: ArcadeStoneWorkshop|null }}
 */
export function applyArcadeStonePlacement(pool, vehicleId, desiredSlots, profile, { confirmTransfers = false, nowMs = Date.now() } = {}) {
    const vehicle = String(vehicleId || '').trim();
    if (!isRecord(pool) || !vehicle) {
        const reason = isRecord(pool) ? 'unknown_vehicle' : 'storage_unavailable';
        return { ok: false, reason, errors: [], transfers: [], missing: [], pool: null };
    }
    const plan = resolveArcadeStonePlacementPlan(pool, vehicle, desiredSlots, profile);
    if (!plan.ok) return { ...plan, reason: plan.errors[0].code, pool: null };
    if (plan.transfers.length > 0 && confirmTransfers !== true) {
        return { ...plan, ok: false, reason: 'transfer_confirmation_required', pool: null };
    }
    const desired = normalizeArcadeStoneSlots(desiredSlots);
    const slotByStone = new Map();
    for (const slotId of ARCADE_STONE_SLOT_IDS) if (desired[slotId]) slotByStone.set(desired[slotId], slotId);
    const current = normalizeArcadeStoneWorkshopRecord(pool, nowMs);
    const stones = current.stones.map((stone) => {
        const slotId = slotByStone.get(stone.stoneId);
        if (slotId) return { ...stone, placement: { vehicleId: vehicle, slotId } };
        return stone.placement?.vehicleId === vehicle ? { ...stone, placement: null } : stone;
    });
    return { ...plan, reason: 'ok', pool: { ...current, stones, updatedAt: new Date(Math.max(0, Number(nowMs) || 0)).toISOString() } };
}

/**
 * Wirksame Stufe eines Steins: min(Steinstufe, 1 + floor(Level / 10)); unter 125 % Bauteilgröße
 * höchstens T1. reasons nennt alle Abstände ('size', 'level'); fullLevel ist das Level der vollen Stufe.
 * @param {unknown} stoneLevel
 * @param {unknown} vehicleLevel
 * @param {unknown} groupSizePct
 * @returns {ArcadeStoneEffectiveLevel}
 */
export function resolveArcadeStoneEffectiveLevel(stoneLevel, vehicleLevel, groupSizePct) {
    const level = normalizeArcadeStoneLevel(stoneLevel);
    const cap = resolveArcadeStoneLevelCap(vehicleLevel);
    const sizeLimited = (Number(groupSizePct) || 0) < ARCADE_STONE_FULL_EFFECT_SIZE_PCT;
    /** @type {string[]} */
    const reasons = [];
    if (sizeLimited && level > 1) reasons.push('size');
    if (level > cap) reasons.push('level');
    return {
        effective: sizeLimited ? 1 : Math.min(level, cap),
        reasons,
        fullLevel: resolveArcadeStoneRequiredLevel(level),
    };
}

/**
 * @param {ArcadeStoneWorkshop} current
 * @param {string} vehicle
 * @param {unknown} profile
 * @param {(slotId: string, effective: ArcadeStoneEffectiveLevel, stoneId: string) => void} visit
 */
function forEachActiveStone(current, vehicle, profile, visit) {
    const sizes = normalizeArcadeSizeProfileFields(profile).partSizes;
    const vehicleLevel = resolveArcadeStoneVehicleLevel(profile);
    for (const stone of current.stones) {
        const slotId = stone.placement?.vehicleId === vehicle ? stone.placement.slotId : '';
        if (!slotId || !resolveArcadeStoneSlotStatus(profile, slotId).unlocked) continue;
        const group = /** @type {string} */ (resolveArcadeSizeGroupForRole(slotId));
        visit(slotId, resolveArcadeStoneEffectiveLevel(stone.level, vehicleLevel, sizes[group]), stone.stoneId);
    }
}

/**
 * Zusätzliche Größenschritte je Gruppe aus den Steinen, die im Pool in diesem Fahrzeug stecken.
 * Jeder Flügel- und Antriebsstein zählt einzeln; Steine auf nicht gekauften Plätzen wirken nicht.
 * Das Ergebnis ist eingefroren (Cache-Schlüssel des HUD-Banners).
 * @param {unknown} pool
 * @param {unknown} vehicleId
 * @param {unknown} profile
 * @returns {Readonly<Record<string, number>>}
 */
export function resolveArcadeStoneExtraSteps(pool, vehicleId, profile) {
    /** @type {Record<string, number>} */
    const steps = {};
    for (const group of ARCADE_PART_SIZE_GROUPS) steps[group] = 0;
    if (isRecord(pool)) {
        forEachActiveStone(normalizeArcadeStoneWorkshopRecord(pool, 0), String(vehicleId || '').trim(), profile, (slotId, result) => {
            steps[/** @type {string} */ (resolveArcadeSizeGroupForRole(slotId))] += result.effective;
        });
    }
    return Object.freeze(steps);
}

/**
 * Dieselbe Rechnung für einen Hangar-Entwurf: auf einer bestätigten Kopie des Pools, ohne ihn zu
 * ändern. Ein ungültiger Entwurf (gesperrter Platz, doppelter Stein) rechnet mit der aktiven Belegung.
 * @param {unknown} pool
 * @param {unknown} vehicleId
 * @param {unknown} stoneSlots
 * @param {unknown} profile
 */
export function resolveArcadeStoneDraftSteps(pool, vehicleId, stoneSlots, profile) {
    const applied = applyArcadeStonePlacement(pool, vehicleId, stoneSlots, profile, { confirmTransfers: true, nowMs: 0 });
    return resolveArcadeStoneExtraSteps(applied.ok ? applied.pool : pool, vehicleId, profile);
}

/**
 * Text für das Warnsymbol eines schwächer wirkenden Steins, leer ohne Grund.
 * @param {Partial<ArcadeStoneEffectiveLevel>|null|undefined} result
 * @param {unknown} slotId
 * @param {unknown} groupSizePct
 */
export function describeArcadeStoneWeakness(result, slotId, groupSizePct) {
    const reasons = Array.isArray(result?.reasons) ? result.reasons : [];
    if (reasons.length === 0) return '';
    const group = resolveArcadeSizeGroupForRole(slotId);
    const parts = [];
    if (reasons.includes('size')) {
        const label = group ? GROUP_LABELS[/** @type {keyof typeof GROUP_LABELS} */ (group)] : 'Bauteil';
        parts.push(`${label} auf ${ARCADE_STONE_FULL_EFFECT_SIZE_PCT} % bringen (jetzt ${Number(groupSizePct) || 0} %)`);
    }
    if (reasons.includes('level')) parts.push(`volle Stufe ab Level ${result?.fullLevel}`);
    return `Wirkt als T${result?.effective} – ${parts.join(' · ')}`;
}

/**
 * Steine dieses Fahrzeugs, die durch einen Umbau (z. B. Verkleinern oder kleineres Level) auf eine
 * niedrigere wirksame Stufe fallen - für die Wertvorschau.
 * @param {unknown} pool
 * @param {unknown} vehicleId
 * @param {unknown} profileBefore
 * @param {unknown} profileAfter
 * @returns {Array<{ stoneId: string, slotId: string, from: number, to: number }>}
 */
export function listArcadeStoneFallbacks(pool, vehicleId, profileBefore, profileAfter) {
    if (!isRecord(pool)) return [];
    const current = normalizeArcadeStoneWorkshopRecord(pool, 0);
    const vehicle = String(vehicleId || '').trim();
    /** @type {Map<string, number>} */
    const before = new Map();
    forEachActiveStone(current, vehicle, profileBefore, (_slotId, result, stoneId) => before.set(stoneId, result.effective));
    /** @type {Array<{ stoneId: string, slotId: string, from: number, to: number }>} */
    const fallbacks = [];
    forEachActiveStone(current, vehicle, profileAfter, (slotId, result, stoneId) => {
        const from = before.get(stoneId);
        if (from !== undefined && result.effective < from) fallbacks.push({ stoneId, slotId, from, to: result.effective });
    });
    return fallbacks;
}

/**
 * Sichtbares Steinteil zur wirksamen Stufe (vorläufig die violetten Steine, ab T3 bleibt T3).
 * @param {unknown} effective
 */
export function resolveArcadeStoneVisualPartId(effective) {
    const tier = Math.max(1, Math.min(VISUAL_TIER_MAX, Math.floor(Number(effective) || 1)));
    return `stone_violet_t${tier}`;
}
