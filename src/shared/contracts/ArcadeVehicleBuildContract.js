// ============================================
// ArcadeVehicleBuildContract.js - Größenumbau-Regeln und Build-Werte (Paket 2a)
// Eine reine Funktion je Regel: Hangar (Kauf, Umbau, Vorschau) und Runtime
// (Run-Start, Spawn) rufen dieselben Funktionen, damit beide Seiten dieselben
// Werte sehen. Alle Zahlen stehen in ArcadeVehicleBalanceContract.js.
// ============================================

import {
    ARCADE_BASE_REGEN_DELAY_S,
    ARCADE_MIN_REGEN_DELAY_S,
    ARCADE_SIZE_MAX_PURCHASED_STEPS,
    ARCADE_SIZE_STEP_BASE_COST_XP,
    ARCADE_SIZE_STEP_COST_INCREMENT_XP,
    ARCADE_SIZE_STEP_EFFECTS_PCT,
    ARCADE_SIZE_UNLOCK_COST_XP,
    ARCADE_STORAGE_MAX_SLOTS,
    ARCADE_STORAGE_TIER_COST_XP,
    ARCADE_STORAGE_TIER_UTILITY_PCT,
    resolveArcadeStatCapPct,
    resolveArcadeVehicleBaseStats,
} from './ArcadeVehicleBalanceContract.js';
import {
    ARCADE_PART_SIZE_DEFAULT_PCT,
    ARCADE_PART_SIZE_GROUPS,
    ARCADE_PART_SIZE_MAX_PCT,
    ARCADE_PART_SIZE_MIN_PCT,
    ARCADE_PART_SIZE_STEP_PCT,
    normalizeArcadePartSizes,
    resolveArcadePartSizeFactors,
} from './ArcadeVehicleSizeContract.js';
import { normalizeVehiclePartStyle } from './VehiclePartStyleContract.js';
import { GLOBAL_FOG_CAMERA_VISIBILITY_LIMIT, resolveGlobalFogMapRange } from './GlobalFogEffectContract.js';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_STORAGE_TIERS = ARCADE_STORAGE_TIER_COST_XP.length;

/** Lager-Schlüssel -> Profilfeld der gekauften Stufen und Grundwert-Feld der Tabelle. */
export const ARCADE_STORAGE_KINDS = Object.freeze({
    items: Object.freeze({ purchasedField: 'purchasedItemSlots', capacityField: 'itemCapacity' }),
    rockets: Object.freeze({ purchasedField: 'purchasedRocketSlots', capacityField: 'rocketCapacity' }),
});

/** Reihenfolge des vollständigen Wertesatzes (auch Reihenfolge der Vorschau). */
export const ARCADE_BUILD_STAT_KEYS = Object.freeze([
    'maxHpPct', 'regenDelay', 'damagePct', 'rangePct', 'turnPct', 'rollPct',
    'speedPct', 'boostDurationPct', 'shieldPct', 'itemCapacity', 'rocketCapacity',
]);

/**
 * @typedef {{ maxHpPct: number, regenDelay: number, damagePct: number, rangePct: number, turnPct: number,
 *   rollPct: number, speedPct: number, boostDurationPct: number, shieldPct: number,
 *   itemCapacity: number, rocketCapacity: number }} ArcadeVehicleBuildStats
 * @typedef {{ sizeWorkshopUnlocked: boolean, partSizes: Record<string, number>, purchasedSizeSteps: number,
 *   purchasedItemSlots: number, purchasedRocketSlots: number }} ArcadeSizeProfileFields
 * @typedef {{ ok: boolean, reason: string, cost: number, next: Record<string, any>|null }} ArcadeBuildRuleResult
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whole number in [0, max]; +Infinity saturates, NaN counts as 0.
 * @param {unknown} value
 * @param {number} [max]
 */
function clampCount(value, max = MAX_SAFE) {
    const n = Number(value);
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(max, Math.floor(n)));
}

/** @param {number} value */
function round2(value) {
    return Math.round(value * 100) / 100;
}

/**
 * Belegte Schritte: Σ (Größe - 100) / 5 über alle Gruppen; Verkleinern zählt negativ.
 * @param {unknown} partSizes
 */
export function countArcadeSizeSteps(partSizes) {
    const sizes = normalizeArcadePartSizes(partSizes);
    return ARCADE_PART_SIZE_GROUPS.reduce(
        (sum, group) => sum + (sizes[group] - ARCADE_PART_SIZE_DEFAULT_PCT) / ARCADE_PART_SIZE_STEP_PCT,
        0
    );
}

/**
 * Größenfelder eines Fahrzeugprofils. Ohne Freigabe oder bei mehr belegten als gekauften
 * Schritten fällt die Größe auf den Werkszustand zurück; Käufe bleiben erhalten.
 * @param {unknown} source
 * @returns {ArcadeSizeProfileFields}
 */
export function normalizeArcadeSizeProfileFields(source) {
    const input = isRecord(source) ? source : {};
    const sizeWorkshopUnlocked = input.sizeWorkshopUnlocked === true;
    const purchasedSizeSteps = clampCount(input.purchasedSizeSteps, ARCADE_SIZE_MAX_PURCHASED_STEPS);
    let partSizes = normalizeArcadePartSizes(input.partSizes);
    if (!sizeWorkshopUnlocked || countArcadeSizeSteps(partSizes) > purchasedSizeSteps) {
        partSizes = normalizeArcadePartSizes(null);
    }
    return {
        sizeWorkshopUnlocked,
        partSizes,
        purchasedSizeSteps,
        purchasedItemSlots: clampCount(input.purchasedItemSlots, MAX_STORAGE_TIERS),
        purchasedRocketSlots: clampCount(input.purchasedRocketSlots, MAX_STORAGE_TIERS),
    };
}

/**
 * XP-Preis des nächsten gekauften Schritts: 100 + 20 * bereits gekaufte Schritte.
 * @param {unknown} purchasedSteps
 */
export function resolveArcadeSizeStepCost(purchasedSteps) {
    const bought = clampCount(purchasedSteps);
    return Math.min(MAX_SAFE, ARCADE_SIZE_STEP_BASE_COST_XP + ARCADE_SIZE_STEP_COST_INCREMENT_XP * bought);
}

/**
 * Anzahl der Lagerstufen-Schwellen (105/115/125 %), die eine Utility-Größe erreicht.
 * @param {unknown} utilityPct
 */
export function resolveArcadeReachedStorageTiers(utilityPct) {
    const size = Number(utilityPct) || 0;
    return ARCADE_STORAGE_TIER_UTILITY_PCT.filter((threshold) => size >= threshold).length;
}

/**
 * Nutzbare Zusatzplätze: min(gekauft, erreichte Schwellen) und nie über 10 Plätze.
 * @param {number} baseCapacity
 * @param {unknown} purchased
 * @param {unknown} utilityPct
 */
export function resolveArcadeUsableStorageSlots(baseCapacity, purchased, utilityPct) {
    return Math.min(
        clampCount(purchased, MAX_STORAGE_TIERS),
        resolveArcadeReachedStorageTiers(utilityPct),
        Math.max(0, ARCADE_STORAGE_MAX_SLOTS - clampCount(baseCapacity))
    );
}

/**
 * Ausgebbare XP des Fahrzeugs (xpBank; ohne Konto: verdient minus ausgegeben).
 * @param {unknown} profileSource
 */
export function resolveArcadeSpendableXp(profileSource) {
    const profile = isRecord(profileSource) ? profileSource : {};
    if (profile.xpBank !== undefined && profile.xpBank !== null) return clampCount(profile.xpBank);
    return clampCount(clampCount(profile.xp) - clampCount(profile.spentUpgradeXp));
}

/**
 * @param {string} reason
 * @param {number} [cost]
 * @returns {ArcadeBuildRuleResult}
 */
function reject(reason, cost = 0) {
    return { ok: false, reason, cost, next: null };
}

/**
 * XP-Kauf aus dem Konto des bezahlenden Fahrzeugs: setzt die Felder und zieht die Kosten ab.
 * Größenumbau (Paket 2) und Steine (Paket 3) bezahlen über denselben Weg.
 * @param {Record<string, any>} profile
 * @param {number} cost
 * @param {Record<string, any>} fields
 * @returns {ArcadeBuildRuleResult}
 */
export function spendArcadeVehicleXp(profile, cost, fields) {
    const available = resolveArcadeSpendableXp(profile);
    if (available < cost) return reject('insufficient_xp', cost);
    return {
        ok: true,
        reason: 'ok',
        cost,
        next: {
            ...profile,
            ...fields,
            xpBank: available - cost,
            spentUpgradeXp: clampCount(clampCount(profile.spentUpgradeXp) + cost),
        },
    };
}

/** @param {unknown} profile */
function profileInput(profile) {
    const source = isRecord(profile) ? profile : {};
    return { source, fields: normalizeArcadeSizeProfileFields(source) };
}

/**
 * Einmalige Freigabe des Größenumbaus für 100 XP des Fahrzeugs.
 * @param {unknown} profile
 * @returns {ArcadeBuildRuleResult}
 */
export function evaluateArcadeSizeUnlock(profile) {
    const { source, fields } = profileInput(profile);
    if (fields.sizeWorkshopUnlocked) return reject('already_unlocked');
    return spendArcadeVehicleXp(source, ARCADE_SIZE_UNLOCK_COST_XP, { ...fields, sizeWorkshopUnlocked: true });
}

/**
 * Kostenloses Umverteilen: jede Gruppe 80..125 in 5-%-Schritten, belegte <= gekaufte Schritte.
 * @param {unknown} profile
 * @param {unknown} requestedSizes
 * @returns {ArcadeBuildRuleResult}
 */
export function evaluateArcadeSizeResize(profile, requestedSizes) {
    const { source, fields } = profileInput(profile);
    if (!fields.sizeWorkshopUnlocked) return reject('locked');
    const requested = isRecord(requestedSizes) ? requestedSizes : {};
    const valid = ARCADE_PART_SIZE_GROUPS.every((group) => {
        const value = requested[group] === undefined ? fields.partSizes[group] : Number(requested[group]);
        return Number.isInteger(value)
            && value >= ARCADE_PART_SIZE_MIN_PCT
            && value <= ARCADE_PART_SIZE_MAX_PCT
            && value % ARCADE_PART_SIZE_STEP_PCT === 0;
    });
    if (!valid) return reject('invalid_size');
    const partSizes = normalizeArcadePartSizes({ ...fields.partSizes, ...requested });
    if (countArcadeSizeSteps(partSizes) > fields.purchasedSizeSteps) return reject('over_capacity');
    return { ok: true, reason: 'ok', cost: 0, next: { ...source, ...fields, partSizes } };
}

/**
 * Kauf eines Größenschritts (dauerhafte Kapazität des Fahrzeugs), höchstens 25.
 * @param {unknown} profile
 * @returns {ArcadeBuildRuleResult}
 */
export function evaluateArcadeSizeStepPurchase(profile) {
    const { source, fields } = profileInput(profile);
    if (!fields.sizeWorkshopUnlocked) return reject('locked');
    if (fields.purchasedSizeSteps >= ARCADE_SIZE_MAX_PURCHASED_STEPS) return reject('max_steps');
    const cost = resolveArcadeSizeStepCost(fields.purchasedSizeSteps);
    return spendArcadeVehicleXp(source, cost, { ...fields, purchasedSizeSteps: fields.purchasedSizeSteps + 1 });
}

/**
 * Nächste angebotene Lagerstufe eines Lagers oder null, wenn alle gekauft sind oder die
 * Stufe nur über 10 Plätze führen würde. Die Utility-Bedingung steht im Angebot.
 * @param {unknown} profile
 * @param {unknown} storage 'items' | 'rockets'
 * @returns {{ storage: string, tier: number, cost: number, requiredUtilityPct: number, utilityReached: boolean }|null}
 */
export function resolveArcadeStorageOffer(profile, storage) {
    const kind = ARCADE_STORAGE_KINDS[/** @type {'items'|'rockets'} */ (String(storage))];
    if (!kind) return null;
    const { source, fields } = profileInput(profile);
    const purchased = fields[/** @type {'purchasedItemSlots'|'purchasedRocketSlots'} */ (kind.purchasedField)];
    if (purchased >= MAX_STORAGE_TIERS) return null;
    const baseCapacity = resolveArcadeVehicleBaseStats(String(source.vehicleId || ''))[
        /** @type {'itemCapacity'|'rocketCapacity'} */ (kind.capacityField)
    ];
    const tier = purchased + 1;
    if (baseCapacity + tier > ARCADE_STORAGE_MAX_SLOTS) return null;
    const requiredUtilityPct = ARCADE_STORAGE_TIER_UTILITY_PCT[purchased];
    return {
        storage: String(storage),
        tier,
        cost: ARCADE_STORAGE_TIER_COST_XP[purchased],
        requiredUtilityPct,
        utilityReached: fields.partSizes.utility >= requiredUtilityPct,
    };
}

/**
 * Kauf der nächsten Lagerstufe eines Lagers (Items und Raketen getrennt).
 * @param {unknown} profile
 * @param {unknown} storage 'items' | 'rockets'
 * @returns {ArcadeBuildRuleResult}
 */
export function evaluateArcadeStoragePurchase(profile, storage) {
    const kind = ARCADE_STORAGE_KINDS[/** @type {'items'|'rockets'} */ (String(storage))];
    if (!kind) return reject('invalid_storage');
    const { source, fields } = profileInput(profile);
    if (!fields.sizeWorkshopUnlocked) return reject('locked');
    const purchased = fields[/** @type {'purchasedItemSlots'|'purchasedRocketSlots'} */ (kind.purchasedField)];
    if (purchased >= MAX_STORAGE_TIERS) return reject('max_tiers');
    const offer = resolveArcadeStorageOffer(source, storage);
    if (!offer) return reject('storage_full');
    if (!offer.utilityReached) return reject('utility_too_small', offer.cost);
    return spendArcadeVehicleXp(source, offer.cost, { ...fields, [kind.purchasedField]: offer.tier });
}

/**
 * Vollständiger Wertesatz eines Builds in Prozent des Einstellungs-Grundwerts (Leben, Tempo,
 * Wendigkeit) bzw. des Modus-Werts (übrige Prozentwerte), der Regenerations-Wartezeit in
 * Sekunden und den Lagergrößen. Jeder Schritt wirkt multiplikativ auf den Grundwert, Quellen
 * addieren sich; Tempo, Wendigkeit und Rollen sind auf Grundwert + 100 Punkte geklemmt,
 * die Wartezeit sinkt nie unter 1 s.
 * @param {string} vehicleId
 * @param {unknown} build Profil oder Teil davon (Größenfelder)
 * @param {unknown} [extraSteps] zusätzliche Schritte je Gruppe (Steine, Paket 3), ohne Lagerstufen
 * @returns {ArcadeVehicleBuildStats}
 */
export function resolveArcadeVehicleBuildStats(vehicleId, build, extraSteps = null) {
    const base = resolveArcadeVehicleBaseStats(vehicleId);
    const fields = normalizeArcadeSizeProfileFields(build);
    const extra = isRecord(extraSteps) ? extraSteps : {};
    /** @type {Record<string, number>} */
    const steps = {};
    for (const group of ARCADE_PART_SIZE_GROUPS) {
        steps[group] = (fields.partSizes[group] - ARCADE_PART_SIZE_DEFAULT_PCT) / ARCADE_PART_SIZE_STEP_PCT
            + clampCount(extra[group]);
    }
    /** @type {Record<string, Record<string, number>>} */
    const effects = ARCADE_SIZE_STEP_EFFECTS_PCT;
    const pct = (/** @type {number} */ basePct, /** @type {string} */ group, /** @type {string} */ key) => (
        round2(Math.max(0, basePct * (1 + steps[group] * effects[group][key] / 100)))
    );
    const capped = (/** @type {number} */ basePct, /** @type {string} */ group, /** @type {string} */ key) => (
        Math.min(resolveArcadeStatCapPct(basePct), pct(basePct, group, key))
    );
    const utility = fields.partSizes.utility;
    return {
        maxHpPct: pct(base.maxHpPct, 'hull', 'maxHpPct'),
        regenDelay: Math.max(ARCADE_MIN_REGEN_DELAY_S, pct(ARCADE_BASE_REGEN_DELAY_S, 'hull', 'regenDelayPct')),
        damagePct: pct(100, 'nose', 'damagePct'),
        rangePct: pct(100, 'nose', 'rangePct'),
        turnPct: capped(base.turnPct, 'wings', 'turnPct'),
        rollPct: capped(base.rollPct, 'wings', 'rollPct'),
        speedPct: capped(base.speedPct, 'engines', 'speedPct'),
        boostDurationPct: pct(100, 'engines', 'boostDurationPct'),
        shieldPct: pct(100, 'utility', 'shieldPct'),
        itemCapacity: base.itemCapacity + resolveArcadeUsableStorageSlots(base.itemCapacity, fields.purchasedItemSlots, utility),
        rocketCapacity: base.rocketCapacity + resolveArcadeUsableStorageSlots(base.rocketCapacity, fields.purchasedRocketSlots, utility),
    };
}

/**
 * Geänderte Werte zwischen zwei Wertesätzen für die Hangar-Vorschau (alt -> neu).
 * @param {Partial<ArcadeVehicleBuildStats>} before
 * @param {Partial<ArcadeVehicleBuildStats>} after
 * @returns {Array<{ key: string, before: number, after: number, delta: number }>}
 */
export function diffArcadeVehicleBuildStats(before, after) {
    const a = /** @type {Record<string, number>} */ (isRecord(before) ? before : {});
    const b = /** @type {Record<string, number>} */ (isRecord(after) ? after : {});
    return ARCADE_BUILD_STAT_KEYS
        .filter((key) => a[key] !== b[key])
        .map((key) => ({ key, before: a[key], after: b[key], delta: round2((b[key] || 0) - (a[key] || 0)) }));
}

/**
 * Sichtbare Größe = funktionale Größe: Teil-Stil mit scale aus den Gruppen-Größen der
 * obersten Bauteile. Gespeicherte scale-Werte aus dem alten Größenregler zählen nicht mehr.
 * @param {ReadonlyArray<any>} parts
 * @param {unknown} partStyle
 * @param {unknown} partSizes
 * @returns {Record<string, {color?: number, scale?: number, variant?: string}>}
 */
export function resolveArcadeSizedPartStyle(parts, partStyle, partSizes) {
    const style = normalizeVehiclePartStyle(partStyle);
    const factors = resolveArcadePartSizeFactors(parts, partSizes);
    /** @type {Record<string, {color?: number, scale?: number, variant?: string}>} */
    const sized = {};
    // Only the colour survives: size comes from the build, and every ship keeps its factory shape.
    for (const [name, entry] of Object.entries(style)) {
        if (entry.color !== undefined) sized[name] = { color: entry.color };
    }
    for (const part of Array.isArray(parts) ? parts : []) {
        const name = String(part?.name || '');
        const factor = factors[name];
        if (factor && factor !== 1) sized[name] = { ...(sized[name] || {}), scale: factor };
    }
    return sized;
}

/** @param {unknown} value */
function positiveFactor(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

/** @type {WeakMap<object, number>} */
const mapSightRanges = new WeakMap();

/**
 * Sichtweite der Karte: Ende ihres eigenen Nebels, unabhängig von Grafikeinstellungen; ohne Karte 200.
 * Je Kartendefinition einmal berechnet, weil der Zielweg jedes Bild fragt.
 * @param {any} player
 */
function resolveMapSightRange(player) {
    const map = player?.entityManager?.arena?.currentMapDefinition;
    if (!map || typeof map !== 'object') return GLOBAL_FOG_CAMERA_VISIBILITY_LIMIT;
    let range = mapSightRanges.get(map);
    if (range === undefined) {
        range = resolveGlobalFogMapRange(map.lighting).normalFar;
        mapSightRanges.set(map, range);
    }
    return range;
}

/**
 * Nasen-Reichweite (Flugweite der MG-Schüsse, Aufschaltweite der Raketen). Sie hat keine
 * Balancing-Grenze, endet aber technisch an der Sichtweite am Spieler: Nebel der Karte sowie aktiver
 * Nebel oder Sandsturm. Die eigene Reichweite der Waffe bleibt immer; ohne Feld exakt baseRange.
 * @param {number} baseRange
 * @param {any} player
 */
export function resolveArcadeNoseRange(baseRange, player) {
    const factor = positiveFactor(player?.arcadeRangeMultiplier);
    if (factor <= 1) return baseRange * factor;
    const fog = Number(player?.entityManager?.getVisibilityRange?.(player.position));
    const sight = Math.min(resolveMapSightRange(player), Number.isNaN(fog) ? Infinity : fog);
    return Math.min(baseRange * factor, Math.max(baseRange, sight));
}

/**
 * MG-Werte eines Arcade-Spielers mit Nasen-Schaden und -Reichweite. Ohne gesetzte
 * Multiplikatoren (andere Modi, Bots, Daily) kommt dasselbe Objekt zurück.
 * @template {Record<string, any>} T
 * @param {T} mg
 * @param {any} player
 * @returns {T}
 */
export function applyArcadeBuildToMachineGunConfig(mg, player) {
    const damage = positiveFactor(player?.arcadeDamageMultiplier);
    const range = positiveFactor(player?.arcadeRangeMultiplier);
    if (damage === 1 && range === 1) return mg;
    return {
        ...mg,
        DAMAGE: Math.max(1, Number(mg?.DAMAGE || 9)) * damage,
        RANGE: resolveArcadeNoseRange(Math.max(10, Number(mg?.RANGE || 95)), player),
        // The nose only lengthens the flight; damage falloff keeps the MG's own range.
        FALLOFF_RANGE: Math.max(10, Number(mg?.FALLOFF_RANGE || mg?.RANGE || 95)),
    };
}
