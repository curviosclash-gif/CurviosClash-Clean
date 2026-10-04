// ============================================
// arcade-stones.contract.test.mjs - Paket 3: Steine aus dem Werkstatt-Pool.
// Pool, Kauf, Aufwerten, Steinplatz-Pakete, wirksame Stufe (125-%-Regel), Wertwirkung über die
// eine Rechenstelle, Umstecken zwischen Fahrzeugen, Speicherreihenfolge und die echten Laufzeitwege.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE_COLORS_STORAGE_KEY, ARCADE_COLORS_SCHEMA_VERSION } from '../src/shared/contracts/ArcadeColorProgressContract.js';

import {
    ARCADE_STONE_WORKSHOP_SCHEMA_VERSION,
    ARCADE_STONE_WORKSHOP_STORAGE_KEY,
    commitArcadeStoneWorkshopResult,
    createArcadeStoneWorkshopRecord,
    evaluateArcadeStonePurchase,
    evaluateArcadeStoneSlotPackagePurchase,
    evaluateArcadeStoneUpgrade,
    formatArcadeStonePackageLabel,
    listArcadeStoneUnlocksBetween,
    normalizeArcadeStoneSlotPackages,
    normalizeArcadeStoneWorkshopRecord,
    readArcadeStoneWorkshopRecord,
    resolveArcadeStoneLevelCap,
    resolveArcadeStoneRequiredLevel,
    resolveArcadeStoneSlotStatus,
    resolveArcadeStoneUpgradeCost,
    saveArcadeStoneWorkshopRecord,
} from '../src/shared/contracts/ArcadeStoneWorkshopContract.js';
import {
    applyArcadeStonePlacement,
    describeArcadeStoneWeakness,
    listArcadeStoneFallbacks,
    listArcadeStonesForVehicle,
    normalizeArcadeStoneSlots,
    resolveArcadeStoneDraftSteps,
    resolveArcadeStoneEffectiveLevel,
    resolveArcadeStoneExtraSteps,
    resolveArcadeStonePlacementPlan,
    resolveArcadeStoneVisualPartId,
} from '../src/shared/contracts/ArcadeStonePlacementContract.js';
import { resolveArcadeVehicleActiveStats } from '../src/shared/contracts/ArcadeVehicleActiveStatsContract.js';
import { spendArcadeVehicleXp } from '../src/shared/contracts/ArcadeVehicleBuildContract.js';
import {
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    createArcadeVehicleProfileRecord,
    normalizeArcadeVehicleProfileRecord,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    PLAYER_PROFILE_RECORD_KINDS,
    getPlayerProfileRecordDefinitionByKind,
    resolvePlayerScopedStorageKey,
} from '../src/shared/contracts/PlayerProfileStorageContract.js';
import {
    addXp,
    createArcadeVehicleProfile,
    getArcadeRunVehicleBonuses,
    loadVehicleProfiles,
    resolveArcadeRunHudVehicleStats,
    saveVehicleProfiles,
    xpForLevel,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import { createArcadePlayerUpgradeBonusMap } from '../src/core/arcade/ArcadeRunVehicleRewardOps.js';
import { normalizeArcadeUpgradeBonuses } from '../src/modes/ArcadeVehicleStatOps.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { prepareArcadePlayerProfileBindings } from '../src/core/arcade/ArcadePlayerProfileBindings.js';
import { applyArcadeRuntimeCosmetics } from '../src/core/arcade/ArcadeRuntimeCosmeticOps.js';
import { DemolitionRuntime } from '../src/core/arcade/DemolitionRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { resolveArcadePostMatchProgression } from '../src/core/arcade/ArcadePostMatchProgression.js';
import { buildArcadeProgressionBlock } from '../src/ui/postmatch/PostMatchArcadeProgressionBlock.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { ARENA_WAVES_COMBAT_PROFILE } from '../src/shared/contracts/ArenaWavesContract.js';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function sizes(partial = {}) {
    return { hull: 100, nose: 100, wings: 100, engines: 100, utility: 100, ...partial };
}

function profileOf(vehicleId, { level = 1, xpBank = 0, partSizes = {}, packages = [], ...extra } = {}) {
    return {
        ...createArcadeVehicleProfileRecord(vehicleId, 0),
        level,
        xpBank,
        spentUpgradeXp: 0,
        sizeWorkshopUnlocked: true,
        purchasedSizeSteps: 25,
        partSizes: sizes(partSizes),
        stoneSlotPackages: packages,
        ...extra,
    };
}

function stoneId(serial) {
    return `stone-${String(serial).padStart(4, '0')}`;
}

function stone(serial, level = 1, placement = null) {
    return { stoneId: stoneId(serial), level, placement };
}

function poolOf(stones) {
    return normalizeArcadeStoneWorkshopRecord({
        schemaVersion: ARCADE_STONE_WORKSHOP_SCHEMA_VERSION,
        nextSerial: 1,
        stones,
        updatedAt: '2026-09-28T00:00:00.000Z',
    }, 0);
}

function at(vehicleId, slotId) {
    return { vehicleId, slotId };
}

/** Speicher mit readJsonRecordResult wie der echte Spieler-Speicherport. */
function createStore(initial = {}, { readStatus = null } = {}) {
    const records = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
    const writes = [];
    return {
        records,
        writes,
        readJsonRecordResult(key) {
            if (readStatus) return { ok: false, status: readStatus, value: null, reason: readStatus };
            if (!records.has(key)) return { ok: true, status: 'missing', value: null, reason: 'missing' };
            return { ok: true, status: 'found', value: JSON.parse(records.get(key)), reason: 'ok' };
        },
        loadJsonRecord(key, fallback = null) {
            return records.has(key) ? JSON.parse(records.get(key)) : fallback;
        },
        saveJsonRecord(key, value) {
            writes.push(key);
            records.set(key, JSON.stringify(value));
            return { success: true, reason: 'ok' };
        },
    };
}

// --- Pool: Anlegen, Normalisieren, Lesen ---

test('Neuer Pool: drei Gratis-Steine auf Stufe 1, frei, nächste Nummer 4', () => {
    const pool = createArcadeStoneWorkshopRecord(0);
    assert.equal(pool.schemaVersion, 'arcade-stone-workshop.v1');
    assert.deepEqual(pool.stones.map((entry) => entry.stoneId), ['stone-0001', 'stone-0002', 'stone-0003']);
    assert.ok(pool.stones.every((entry) => entry.level === 1 && entry.placement === null));
    assert.equal(pool.nextSerial, 4);
});

test('Normalisierer: Obergrenze 21, erste ID gewinnt, keine Doppelbelegung, Stufe ganzzahlig', () => {
    const many = normalizeArcadeStoneWorkshopRecord({ stones: Array.from({ length: 22 }, (_, i) => stone(i + 1)) }, 0);
    assert.equal(many.stones.length, 21);

    const pool = poolOf([
        stone(1, 2, at('ship5', 'core')),
        stone(1, 5),
        stone(2, 1, at('ship5', 'core')),
        stone(3, 0),
        stone(4, Number.NaN),
        stone(5, 1e300),
        stone(6, 1, at('ship5', 'tail')),
        stone(7, 1, at('', 'core')),
        { stoneId: 'gem-1', level: 1, placement: null },
    ]);
    assert.deepEqual(pool.stones.map((entry) => entry.stoneId),
        ['stone-0001', 'stone-0002', 'stone-0003', 'stone-0004', 'stone-0005', 'stone-0006', 'stone-0007']);
    assert.equal(pool.stones[0].level, 2, 'bei doppelter ID gewinnt die erste');
    assert.deepEqual(pool.stones[0].placement, at('ship5', 'core'));
    assert.equal(pool.stones[1].placement, null, 'der zweite Stein auf ship5.core wird frei');
    assert.equal(pool.stones[2].level, 1, 'Stufe 0 wird 1');
    assert.equal(pool.stones[3].level, 1, 'NaN wird 1');
    assert.equal(pool.stones[4].level, MAX_SAFE, '1e300 wird MAX_SAFE_INTEGER');
    assert.equal(pool.stones[5].placement, null, 'unbekannter Platz');
    assert.equal(pool.stones[6].placement, null, 'leeres Fahrzeug');
    assert.equal(pool.nextSerial, 8, 'nextSerial liegt über der höchsten Nummer');
});

test('Lesen: missing und fremdes Schema legen neu an, Lesefehler sperren ohne zu schreiben', () => {
    const missing = readArcadeStoneWorkshopRecord(createStore(), 0);
    assert.equal(missing.status, 'created');
    assert.equal(missing.pool.stones.length, 3);

    const foreign = readArcadeStoneWorkshopRecord(createStore({ [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: { schemaVersion: 'x', stones: [] } }), 0);
    assert.equal(foreign.status, 'created');
    assert.equal(foreign.pool.stones.length, 3);

    for (const readStatus of ['read_failed', 'invalid']) {
        const store = createStore({}, { readStatus });
        const result = readArcadeStoneWorkshopRecord(store, 0);
        assert.deepEqual(result, { status: 'unavailable', pool: null }, readStatus);
        const purchase = evaluateArcadeStonePurchase(result.pool, profileOf('ship5', { xpBank: 1000 }), 0);
        assert.equal(purchase.ok, false);
        assert.equal(purchase.reason, 'storage_unavailable');
        assert.equal(applyArcadeStonePlacement(result.pool, 'ship5', {}, profileOf('ship5')).reason, 'storage_unavailable');
        assert.deepEqual(store.writes, [], `${readStatus}: saveJsonRecord wird nie gerufen`);
    }
    assert.equal(readArcadeStoneWorkshopRecord({ loadJsonRecord: () => null }, 0).status, 'unavailable',
        'ohne readJsonRecordResult kein Pool');

    const saved = poolOf([stone(1, 3, at('ship5', 'nose'))]);
    const found = readArcadeStoneWorkshopRecord(createStore({ [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: saved }), 0);
    assert.equal(found.status, 'ok');
    assert.deepEqual(found.pool, saved);
});

// --- XP-Käufe ---

test('Kauf: neuer Stein kostet 200 XP, höchstens 21, ohne XP bleibt alles gleich', () => {
    const pool = createArcadeStoneWorkshopRecord(0);
    const profile = profileOf('ship5', { xpBank: 250, spentUpgradeXp: 40 });
    const bought = evaluateArcadeStonePurchase(pool, profile, 0);
    assert.equal(bought.ok, true);
    assert.equal(bought.cost, 200);
    assert.equal(bought.next.xpBank, 50);
    assert.equal(bought.next.spentUpgradeXp, 240);
    assert.deepEqual(bought.pool.stones.at(-1), { stoneId: 'stone-0004', level: 1, placement: null });
    assert.equal(bought.pool.nextSerial, 5);

    const full = normalizeArcadeStoneWorkshopRecord({ stones: Array.from({ length: 21 }, (_, i) => stone(i + 1)) }, 0);
    assert.equal(evaluateArcadeStonePurchase(full, profile, 0).reason, 'stone_limit');
    const saturated = normalizeArcadeStoneWorkshopRecord({ stones: [stone(MAX_SAFE)] }, 0);
    assert.equal(evaluateArcadeStonePurchase(saturated, profile, 0).reason, 'stone_limit', 'nie eine doppelte ID gegen XP');

    const poor = profileOf('ship5', { xpBank: 199 });
    const poolBefore = structuredClone(pool);
    const profileBefore = structuredClone(poor);
    const refused = evaluateArcadeStonePurchase(pool, poor, 0);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'insufficient_xp');
    assert.equal(refused.next, null);
    assert.equal(refused.pool, null);
    assert.deepEqual(pool, poolBefore);
    assert.deepEqual(poor, profileBefore);
});

test('Aufwerten: Stufe n kostet 100 * n² und ist ab Level 10 * (n - 1) des bezahlenden Fahrzeugs kaufbar', () => {
    const pool = poolOf([stone(1)]);
    const locked = evaluateArcadeStoneUpgrade(pool, profileOf('ship5', { level: 9, xpBank: 5000 }), 'stone-0001', 0);
    assert.equal(locked.reason, 'stone_level_locked');
    assert.equal(locked.requiredLevel, 10);
    assert.equal(locked.cost, 400);

    const upgraded = evaluateArcadeStoneUpgrade(pool, profileOf('ship5', { level: 10, xpBank: 400 }), 'stone-0001', 0);
    assert.equal(upgraded.ok, true);
    assert.equal(upgraded.cost, 400);
    assert.equal(upgraded.next.xpBank, 0);
    assert.equal(upgraded.pool.stones[0].level, 2);
    assert.equal(pool.stones[0].level, 1, 'der alte Pool bleibt unverändert');

    const poor = evaluateArcadeStoneUpgrade(pool, profileOf('ship5', { level: 10, xpBank: 399 }), 'stone-0001', 0);
    assert.equal(poor.reason, 'insufficient_xp');
    assert.equal(evaluateArcadeStoneUpgrade(pool, profileOf('ship5', { level: 50 }), 'stone-0042', 0).reason, 'unknown_stone');
    assert.equal(evaluateArcadeStoneUpgrade(null, profileOf('ship5'), 'stone-0001', 0).reason, 'storage_unavailable');

    assert.equal(resolveArcadeStoneUpgradeCost(3), 900);
    assert.equal(resolveArcadeStoneUpgradeCost(5), 2500);
    assert.equal(resolveArcadeStoneUpgradeCost(1e8), MAX_SAFE);
    assert.equal(resolveArcadeStoneRequiredLevel(1), 1);
    assert.equal(resolveArcadeStoneRequiredLevel(3), 20);
    assert.equal(resolveArcadeStoneLevelCap(9), 1);
    assert.equal(resolveArcadeStoneLevelCap(20), 3);
});

test('Steinplatz-Pakete: Flügel ab Level 3 für 250, Antriebe ab 6 für 500, Utility ab 10 für 900', () => {
    const early = evaluateArcadeStoneSlotPackagePurchase(profileOf('ship5', { level: 2, xpBank: 5000 }), 'wings');
    assert.equal(early.reason, 'package_level_locked');
    assert.equal(early.requiredLevel, 3);

    const wings = evaluateArcadeStoneSlotPackagePurchase(profileOf('ship5', { level: 3, xpBank: 250 }), 'wings');
    assert.equal(wings.ok, true);
    assert.equal(wings.cost, 250);
    assert.deepEqual(wings.next.stoneSlotPackages, ['wings']);
    assert.equal(wings.next.xpBank, 0);
    assert.equal(evaluateArcadeStoneSlotPackagePurchase(wings.next, 'wings').reason, 'already_owned');

    const engines = evaluateArcadeStoneSlotPackagePurchase(profileOf('ship5', { level: 6, xpBank: 500 }), 'engines');
    assert.equal(engines.ok, true);
    assert.equal(engines.cost, 500);
    const utility = evaluateArcadeStoneSlotPackagePurchase(profileOf('ship5', { level: 10, xpBank: 900 }), 'utility');
    assert.equal(utility.ok, true);
    assert.equal(utility.cost, 900);
    assert.equal(evaluateArcadeStoneSlotPackagePurchase(profileOf('ship5', { level: 10, xpBank: 899 }), 'utility').reason, 'insufficient_xp');
    assert.equal(evaluateArcadeStoneSlotPackagePurchase(profileOf('ship5', { level: 99 }), 'tail').reason, 'unknown_package');
    assert.equal(evaluateArcadeStoneSlotPackagePurchase(profileOf('ship5'), 'base').reason, 'already_owned');

    assert.deepEqual(resolveArcadeStoneSlotStatus(profileOf('ship5'), 'nose'),
        { unlocked: true, packageId: 'base', requiredLevel: 1, costXp: 0 });
    assert.deepEqual(resolveArcadeStoneSlotStatus(profileOf('ship5'), 'engine_right'),
        { unlocked: false, packageId: 'engines', requiredLevel: 6, costXp: 500 });
    assert.deepEqual(normalizeArcadeStoneSlotPackages(['utility', 'wings', 'wings', 'tail', 7]), ['wings', 'utility']);
    assert.equal(formatArcadeStonePackageLabel('engines'), 'Antriebspaar');

    const pool = poolOf([stone(1, 1, at('ship5', 'wing_left'))]);
    const plan = resolveArcadeStonePlacementPlan(pool, 'ship5', { wing_left: 'stone-0001' }, profileOf('ship5', { level: 20 }));
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.errors, [{ code: 'slot_locked', slotId: 'wing_left', stoneId: 'stone-0001' }]);
    assert.equal(resolveArcadeStoneExtraSteps(pool, 'ship5', profileOf('ship5', { level: 20 })).wings, 0,
        'ein Stein auf einem nicht gekauften Platz wirkt nicht');
});

// --- Wirksame Stufe und Warnsymbol ---

test('Wirksame Stufe: min(Steinstufe, 1 + Level/10), unter 125 % höchstens T1, Gründe als Liste', () => {
    assert.deepEqual(resolveArcadeStoneEffectiveLevel(3, 1, 125), { effective: 1, reasons: ['level'], fullLevel: 20 });
    assert.deepEqual(resolveArcadeStoneEffectiveLevel(3, 20, 125), { effective: 3, reasons: [], fullLevel: 20 });
    assert.deepEqual(resolveArcadeStoneEffectiveLevel(3, 20, 120), { effective: 1, reasons: ['size'], fullLevel: 20 });
    assert.deepEqual(resolveArcadeStoneEffectiveLevel(3, 5, 110), { effective: 1, reasons: ['size', 'level'], fullLevel: 20 });
    assert.deepEqual(resolveArcadeStoneEffectiveLevel(5, 35, 125), { effective: 4, reasons: ['level'], fullLevel: 40 });
    assert.deepEqual(resolveArcadeStoneEffectiveLevel(1, 1, 80), { effective: 1, reasons: [], fullLevel: 1 });
});

test('Warntexte nennen Grund und Abstand wörtlich', () => {
    assert.equal(describeArcadeStoneWeakness(resolveArcadeStoneEffectiveLevel(3, 5, 110), 'wing_left', 110),
        'Wirkt als T1 – Flügel auf 125 % bringen (jetzt 110 %) · volle Stufe ab Level 20');
    assert.equal(describeArcadeStoneWeakness(resolveArcadeStoneEffectiveLevel(3, 10, 125), 'core', 125),
        'Wirkt als T2 – volle Stufe ab Level 20');
    assert.equal(describeArcadeStoneWeakness(resolveArcadeStoneEffectiveLevel(2, 30, 125), 'nose', 125), '');
    assert.deepEqual([1, 2, 3, 4, 9].map(resolveArcadeStoneVisualPartId),
        ['stone_violet_t1', 'stone_violet_t2', 'stone_violet_t3', 'stone_violet_t3', 'stone_violet_t3']);
});

// --- Wertwirkung über die eine Rechenstelle ---

function activeStats(profile, pool) {
    return resolveArcadeVehicleActiveStats(profile.vehicleId, profile, resolveArcadeStoneExtraSteps(pool, profile.vehicleId, profile));
}

test('Wertwirkung: jeder Flügelstein zählt einzeln, unter 125 % nur als T1', () => {
    const pool = poolOf([stone(1, 3, at('ship5', 'wing_left')), stone(2, 2, at('ship5', 'wing_right'))]);
    const full = profileOf('ship5', { level: 20, partSizes: { wings: 125 }, packages: ['wings'] });
    assert.deepEqual(resolveArcadeStoneExtraSteps(pool, 'ship5', full), { hull: 0, nose: 0, wings: 5, engines: 0, utility: 0 });
    assert.ok(Object.isFrozen(resolveArcadeStoneExtraSteps(pool, 'ship5', full)));
    assert.equal(activeStats(full, pool).turnPct, 130);
    assert.equal(activeStats(full, pool).rollPct, 120);

    const smaller = profileOf('ship5', { level: 20, partSizes: { wings: 120 }, packages: ['wings'] });
    assert.equal(activeStats(smaller, pool).turnPct, 118);
    assert.equal(activeStats(smaller, pool).rollPct, 112);
    assert.deepEqual(listArcadeStonesForVehicle(pool, 'ship5').map((entry) => entry.slotId), ['wing_left', 'wing_right']);
});

test('Wertwirkung: Rumpf, Nase und Utility wirken mit Haupt- und Nebenwert, ohne Lagerstufen', () => {
    const profile = profileOf('ship5', { level: 10, packages: ['utility'], purchasedItemSlots: 1 });
    const hull = activeStats(profile, poolOf([stone(1, 1, at('ship5', 'core'))]));
    assert.equal(hull.maxHpPct, 104);
    assert.equal(hull.regenDelay, 2.88);
    const nose = activeStats(profile, poolOf([stone(1, 1, at('ship5', 'nose'))]));
    assert.equal(nose.damagePct, 103);
    assert.equal(nose.rangePct, 102);
    const utility = activeStats(profile, poolOf([stone(1, 1, at('ship5', 'utility'))]));
    assert.equal(utility.shieldPct, 104);
    assert.equal(utility.itemCapacity, 5, 'ein Utility-Stein erreicht keine Lagerstufe');
    assert.deepEqual(activeStats(profile, poolOf([stone(1, 1, at('manta', 'core'))])), resolveArcadeVehicleActiveStats('ship5', profile),
        'Steine anderer Fahrzeuge wirken hier nicht');
});

test('Rückfall: Verkleinern zeigt, welche Steine auf eine niedrigere Stufe fallen', () => {
    const pool = poolOf([stone(1, 3, at('ship5', 'wing_left')), stone(2, 1, at('ship5', 'wing_right'))]);
    const before = profileOf('ship5', { level: 20, partSizes: { wings: 125 }, packages: ['wings'] });
    const after = profileOf('ship5', { level: 20, partSizes: { wings: 120 }, packages: ['wings'] });
    assert.deepEqual(listArcadeStoneFallbacks(pool, 'ship5', before, after),
        [{ stoneId: 'stone-0001', slotId: 'wing_left', from: 3, to: 1 }]);
    assert.deepEqual(listArcadeStoneFallbacks(pool, 'ship5', after, before), []);
});

// --- Umstecken und Vorlagen ---

test('Wechsel: ein Stein aus einem anderen Fahrzeug verlangt eine Bestätigung', () => {
    const pool = poolOf([stone(1, 1, at('ship5', 'core')), stone(2)]);
    const snapshot = structuredClone(pool);
    const manta = profileOf('manta');
    const refused = applyArcadeStonePlacement(pool, 'manta', { core: 'stone-0001' }, manta, { nowMs: 0 });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'transfer_confirmation_required');
    assert.deepEqual(refused.transfers, [{ stoneId: 'stone-0001', fromVehicleId: 'ship5', fromSlot: 'core' }]);
    assert.equal(refused.pool, null);
    assert.deepEqual(pool, snapshot, 'der Pool bleibt unverändert');

    const moved = applyArcadeStonePlacement(pool, 'manta', { core: 'stone-0001' }, manta, { confirmTransfers: true, nowMs: 0 });
    assert.equal(moved.ok, true);
    assert.deepEqual(moved.pool.stones[0].placement, at('manta', 'core'));
    assert.deepEqual(listArcadeStonesForVehicle(moved.pool, 'ship5'), []);
    assert.deepEqual(pool, snapshot);

    const cleared = applyArcadeStonePlacement(moved.pool, 'manta', { nose: 'stone-0002' }, manta, { nowMs: 0 });
    assert.equal(cleared.ok, true, 'Umstecken im selben Fahrzeug braucht keine Bestätigung');
    assert.equal(cleared.pool.stones[0].placement, null, 'nicht mehr gewünschte Steine werden frei');
    assert.deepEqual(cleared.pool.stones[1].placement, at('manta', 'nose'));
});

test('Vorlage: fehlende Steine erscheinen unter missing, doppelte werden abgelehnt, der Pool bleibt gleich', () => {
    const pool = poolOf([stone(1), stone(2)]);
    const snapshot = structuredClone(pool);
    const plan = resolveArcadeStonePlacementPlan(pool, 'ship5', { core: 'stone-0099', nose: 'stone-0001' }, profileOf('ship5'));
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.missing, [{ slotId: 'core', stoneId: 'stone-0099' }]);
    assert.deepEqual(plan.transfers, []);
    assert.deepEqual(pool, snapshot);
    const applied = applyArcadeStonePlacement(pool, 'ship5', { core: 'stone-0099', nose: 'stone-0001' }, profileOf('ship5'), { nowMs: 0 });
    assert.deepEqual(listArcadeStonesForVehicle(applied.pool, 'ship5'), [{ stoneId: 'stone-0001', level: 1, slotId: 'nose' }]);

    const twice = resolveArcadeStonePlacementPlan(pool, 'ship5', { core: 'stone-0001', nose: 'stone-0001' }, profileOf('ship5'));
    assert.deepEqual(twice.errors, [{ code: 'duplicate_stone', slotId: 'nose', stoneId: 'stone-0001' }]);
    assert.equal(applyArcadeStonePlacement(pool, 'ship5', { core: 'stone-0001', nose: 'stone-0001' }, profileOf('ship5')).reason, 'duplicate_stone');

    assert.deepEqual(normalizeArcadeStoneSlots({ core: 'stone-0001', nose: 'stone-0001', utility: 'gem', tail: 'stone-0002' }), {
        core: 'stone-0001', nose: null, wing_left: null, wing_right: null, engine_left: null, engine_right: null, utility: null,
    });
});

test('Entwurfsvorschau rechnet auf einer bestätigten Kopie, ohne den Pool zu ändern', () => {
    const pool = poolOf([stone(1, 1, at('ship5', 'core'))]);
    const snapshot = structuredClone(pool);
    const manta = profileOf('manta');
    assert.equal(resolveArcadeStoneDraftSteps(pool, 'manta', { core: 'stone-0001' }, manta).hull, 1);
    assert.equal(resolveArcadeStoneExtraSteps(pool, 'manta', manta).hull, 0);
    assert.deepEqual(pool, snapshot);
});

// --- Speichern ---

test('Speichern und Wiederladen: Pool, Profil-Pakete und Speicher-Art überstehen den Neustart', () => {
    const store = createStore();
    const pool = poolOf([stone(1, 4, at('manta', 'nose')), stone(2)]);
    saveArcadeStoneWorkshopRecord(store, pool);
    assert.deepEqual(readArcadeStoneWorkshopRecord(store, 0), { status: 'ok', pool });

    const profile = profileOf('manta', { packages: ['utility', 'wings'] });
    const reloaded = normalizeArcadeVehicleProfileRecord('manta', JSON.parse(JSON.stringify(profile)));
    assert.deepEqual(reloaded.stoneSlotPackages, ['wings', 'utility']);
    assert.deepEqual(createArcadeVehicleProfileRecord('ship5', 0).stoneSlotPackages, []);

    const definition = getPlayerProfileRecordDefinitionByKind(PLAYER_PROFILE_RECORD_KINDS.ARCADE_STONE_WORKSHOP);
    assert.equal(definition.suffix, 'arcade-stone-workshop.v1');
    assert.equal(definition.legacyKey, ARCADE_STONE_WORKSHOP_STORAGE_KEY);
    assert.equal(resolvePlayerScopedStorageKey('p1', ARCADE_STONE_WORKSHOP_STORAGE_KEY), 'cuviosclash.player.p1.arcade-stone-workshop.v1');
});

test('Speicherreihenfolge: erst der Pool, dann das Profil; Schreibfehler werden zurückgemeldet', () => {
    const order = [];
    const store = createStore();
    const originalSave = store.saveJsonRecord;
    store.saveJsonRecord = (key, value) => { order.push('pool'); return originalSave(key, value); };
    const bought = evaluateArcadeStonePurchase(createArcadeStoneWorkshopRecord(0), profileOf('ship5', { xpBank: 300 }), 0);
    assert.deepEqual(commitArcadeStoneWorkshopResult(store, bought, () => { order.push('profile'); }), { ok: true, reason: 'ok' });
    assert.deepEqual(order, ['pool', 'profile']);

    const failing = createStore();
    failing.saveJsonRecord = () => ({ success: false, reason: 'quota_exceeded' });
    let profileSaved = false;
    const result = commitArcadeStoneWorkshopResult(failing, bought, () => { profileSaved = true; });
    assert.deepEqual(result, { ok: false, reason: 'pool_save_failed' });
    assert.equal(profileSaved, false, 'nie XP ohne Stein');
    const unreadable = createStore({}, { readStatus: 'read_failed' });
    assert.deepEqual(commitArcadeStoneWorkshopResult(unreadable, bought, () => true), {
        ok: false, reason: 'pool_read_failed',
    });
    assert.deepEqual(unreadable.writes, [], 'ohne vorigen Pool gibt es keine nicht rückrollbare Änderung');
    const failedProfileStore = createStore();
    assert.deepEqual(commitArcadeStoneWorkshopResult(failedProfileStore, bought, () => false), {
        ok: false, reason: 'profile_save_failed',
    });
    assert.equal(readArcadeStoneWorkshopRecord(failedProfileStore, 0).pool.stones.length, 3,
        'bei Profilfehler wird der vor dem Kauf gelesene Pool wiederhergestellt');

    const upgradeStore = createStore({
        [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, 1, at('ship5', 'core'))]),
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { ship5: profileOf('ship5', { level: 10, xpBank: 500 }) },
    });
    const originalPool = readArcadeStoneWorkshopRecord(upgradeStore, 0).pool;
    const originalProfile = loadVehicleProfiles(upgradeStore).ship5;
    const upgrade = evaluateArcadeStoneUpgrade(originalPool, originalProfile, 'stone-0001', 0);
    assert.ok(upgrade.ok);
    assert.deepEqual(commitArcadeStoneWorkshopResult(upgradeStore, upgrade, () => false), {
        ok: false, reason: 'profile_save_failed',
    });
    assert.deepEqual(readArcadeStoneWorkshopRecord(upgradeStore, 0).pool, originalPool,
        'ein erfolgreicher Pool-Write wird bei fehlendem XP-Profilwrite zurückgerollt');
    assert.equal(loadVehicleProfiles(upgradeStore).ship5.xpBank, 500, 'fehlgeschlagener Profilsave zieht keine XP ab');

    const rollbackFailureStore = createStore({
        [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: originalPool,
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { ship5: originalProfile },
    });
    const save = rollbackFailureStore.saveJsonRecord;
    let poolWrites = 0;
    rollbackFailureStore.saveJsonRecord = (key, value) => {
        if (key === ARCADE_STONE_WORKSHOP_STORAGE_KEY && ++poolWrites === 2) return { success: false, reason: 'quota_exceeded' };
        return save(key, value);
    };
    assert.deepEqual(commitArcadeStoneWorkshopResult(rollbackFailureStore, upgrade, () => false), {
        ok: false, reason: 'profile_save_failed_pool_rollback_failed',
    });
    assert.equal(loadVehicleProfiles(rollbackFailureStore).ship5.xpBank, 500, 'fehlgeschlagener Profilsave bleibt ohne XP-Verlust');
    assert.equal(readArcadeStoneWorkshopRecord(rollbackFailureStore, 0).pool.stones[0].level, 2,
        'der Fehlerstatus macht den nicht zurückgerollten Pool sichtbar');
    assert.equal(commitArcadeStoneWorkshopResult(store, { ok: false, reason: 'insufficient_xp' }, () => {}).reason, 'insufficient_xp');

    const pkg = evaluateArcadeStoneSlotPackagePurchase(profileOf('ship5', { level: 3, xpBank: 250 }), 'wings');
    let savedProfile = null;
    assert.equal(commitArcadeStoneWorkshopResult(failing, pkg, (next) => { savedProfile = next; }).ok, true, 'ohne Pool nur das Profil');
    assert.deepEqual(savedProfile.stoneSlotPackages, ['wings']);
    assert.deepEqual(commitArcadeStoneWorkshopResult(store, pkg, () => false), { ok: false, reason: 'profile_save_failed' });
    assert.equal(spendArcadeVehicleXp(profileOf('ship5', { xpBank: 10 }), 20, {}).reason, 'insufficient_xp');
});

// --- Laufzeit ---

const ARCADE_CONFIG = Object.freeze({
    ...DEFAULT_ENTITY_RUNTIME_CONFIG,
    HUNT: { ...DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT, ACTIVE_MODE: 'ARCADE' },
});

function makePlayer(vehicleId, extra = {}) {
    return {
        index: 0, vehicleId, isBot: false, alive: true, baseSpeed: 40, speed: 40, turnSpeed: 2, hasShield: false,
        maxHp: 1, hp: 1, maxShieldHp: 1, shieldHP: 0, inventory: [], rocketInventory: [], activeEffects: [],
        entityRuntimeConfig: ARCADE_CONFIG,
        ...extra,
    };
}

test('Run-Boni: nur der Build mit eingefrorenen Stein-Schritten, die Trefferzone bleibt bei den Profilgrößen', () => {
    const profile = profileOf('ship5', { partSizes: { hull: 110 } });
    const store = createStore({ [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, 1, at('ship5', 'core'))]) });
    const bonuses = getArcadeRunVehicleBonuses(profile, store);
    assert.deepEqual(Object.keys(bonuses), ['build']);
    assert.deepEqual(bonuses.build.stoneSteps, { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 });
    assert.ok(Object.isFrozen(bonuses.build.stoneSteps));
    assert.deepEqual(bonuses.build.stoneSlotPackages, []);
    const normalized = normalizeArcadeUpgradeBonuses(bonuses, null, true);
    assert.equal(normalized.build.maxHpPct, 112, 'Rumpf 110 % plus ein Stein: drei Schritte');
    assert.deepEqual(normalized.partSizes, profile.partSizes);
    assert.equal(getArcadeRunVehicleBonuses(profile).build.stoneSteps.hull, 0, 'ohne Speicher keine Steine');
    assert.equal(getArcadeRunVehicleBonuses(profile, createStore({}, { readStatus: 'read_failed' })).build.stoneSteps.hull, 0);

    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades(bonuses);
    const human = makePlayer('ship5');
    const bot = makePlayer('ship5', { isBot: true });
    for (const player of [human, bot]) {
        strategy.resetPlayerHealth(player);
        strategy.applySpawnStatBonuses(player);
    }
    assert.equal(human.maxHp, 112);
    assert.deepEqual(human.arcadePartSizes, profile.partSizes, 'Steine vergrößern die Trefferzone nie');
    assert.equal(bot.maxHp, 100, 'Bots bekommen keinen Build');
    assert.equal(bot.arcadeDamageMultiplier, 1);

    const daily = new ArcadeModeStrategy({ runType: 'gauntlet', isDailyChallenge: true });
    daily.applyVehicleUpgrades(bonuses);
    const dailyPlayer = makePlayer('ship5');
    daily.resetPlayerHealth(dailyPlayer);
    assert.equal(dailyPlayer.maxHp, 100, 'Daily ohne Steine');
    const race = new ArcadeModeStrategy({ runType: 'weapon_race' });
    race.applyVehicleUpgrades(bonuses);
    assert.equal(race._upgradeBonusesFor(makePlayer('ship5')).build, null, 'Waffenrennen ohne Steine');
});

test('Drei lokale Piloten: gleiche Fahrzeug-ID und getrennte Bonusmaps je Profil', () => {
    const slots = ['core', 'nose', 'wing_left'];
    const profilesByPlayerIndex = Object.create(null);
    const storesByPlayerIndex = Object.create(null);
    for (let index = 0; index < 3; index += 1) {
        const store = createStore({
            [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(index + 1, index + 1, at('ship5', slots[index]))]),
        });
        saveVehicleProfiles(store, { ship5: profileOf('ship5', {
            level: 20,
            xp: xpForLevel(20),
            packages: index === 2 ? ['wings'] : [],
            xpBank: 100 + index,
        }) });
        storesByPlayerIndex[index] = store;
        profilesByPlayerIndex[index] = loadVehicleProfiles(store);
    }
    const players = [0, 1, 2].map((index) => ({ index, isBot: false, vehicleId: 'ship5' }));
    const first = createArcadePlayerUpgradeBonusMap(profilesByPlayerIndex, players, {
        buildOnly: true,
        storesByPlayerIndex,
    });
    const builds = [0, 1, 2].map((index) => first.byPlayerIndex[index].build);

    assert.deepEqual(Object.keys(first.byPlayerIndex), ['0', '1', '2']);
    assert.deepEqual(builds.map((build) => build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ]);
    assert.deepEqual(builds.map((build) => build.stoneSlotPackages), [[], [], ['wings']]);
    assert.notEqual(builds[0], builds[1], 'gleiche vehicleId dedupliziert keine getrennten Profile');
    assert.deepEqual([0, 1, 2].map((index) => loadVehicleProfiles(storesByPlayerIndex[index]).ship5.xpBank), [100, 101, 102],
        'Profil-XP übersteht den JSON-Roundtrip je Store/UUID');

    const stoneStepsByPlayerIndex = Object.fromEntries(builds.map((build, index) => [index, {
        vehicleId: build.vehicleId,
        stoneSteps: build.stoneSteps,
    }]));
    for (const store of Object.values(storesByPlayerIndex)) {
        store.records.set(ARCADE_STONE_WORKSHOP_STORAGE_KEY, JSON.stringify(poolOf([])));
    }
    const rebuilt = createArcadePlayerUpgradeBonusMap(profilesByPlayerIndex, players, {
        buildOnly: true,
        storesByPlayerIndex,
        stoneStepsByPlayerIndex,
    });
    assert.deepEqual([0, 1, 2].map((index) => rebuilt.byPlayerIndex[index].build.stoneSteps),
        builds.map((build) => build.stoneSteps), 'Sitzungsumbau übernimmt je Profil den Run-Start-Snapshot');
});

test('Demolition Rebuild: drei UUIDs mit gleicher Fahrzeug-ID behalten getrennte Steinpools', () => {
    const slots = ['core', 'nose', 'wing_left'];
    const profiles = Object.create(null);
    const storesByPlayerIndex = Object.create(null);
    for (let index = 0; index < 3; index += 1) {
        const store = createStore({
            [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(index + 1, index + 1, at('ship5', slots[index]))]),
        });
        const packages = index === 2 ? ['wings'] : [];
        saveVehicleProfiles(store, { ship5: profileOf('ship5', {
            level: 20,
            xp: xpForLevel(20),
            packages,
            xpBank: 100 + index,
        }) });
        storesByPlayerIndex[index] = store;
        profiles[index] = loadVehicleProfiles(store);
    }
    const players = [0, 1, 2].map((index) => ({ index, isBot: false, vehicleId: 'ship5' }));
    const first = createArcadePlayerUpgradeBonusMap(profiles, players, {
        buildOnly: true,
        storesByPlayerIndex,
    });
    const builds = [0, 1, 2].map((index) => first.byPlayerIndex[index].build);

    assert.deepEqual(Object.keys(first.byPlayerIndex), ['0', '1', '2']);
    assert.deepEqual(builds.map((build) => build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ]);
    assert.notEqual(builds[0], builds[1], 'gleiche vehicleId dedupliziert keine Demo-Spielerprofile');
    assert.notEqual(builds[0].stoneSlotPackages, builds[1].stoneSlotPackages);
    assert.equal(loadVehicleProfiles(storesByPlayerIndex[0]).ship5.xpBank, 100, 'Profil-Roundtrip UUID 0');
    assert.equal(loadVehicleProfiles(storesByPlayerIndex[1]).ship5.xpBank, 101, 'Profil-Roundtrip UUID 1');
    assert.equal(loadVehicleProfiles(storesByPlayerIndex[2]).ship5.xpBank, 102, 'Profil-Roundtrip UUID 2');

    const stoneStepsByPlayerIndex = Object.fromEntries(builds.map((build, index) => [index, {
        vehicleId: build.vehicleId,
        stoneSteps: build.stoneSteps,
    }]));
    for (const store of Object.values(storesByPlayerIndex)) {
        store.records.set(ARCADE_STONE_WORKSHOP_STORAGE_KEY, JSON.stringify(poolOf([])));
    }
    const rebuilt = createArcadePlayerUpgradeBonusMap(profiles, players, {
        buildOnly: true,
        storesByPlayerIndex,
        stoneStepsByPlayerIndex,
    });
    assert.deepEqual([0, 1, 2].map((index) => rebuilt.byPlayerIndex[index].build.stoneSteps),
        builds.map((build) => build.stoneSteps), 'Sitzungsumbau übernimmt je UUID den Start-Snapshot statt erneut aus dem Pool zu lesen');
});

test('Demolition Runtime-Cosmetics: Pool-Snapshots bleiben bei drei gleichen Fahrzeugen pro UUID getrennt', () => {
    const slots = ['core', 'nose', 'wing_left'];
    const stores = slots.map((slotId, index) => {
        const store = createStore({
            [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(index + 1, 1, at('ship5', slotId))]),
        });
        saveVehicleProfiles(store, { ship5: profileOf('ship5', { level: 20, xpBank: 100 + index, packages: index === 2 ? ['wings'] : [] }) });
        return store;
    });
    const players = stores.map((_, index) => makePlayer('ship5', { index, isBot: false }));
    const runtime = {
        phase: 'active',
        playerBindings: new Map(stores.map((store, index) => [index, { profileId: `profile-${index}`, store }])),
    };
    let captured = null;
    const strategy = { applyVehicleUpgrades: (bonuses) => { captured = bonuses; } };
    const runtimeConfig = { arcade: { enabled: true, runType: 'demolition', demolitionProfileIds: ['profile-0', 'profile-1', 'profile-2'] } };
    const runtimeState = { entityManager: { players, humanPlayers: players, gameModeStrategy: strategy } };
    const support = { demolitionSupport: { runtime } };

    applyArcadeRuntimeCosmetics(support, runtimeState, runtimeConfig);
    assert.deepEqual([0, 1, 2].map((index) => captured.byPlayerIndex[index].build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ]);
    runtimeConfig.arcade.demolitionProfileIds = ['next-0', 'next-1', 'next-2'];
    for (const store of stores) store.records.set(ARCADE_STONE_WORKSHOP_STORAGE_KEY, JSON.stringify(poolOf([])));
    applyArcadeRuntimeCosmetics(support, runtimeState, runtimeConfig);
    assert.deepEqual([0, 1, 2].map((index) => captured.byPlayerIndex[index].build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ], 'Session-Rebuilds nutzen aktive UUID-Bindings und lesen nicht erneut aus veränderten Profil-Pools');
    assert.deepEqual(stores.map((store) => loadVehicleProfiles(store).ship5.xpBank), [100, 101, 102]);
});

test('Demolition Neustart nach Abschluss: neue UUIDs und Pools verdrängen alte Run-Bindings', () => {
    const createProfileStore = (serial, slotId, packages = []) => {
        const store = createStore({
            [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(serial, 1, at('ship5', slotId))]),
        });
        saveVehicleProfiles(store, { ship5: profileOf('ship5', { level: 20, xpBank: 100 + serial, packages }) });
        return store;
    };
    const oldIds = ['old-0', 'old-1', 'old-2'];
    const newIds = ['new-0', 'new-1', 'new-2'];
    const oldStores = oldIds.map((_, index) => createProfileStore(index + 1, ['core', 'nose', 'wing_left'][index], index === 2 ? ['wings'] : []));
    const newStores = newIds.map((_, index) => createProfileStore(index + 4, ['nose', 'wing_left', 'core'][index], index === 1 ? ['wings'] : []));
    const storesById = new Map([...oldIds.map((id, index) => [id, oldStores[index]]), ...newIds.map((id, index) => [id, newStores[index]])]);
    const players = oldIds.map((_, index) => makePlayer('ship5', { index }));
    const demolitionRuntime = new DemolitionRuntime({ getRecordStoreForPlayerIndex: (_, id) => storesById.get(id) || null });
    const entityManager = { players, humanPlayers: players, gameModeStrategy: null };

    demolitionRuntime.start({ entityManager, profileIds: oldIds, vehicleId: 'ship5' });
    demolitionRuntime.handleGameplayEvent({ type: 'kill', playerIndex: 0, count: 1 });
    assert.equal(loadVehicleProfiles(oldStores[0]).ship5.xpBank, 116, 'Run A verbucht XP nur bei UUID old-0');
    demolitionRuntime.phase = 'finished';

    let captured = null;
    entityManager.gameModeStrategy = { applyVehicleUpgrades: (bonuses) => { captured = bonuses; } };
    const runtimeConfig = { arcade: { enabled: true, runType: 'demolition', demolitionProfileIds: newIds } };
    const support = {
        _resolveActiveVehicleId: () => 'ship5',
        game: { settingsManager: { getPlayerRecordStorePort: () => createStore() } },
        demolitionSupport: { runtime: demolitionRuntime },
    };

    applyArcadeRuntimeCosmetics(support, { entityManager }, runtimeConfig);
    assert.deepEqual([0, 1, 2].map((index) => captured.byPlayerIndex[index].build.stoneSteps), [
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
    ], 'vor Start von Run B stammen Kosmetik und Build bereits aus den neuen UUID-Stores');

    demolitionRuntime.start({ entityManager, profileIds: newIds, vehicleId: 'ship5' });
    demolitionRuntime.handleGameplayEvent({ type: 'kill', playerIndex: 0, count: 1 });
    assert.equal(loadVehicleProfiles(newStores[0]).ship5.xpBank, 119, 'Run B schreibt XP an new-0');
    assert.equal(loadVehicleProfiles(oldStores[0]).ship5.xpBank, 116, 'alte UUID wird nicht erneut verändert');
    assert.deepEqual(newStores.map((store) => loadVehicleProfiles(store).ship5.xpBank), [119, 105, 106]);
});

/** Fünf Portale oder Arena-Wellen mit der Manta über den echten Startweg; spawn() baut die Sitzung neu. */
function startMantaSoloRun(store, runType) {
    const combatProfile = runType === 'arena_waves' ? ARENA_WAVES_COMBAT_PROFILE : undefined;
    const human = makePlayer('manta');
    const runtimeState = {
        runtimeConfig: { arcade: { enabled: true, runType }, player: { vehicles: { PLAYER_1: 'manta' } } },
        entityManager: { players: [human], humanPlayers: [human], bots: [], gameModeStrategy: null },
    };
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => runtimeState,
        getGame: () => ({ settingsManager: { getPlayerRecordStorePort: () => store } }),
    });
    const spawn = () => {
        const strategy = new ArcadeModeStrategy({ runType, combatProfile });
        runtimeState.entityManager.gameModeStrategy = strategy;
        support.startRunIfEnabled();
        strategy.resetPlayerHealth(human);
        strategy.applySpawnStatBonuses(human);
        return human;
    };
    return { support, spawn };
}

test('Fünf Portale: die Manta startet mit dem Rumpf-Stein aus dem Pool', () => {
    const profile = profileOf('manta');
    const store = createStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { manta: profile },
        [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, 1, at('manta', 'core'))]),
    });
    const human = startMantaSoloRun(store, 'five_portals').spawn();
    assert.equal(human.maxHp, 156, 'Manta 150 * 1,04');
    assert.ok(!store.writes.includes(ARCADE_STONE_WORKSHOP_STORAGE_KEY), 'der Run liest den Pool nur');
});

for (const runType of ['five_portals', 'arena_waves']) {
    test(`${runType}: ein Pool-Stein wirkt ab der ersten Karte, auch ohne gespeichertes Fahrzeugprofil`, () => {
        // Neuer Spieler: Stein nur aktiviert (schreibt den Pool), das Profil der Manta gibt es noch nicht.
        const store = createStore({ [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, 1, at('manta', 'core'))]) });
        const human = startMantaSoloRun(store, runType).spawn();
        assert.equal(human.maxHp, 156, 'Werkszustand der Manta (150) plus Rumpf-Stein T1');
    });

    test(`${runType}: Stein-Schritte gelten für den ganzen Run; Level-Aufstieg und Hangar-Änderungen wirken erst im nächsten Run`, () => {
        const store = createStore({
            [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { manta: profileOf('manta', { level: 9, partSizes: { hull: 125 } }) },
            [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, 2, at('manta', 'core')), stone(2)]),
        });
        const { support, spawn } = startMantaSoloRun(store, runType);
        const run = runType === 'five_portals' ? support.fivePortalsRuntime : support.arenaWavesRuntime;
        const first = { ...spawn() };
        // Während Karte 1: Level 10 (T2 wäre jetzt voll nutzbar) und im Hangar-Fenster ein Nasen-Stein aktiviert.
        store.records.set(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, JSON.stringify({ manta: profileOf('manta', { level: 10, partSizes: { hull: 125 } }) }));
        store.records.set(ARCADE_STONE_WORKSHOP_STORAGE_KEY, JSON.stringify(poolOf([stone(1, 2, at('manta', 'core')), stone(2, 1, at('manta', 'nose'))])));
        if (runType === 'five_portals') {
            run.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: 1000 });
            run.handleGameplayEvent({ type: 'exit_portal', playerIndex: 0 });
            assert.equal(run.phase, 'transition');
        }
        const second = spawn(); // Karte 2: neue Sitzung, derselbe Run
        assert.equal(second.maxHp, first.maxHp, 'Leben wie beim Start des Runs');
        assert.equal(second.arcadeDamageMultiplier, first.arcadeDamageMultiplier, 'der neue Nasen-Stein wirkt noch nicht');

        run.reset(); // nächster Run
        const next = spawn();
        assert.ok(next.maxHp > first.maxHp, 'im nächsten Run wirkt der Rumpf-Stein als T2');
        assert.ok(next.arcadeDamageMultiplier > first.arcadeDamageMultiplier, 'und der Nasen-Stein wirkt');
    });
}

test('Gauntlet: Stein-Schritte gelten für den ganzen Run; Level-Aufstieg und Hangar-Änderungen wirken erst im nächsten Run', () => {
    const profile = profileOf('ship5', { level: 9, xp: xpForLevel(9), partSizes: { hull: 125 } });
    const store = createStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { ship5: profile },
        [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, 2, at('ship5', 'core')), stone(2)]),
    });
    const runtime = new ArcadeRunRuntime({ now: () => 1000, settingsManager: { getPlayerRecordStorePort: () => store } });
    runtime._enabled = true;
    let strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    runtime.setVehicleUpgradesHandler((bonuses) => strategy.applyVehicleUpgrades(bonuses));
    runtime.setActiveVehicle('ship5');
    runtime.startRun({ strategy });
    const steps = () => runtime._runBonuses.build.stoneSteps;
    const atStart = steps();
    assert.equal(atStart.hull, 1, 'Level 9: der T2-Stein wirkt als T1');

    // Sektor 1: Level-Aufstieg auf 10 (awardBoundArcadeVehicleXp) und ein Nasen-Stein aus dem Hangar-Fenster.
    runtime._vehicleProfiles.ship5 = addXp(runtime._vehicleProfiles.ship5, xpForLevel(10) - xpForLevel(9), 0).profile;
    assert.equal(runtime.getVehicleProfile().level, 10);
    saveVehicleProfiles(store, runtime._vehicleProfiles);
    store.records.set(ARCADE_STONE_WORKSHOP_STORAGE_KEY, JSON.stringify(poolOf([stone(1, 2, at('ship5', 'core')), stone(2, 1, at('ship5', 'nose'))])));
    strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    runtime.setStrategy(strategy); // Sektor 2 mit neuer Karte: startRunIfEnabled baut die Strategie neu
    assert.equal(steps(), atStart, 'dieselben eingefrorenen Stein-Schritte im laufenden Run');
    assert.equal(runtime.getHudState().vehicleStats.maxHpBonus, resolveArcadeRunHudVehicleStats(profile, 'ship5', false, atStart).maxHpBonus);

    runtime.startRun({ strategy }); // nächster Run
    assert.equal(steps().hull, 2, 'jetzt wirkt der Rumpf-Stein als T2');
    assert.equal(steps().nose, 1, 'und der Nasen-Stein');
});

test('ArcadeRunRuntime: startRun und Strategie-Rebuild übergeben den Pool-Snapshot für Split-Screen', () => {
    const profile = profileOf('ship5');
    const store = createStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { ship5: profile },
        [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, 1, at('ship5', 'core'))]),
    });
    const runtime = new ArcadeRunRuntime({ now: () => 1000, settingsManager: { getPlayerRecordStorePort: () => store } });
    runtime._enabled = true;
    runtime.setActiveVehicle('ship5');
    const players = [makePlayer('ship5', { index: 0 }), makePlayer('ship5', { index: 1 })];
    let strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    runtime.setVehicleUpgradesHandler((bonuses) => strategy.applyVehicleUpgrades(bonuses));
    runtime.startRun({ strategy, entityManager: { humanPlayers: players } });
    assert.equal(strategy._upgradeBonusesFor(players[0]).build.maxHpPct, 104);
    assert.equal(strategy._upgradeBonusesFor(players[1]).build.maxHpPct, 104);

    store.records.set(ARCADE_STONE_WORKSHOP_STORAGE_KEY, JSON.stringify(poolOf([])));
    strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    runtime.setStrategy(strategy, players);
    assert.equal(strategy._upgradeBonusesFor(players[0]).build.maxHpPct, 104, 'Snapshot bleibt nach Map-/Strategie-Rebuild erhalten');
    assert.equal(strategy._upgradeBonusesFor(players[1]).build.maxHpPct, 104);
});

test('Gauntlet-Splitscreen bindet gleiche Fahrzeug-IDs an getrennte UUID-Cosmetics und Steinpools', () => {
    const profileIds = [
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000013',
    ];
    const styles = ['ion', 'ember', 'violet'];
    const slots = ['core', 'nose', 'wing_left'];
    const stores = profileIds.map((_, index) => {
        const store = createStore({
            [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(index + 1, 1, at('ship5', slots[index]))]),
            [ARCADE_COLORS_STORAGE_KEY]: { schemaVersion: ARCADE_COLORS_SCHEMA_VERSION, unlockedColorIds: ['standard', styles[index]] },
        });
        saveVehicleProfiles(store, {
            ship5: profileOf('ship5', {
                level: [4, 7, 13][index],
                trailStyleId: styles[index],
                packages: index === 2 ? ['wings'] : [],
            }),
        });
        return store;
    });
    const playerProfileManager = {
        getProfiles: () => profileIds.map((id) => ({ id })),
        getRecordStorePort: (id) => stores[profileIds.indexOf(id)] || null,
    };
    const players = profileIds.map((_, index) => makePlayer('ship5', { index, isBot: false }));
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    const runtimeConfig = {
        arcade: { enabled: true, runType: 'gauntlet', seed: 4711, playerProfileIds: profileIds },
        session: { sessionType: 'splitscreen', numHumans: 3 },
        player: { vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship5', PLAYER_3: 'ship5' } },
    };
    const runtimeState = {
        runtimeConfig,
        entityManager: { players, humanPlayers: players, bots: [], gameModeStrategy: strategy },
    };
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => runtimeState,
        getGame: () => ({
            settingsManager: { getPlayerRecordStorePort: () => stores[0] },
            playerProfileManager,
        }),
    });
    support.arcadeRunRuntime.configure(runtimeConfig);
    support.startRunIfEnabled();

    assert.deepEqual(players.map((player) => player.arcadeCosmeticLoadout.trailStyleId), styles,
        'Cosmetics laden je Index aus dem UUID-Store, obwohl alle dasselbe Fahrzeug fliegen');
    const readBuilds = (activeStrategy) => players.map((player) => activeStrategy._upgradeBonusesFor(player).build);
    const initialBuilds = readBuilds(strategy);
    assert.ok(initialBuilds.every(Boolean), 'alle validierten UUID-Bindings liefern einen Build');
    assert.notDeepEqual(initialBuilds[0], initialBuilds[1], 'P1-Kernstein ersetzt nicht den Profilbuild von P2');
    assert.notDeepEqual(initialBuilds[1], initialBuilds[2], 'gleiche Fahrzeug-ID teilt keine Spieler-Boni');

    for (const store of stores) store.records.set(ARCADE_STONE_WORKSHOP_STORAGE_KEY, JSON.stringify(poolOf([])));
    runtimeConfig.arcade.playerProfileIds = ['next-1', 'next-2', 'next-3'];
    const rebuiltStrategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    runtimeState.entityManager.gameModeStrategy = rebuiltStrategy;
    support.startRunIfEnabled();
    assert.deepEqual(players.map((player) => player.arcadeCosmeticLoadout.trailStyleId), styles,
        'Session-Rebuilds behalten Cosmetics aus den laufenden UUID-Bindings');
    assert.deepEqual(readBuilds(rebuiltStrategy), initialBuilds,
        'Session-Rebuilds behalten Stein-Snapshots und lesen nicht aus geänderten Pools');
});

test('Solo-Gauntlet friert das aktive Profil über Run-Rebuilds ein', () => {
    const profileIds = [
        '00000000-0000-4000-8000-000000000031',
        '00000000-0000-4000-8000-000000000032',
    ];
    const stores = profileIds.map((_, index) => {
        const store = createStore({
            [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, index + 1, at('ship5', 'core'))]),
            [ARCADE_COLORS_STORAGE_KEY]: { schemaVersion: ARCADE_COLORS_SCHEMA_VERSION, unlockedColorIds: ['standard', index ? 'ember' : 'ion'] },
        });
        saveVehicleProfiles(store, {
            ship5: profileOf('ship5', {
                level: 20,
                partSizes: { hull: 125 },
                trailStyleId: index ? 'ember' : 'ion',
            }),
        });
        return store;
    });
    const manager = {
        activeId: profileIds[0],
        getProfiles: () => profileIds.map((id) => ({ id })),
        getActiveProfile() { return { id: this.activeId }; },
        getRecordStorePort: (id) => stores[profileIds.indexOf(id)] || null,
    };
    const player = makePlayer('ship5', { index: 0, isBot: false });
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    const runtimeConfig = {
        arcade: { enabled: true, runType: 'gauntlet', seed: 4711, playerProfileIds: [manager.getActiveProfile().id] },
        session: { sessionType: 'single', numHumans: 1 },
    };
    const runtimeState = {
        runtimeConfig,
        entityManager: { players: [player], humanPlayers: [player], bots: [], gameModeStrategy: strategy },
    };
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => runtimeState,
        getGame: () => ({ settingsManager: {}, playerProfileManager: manager }),
    });
    support.arcadeRunRuntime.configure(runtimeConfig);
    support.startRunIfEnabled();
    assert.equal(player.arcadeCosmeticLoadout.trailStyleId, 'ion');
    const initialBuild = strategy._upgradeBonusesFor(player).build;

    manager.activeId = profileIds[1];
    runtimeConfig.arcade.playerProfileIds = [manager.getActiveProfile().id];
    const rebuiltStrategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    runtimeState.entityManager.gameModeStrategy = rebuiltStrategy;
    support.startRunIfEnabled();
    assert.equal(player.arcadeCosmeticLoadout.trailStyleId, 'ion', 'laufende Cosmetics bleiben an der Start-UUID');
    assert.deepEqual(rebuiltStrategy._upgradeBonusesFor(player).build, initialBuild,
        'aktiver Profilwechsel ändert die laufenden Boni und den Pool-Snapshot nicht');

    support.arcadeRunRuntime.resetRunState({ preserveRecords: true });
    const nextStrategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    runtimeState.entityManager.gameModeStrategy = nextStrategy;
    support.startRunIfEnabled();
    assert.equal(player.arcadeCosmeticLoadout.trailStyleId, 'ember', 'der folgende echte Run startet mit dem nun aktiven Profil');
    assert.notDeepEqual(nextStrategy._upgradeBonusesFor(player).build, initialBuild,
        'der neue Run liest den Steinpool der aktuellen Profil-UUID');
});

test('Arcade-Profilresolver: ungültige explizite UUID fällt nicht auf den aktiven Store zurück', () => {
    const validId = '00000000-0000-4000-8000-000000000021';
    const store = createStore({
        [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, 1, at('ship5', 'core'))]),
    });
    saveVehicleProfiles(store, { ship5: profileOf('ship5') });
    const playerProfileManager = {
        getProfiles: () => [{ id: validId }],
        getRecordStorePort: (id) => id === validId ? store : null,
    };
    const players = [
        makePlayer('ship5', { index: 0, isBot: false }),
        makePlayer('ship5', { index: 1, isBot: false }),
    ];
    const runtime = new ArcadeRunRuntime({
        getRecordStoreForPlayerIndex: (index, profileId) =>
            playerProfileManager.getProfiles().some((profile) => profile.id === profileId)
                ? playerProfileManager.getRecordStorePort(profileId)
                : null,
    });
    prepareArcadePlayerProfileBindings(runtime, players, ['deleted-profile', validId], true);
    assert.equal(runtime._playerBindings.has(0), false);
    assert.equal(runtime._playerBindings.get(1).store, store);
    const bonuses = runtime._playerProfileBindingsActive
        ? createArcadePlayerUpgradeBonusMap(runtime._playerProfilesByIndex, players, {
            storesByPlayerIndex: runtime._playerStoresByIndex,
        })
        : null;
    assert.equal(bonuses.byPlayerIndex[0].build, null, 'P1 bekommt keine stillen P1-Store-Boni für seine ungültige ID');
    assert.ok(bonuses.byPlayerIndex[1].build, 'eine gültige UUID bleibt für P2 gebunden');
});

test('HUD und Run-Laufzeit: Stein-Schritte kommen aus dem Pool, der Cache hängt am selben Objekt', () => {
    const profile = profileOf('ship5', { packages: ['wings'] });
    const steps = Object.freeze({ hull: 0, nose: 0, wings: 2, engines: 0, utility: 0 });
    const hud = resolveArcadeRunHudVehicleStats(profile, 'ship5', false, steps);
    assert.equal(hud.turningBonusPct, 6);
    assert.equal(resolveArcadeRunHudVehicleStats(profile, 'ship5', false, steps), hud, 'dasselbe Objekt');
    assert.equal(resolveArcadeRunHudVehicleStats(profile, 'ship5', false, null).turningBonusPct, 0);
    assert.equal(resolveArcadeRunHudVehicleStats(profile, 'ship5', true, steps).turningBonusPct, 0, 'Daily ohne Steine');

    const store = createStore({
        [ARCADE_STONE_WORKSHOP_STORAGE_KEY]: poolOf([stone(1, 1, at('ship5', 'wing_left')), stone(2, 1, at('ship5', 'wing_right'))]),
    });
    const runtime = new ArcadeRunRuntime({ now: () => 1000, settingsManager: { getPlayerRecordStorePort: () => store } });
    runtime._enabled = true;
    runtime._activeVehicleId = 'ship5';
    runtime._vehicleProfiles = { ship5: profile };
    runtime._state = { phase: 'sector_active', sectorIndex: 1, config: { comboWindowMs: 5000 }, score: { breakdown: {} } };
    assert.equal(runtime._getVehicleBonuses(profile).build.stoneSteps.wings, 2);
    const first = runtime.getHudState().vehicleStats;
    assert.equal(first.turningBonusPct, 6);
    assert.equal(runtime.getHudState().vehicleStats, first, 'keine Neuberechnung je Bild');

    runtime._config = { ...runtime._config, dailyChallenge: true };
    assert.equal(runtime._getVehicleBonuses(profile), null, 'Daily liefert keine Boni');
});

// --- Level-Aufstieg und Post-Run ---

test('Level-Aufstieg meldet Steinplatz-Pakete und Steinstufen', () => {
    const atLevel = (level) => addXp(createArcadeVehicleProfile('ship5', 0), xpForLevel(level), 0).profile;
    const toThree = addXp(atLevel(2), xpForLevel(3) - xpForLevel(2), 0);
    assert.deepEqual(toThree.unlocksGained, ['wings']);
    assert.deepEqual(toThree.tiersGained, []);
    assert.deepEqual(toThree.partFamiliesGained, []);
    const toTen = addXp(atLevel(9), xpForLevel(10) - xpForLevel(9), 0);
    assert.deepEqual(toTen.unlocksGained, ['utility']);
    assert.deepEqual(toTen.tiersGained, ['T2']);
    assert.deepEqual(listArcadeStoneUnlocksBetween(1, 20), { packages: ['wings', 'engines', 'utility'], tiers: ['T2', 'T3'] });
    assert.deepEqual(listArcadeStoneUnlocksBetween(20, 20), { packages: [], tiers: [] });
    assert.ok(listArcadeStoneUnlocksBetween(1, MAX_SAFE).tiers.length <= 20, 'riesige Sprünge bleiben kurz');
});

test('Post-Run zeigt Steinplätze und Steinstufen statt Slots und Teilefamilien', () => {
    const store = createStore();
    const before = addXp(createArcadeVehicleProfile('ship5', 1), xpForLevel(9), 2).profile;
    const gain = xpForLevel(10) - before.xp;
    saveVehicleProfiles(store, { ship5: addXp(before, gain, 3).profile });
    const summary = resolveArcadePostMatchProgression(store, { vehicleId: 'ship5', xpEarned: gain });
    assert.deepEqual(summary.unlockedStonePackages, ['utility']);
    assert.deepEqual(summary.unlockedStoneTiers, ['T2']);
    assert.equal(Object.hasOwn(summary, 'unlockedSlots'), false);

    const block = buildArcadeProgressionBlock(summary);
    const rows = Object.fromEntries(block.rows.map((row) => [row.key, row]));
    assert.equal(rows['unlocked-stone-packages'].label, 'Steinplätze jetzt kaufbar');
    assert.equal(rows['unlocked-stone-packages'].value, 'Utility');
    assert.equal(rows['unlocked-stone-tiers'].label, 'Steinstufe jetzt nutzbar');
    assert.equal(rows['unlocked-stone-tiers'].value, 'T2');
    assert.equal(rows['unlocked-families'], undefined);
});
