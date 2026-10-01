// ============================================
// arcade-vehicle-size.contract.test.mjs - Paket 2a des Arcade-Hangar-Umbaus:
// Größenumbau (Freigabe, gekaufte Schritte, Umverteilen, Lagerstufen), Wertwirkung
// je Bauteilgruppe, Profil-Roundtrip und der Weg der Werte in einen Arcade-Run.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ARCADE_SIZE_MAX_PURCHASED_STEPS,
    ARCADE_SIZE_UNLOCK_COST_XP,
    ARCADE_STORAGE_TIER_COST_XP,
    resolveArcadeVehicleBaseStats,
} from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import {
    applyArcadeBuildToMachineGunConfig,
    countArcadeSizeSteps,
    diffArcadeVehicleBuildStats,
    evaluateArcadeSizeResize,
    evaluateArcadeSizeStepPurchase,
    evaluateArcadeSizeUnlock,
    evaluateArcadeStoragePurchase,
    normalizeArcadeSizeProfileFields,
    resolveArcadeSizeStepCost,
    resolveArcadeSizedPartStyle,
    resolveArcadeStorageOffer,
    resolveArcadeVehicleBuildStats,
} from '../src/shared/contracts/ArcadeVehicleBuildContract.js';
import { resolveArcadePartSizeFactors } from '../src/shared/contracts/ArcadeVehicleSizeContract.js';
import {
    createArcadeVehicleProfileRecord,
    normalizeArcadeVehicleProfileRecord,
    readArcadeVehicleProfileRecord,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { getArcadeRunVehicleBonuses } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { updateBoostState } from '../src/entities/player/PlayerChargeOps.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';

const MAX = Number.MAX_SAFE_INTEGER;

function profileOf(vehicleId, extra = {}) {
    return { ...createArcadeVehicleProfileRecord(vehicleId, 0), xpBank: 1_000_000, sizeWorkshopUnlocked: true, ...extra };
}

function sizes(partial = {}) {
    return { hull: 100, nose: 100, wings: 100, engines: 100, utility: 100, ...partial };
}

// --- Kosten und Freigabe ---

test('Größenschritt kostet 100 + 20 je gekauftem Schritt; 25 Schritte kosten 8 500 XP', () => {
    const costs = Array.from({ length: 25 }, (_, index) => resolveArcadeSizeStepCost(index));
    assert.deepEqual(costs.slice(0, 3), [100, 120, 140]);
    assert.equal(costs[24], 580);
    assert.equal(costs.reduce((sum, value) => sum + value, 0), 8500);

    let profile = profileOf('ship5', { xpBank: 8500 });
    for (let index = 0; index < 25; index += 1) {
        const result = evaluateArcadeSizeStepPurchase(profile);
        assert.equal(result.ok, true, `Schritt ${index + 1}`);
        assert.equal(result.cost, 100 + 20 * index);
        profile = result.next;
    }
    assert.equal(profile.purchasedSizeSteps, ARCADE_SIZE_MAX_PURCHASED_STEPS);
    assert.equal(profile.xpBank, 0);
    const overLimit = evaluateArcadeSizeStepPurchase({ ...profile, xpBank: 100_000 });
    assert.equal(overLimit.ok, false);
    assert.equal(overLimit.reason, 'max_steps');
    assert.equal(overLimit.next, null);
});

test('Freigabe kostet einmalig 100 XP; ohne Freigabe kein Umbau und kein Kauf', () => {
    const locked = { ...createArcadeVehicleProfileRecord('ship5', 0), xpBank: 99 };
    assert.equal(evaluateArcadeSizeUnlock(locked).reason, 'insufficient_xp');
    assert.equal(evaluateArcadeSizeStepPurchase({ ...locked, xpBank: 1000 }).reason, 'locked');
    assert.equal(evaluateArcadeSizeResize({ ...locked, xpBank: 1000 }, sizes()).reason, 'locked');
    assert.equal(evaluateArcadeStoragePurchase({ ...locked, xpBank: 1000 }, 'items').reason, 'locked');

    const unlock = evaluateArcadeSizeUnlock({ ...locked, xpBank: 100 });
    assert.equal(unlock.ok, true);
    assert.equal(unlock.cost, ARCADE_SIZE_UNLOCK_COST_XP);
    assert.equal(unlock.next.sizeWorkshopUnlocked, true);
    assert.equal(unlock.next.xpBank, 0);
    assert.equal(unlock.next.spentUpgradeXp, 100);
    assert.equal(evaluateArcadeSizeUnlock(unlock.next).reason, 'already_unlocked');
    assert.equal(evaluateArcadeSizeStepPurchase(unlock.next).reason, 'insufficient_xp');
});

// --- Umverteilen und Symmetrie ---

test('Umverteilen ist kostenlos, Verkleinern schafft Platz, mehr als gekauft geht nicht', () => {
    const profile = profileOf('ship5', { purchasedSizeSteps: 1 });
    const grow = evaluateArcadeSizeResize(profile, sizes({ hull: 105 }));
    assert.equal(grow.ok, true);
    assert.equal(grow.cost, 0);
    assert.equal(grow.next.xpBank, profile.xpBank);
    assert.equal(grow.next.partSizes.hull, 105);

    assert.equal(evaluateArcadeSizeResize(profile, sizes({ hull: 110 })).reason, 'over_capacity');
    const swap = evaluateArcadeSizeResize(profile, sizes({ hull: 115, nose: 90 }));
    assert.equal(swap.ok, true, 'Nase 90 % gibt zwei Schritte für den Rumpf frei');
    assert.equal(countArcadeSizeSteps(swap.next.partSizes), 1);
    assert.equal(evaluateArcadeSizeResize(profile, sizes({ hull: 102 })).reason, 'invalid_size');
    assert.equal(evaluateArcadeSizeResize(profile, sizes({ nose: 75 })).reason, 'invalid_size');
    assert.equal(evaluateArcadeSizeResize(profile, sizes({ wings: 130 })).reason, 'invalid_size');

    const undo = evaluateArcadeSizeResize(swap.next, profile.partSizes);
    assert.equal(undo.ok, true, 'Zurücknehmen ist wieder ein kostenloser Umbau');
    assert.deepEqual(undo.next.partSizes, sizes());
});

test('Flügel und Antriebe sind je eine Gruppe und bleiben symmetrisch', () => {
    const parts = [
        { name: 'Rumpf', role: 'core' },
        { name: 'Flügel L', role: 'wing_left' },
        { name: 'Flügel R', role: 'wing_right' },
        { name: 'Antrieb L', role: 'engine_left' },
        { name: 'Antrieb R', role: 'engine_right' },
    ];
    const factors = resolveArcadePartSizeFactors(parts, sizes({ wings: 120, engines: 85 }));
    assert.equal(factors['Flügel L'], factors['Flügel R']);
    assert.equal(factors['Flügel L'], 1.2);
    assert.equal(factors['Antrieb L'], factors['Antrieb R']);
    assert.equal(factors['Antrieb L'], 0.85);
    const normalized = normalizeArcadeSizeProfileFields({ sizeWorkshopUnlocked: true, purchasedSizeSteps: 5, partSizes: { wing_left: 125, wings: 105 } });
    assert.deepEqual(Object.keys(normalized.partSizes), ['hull', 'nose', 'wings', 'engines', 'utility']);
    assert.equal(normalized.partSizes.wings, 105, 'einzelne Flügelseiten gibt es im Profil nicht');
});

// --- Lagerstufen ---

test('Lagerstufen: Utility-Schwellen 105/115/125, Kosten 300/600/900, Manta 7+3 Items und 8+2 Raketen', () => {
    let manta = profileOf('manta', { purchasedSizeSteps: 5, partSizes: sizes({ utility: 100 }) });
    const tooSmall = evaluateArcadeStoragePurchase(manta, 'items');
    assert.equal(tooSmall.ok, false);
    assert.equal(tooSmall.reason, 'utility_too_small');
    assert.equal(resolveArcadeStorageOffer(manta, 'items').requiredUtilityPct, 105);

    manta = evaluateArcadeSizeResize(manta, sizes({ utility: 125 })).next;
    for (const [index, cost] of ARCADE_STORAGE_TIER_COST_XP.entries()) {
        const result = evaluateArcadeStoragePurchase(manta, 'items');
        assert.equal(result.ok, true, `Item-Stufe ${index + 1}`);
        assert.equal(result.cost, cost);
        manta = result.next;
    }
    assert.equal(manta.purchasedItemSlots, 3);
    assert.equal(evaluateArcadeStoragePurchase(manta, 'items').reason, 'max_tiers');
    assert.equal(resolveArcadeVehicleBuildStats('manta', manta).itemCapacity, 10);

    manta = evaluateArcadeStoragePurchase(manta, 'rockets').next;
    manta = evaluateArcadeStoragePurchase(manta, 'rockets').next;
    assert.equal(manta.purchasedRocketSlots, 2);
    assert.equal(resolveArcadeVehicleBuildStats('manta', manta).rocketCapacity, 10);
    assert.equal(resolveArcadeStorageOffer(manta, 'rockets'), null, 'Stufe 3 führt nur über 10 und wird nicht angeboten');
    assert.equal(evaluateArcadeStoragePurchase(manta, 'rockets').reason, 'storage_full');
    assert.equal(evaluateArcadeStoragePurchase(manta, 'fuel').reason, 'invalid_storage');
});

test('Verkleinern behält gekaufte Lagerstufen, sie sind nur inaktiv', () => {
    let manta = profileOf('manta', { purchasedSizeSteps: 5, partSizes: sizes({ utility: 125 }), purchasedItemSlots: 3 });
    manta = evaluateArcadeSizeResize(manta, sizes({ utility: 105, hull: 120 })).next;
    assert.equal(manta.purchasedItemSlots, 3);
    assert.equal(resolveArcadeVehicleBuildStats('manta', manta).itemCapacity, 8, 'nur Stufe 1 ist bei 105 % aktiv');
    manta = evaluateArcadeSizeResize(manta, sizes({ utility: 125 })).next;
    assert.equal(resolveArcadeVehicleBuildStats('manta', manta).itemCapacity, 10);
    const arrow = profileOf('arrow', { purchasedSizeSteps: 5, partSizes: sizes({ utility: 115 }), purchasedItemSlots: 3 });
    assert.equal(resolveArcadeVehicleBuildStats('arrow', arrow).itemCapacity, 5, 'Pfeil 3 + zwei erreichte Stufen');
});

// --- Wertwirkung ---

test('Wertwirkung je Gruppe und Schritt gegen die Plan-Tabelle', () => {
    const cruiser = resolveArcadeVehicleBuildStats('ship5', { sizeWorkshopUnlocked: true, purchasedSizeSteps: 25, partSizes: sizes({ hull: 125, nose: 125, wings: 125, engines: 125, utility: 125 }) });
    assert.equal(cruiser.maxHpPct, 120);
    assert.equal(cruiser.regenDelay, 2.4, 'Rumpf: -4 % Wartezeit je Schritt von 3 s');
    assert.equal(cruiser.damagePct, 115);
    assert.equal(cruiser.rangePct, 110);
    assert.equal(cruiser.turnPct, 115);
    assert.equal(cruiser.rollPct, 110);
    assert.equal(cruiser.speedPct, 112.5);
    assert.equal(cruiser.boostDurationPct, 115);
    assert.equal(cruiser.shieldPct, 120);
    assert.equal(cruiser.itemCapacity, 5, 'Star-Cruiser ohne gekaufte Lagerstufen');

    const small = resolveArcadeVehicleBuildStats('ship5', { sizeWorkshopUnlocked: true, partSizes: sizes({ hull: 80, engines: 80 }) });
    assert.equal(small.maxHpPct, 84, 'Verkleinern wirkt umgekehrt');
    assert.equal(small.regenDelay, 3.48);
    assert.equal(small.speedPct, 90);

    const manta = resolveArcadeVehicleBuildStats('manta', { sizeWorkshopUnlocked: true, purchasedSizeSteps: 5, partSizes: sizes({ hull: 125 }) });
    assert.equal(manta.maxHpPct, 180, 'Bezug ist der Grundwert des Schiffs');
    assert.equal(manta.speedPct, resolveArcadeVehicleBaseStats('manta').speedPct);
    assert.deepEqual(resolveArcadeVehicleBuildStats('manta', null), {
        maxHpPct: 150, regenDelay: 3, damagePct: 100, rangePct: 100, turnPct: 75, rollPct: 100,
        speedPct: 80, boostDurationPct: 100, shieldPct: 100, itemCapacity: 7, rocketCapacity: 8,
    });
});

test('Tempo, Wendigkeit und Rollen bleiben auf Grundwert + 100 geklemmt, Regeneration nie unter 1 s; Steine zählen wie Schritte ohne Lager', () => {
    const drone = resolveArcadeVehicleBuildStats('drone', null, { engines: 200, wings: 200, hull: 20 });
    assert.equal(drone.speedPct, 215);
    assert.equal(drone.turnPct, 230);
    assert.equal(drone.rollPct, 200, 'Rollen: 100 + 100 Punkte');
    assert.equal(drone.regenDelay, 1, 'Wartezeit nie unter 1 Sekunde');
    assert.equal(drone.boostDurationPct, 700, 'Nebenwerte haben keine Obergrenze');
    const stoned = resolveArcadeVehicleBuildStats('manta', null, { utility: 5 });
    assert.equal(stoned.shieldPct, 120);
    assert.equal(stoned.itemCapacity, 7, 'Steine schalten keine Lagerstufe frei');
});

test('Vorschau-Differenz nennt nur geänderte Werte mit alt und neu', () => {
    const before = resolveArcadeVehicleBuildStats('ship5', null);
    const after = resolveArcadeVehicleBuildStats('ship5', { sizeWorkshopUnlocked: true, purchasedSizeSteps: 1, partSizes: sizes({ hull: 105 }) });
    assert.deepEqual(diffArcadeVehicleBuildStats(before, after), [
        { key: 'maxHpPct', before: 100, after: 104, delta: 4 },
        { key: 'regenDelay', before: 3, after: 2.88, delta: -0.12 },
    ]);
    assert.deepEqual(diffArcadeVehicleBuildStats(before, before), []);
});

// --- Profil, Roundtrip und Überlauf ---

test('Profil v3 trägt die Größenfelder und übersteht einen Speicher-Roundtrip', () => {
    const fresh = createArcadeVehicleProfileRecord('ship5', 0);
    assert.equal(fresh.sizeWorkshopUnlocked, false);
    assert.deepEqual(fresh.partSizes, sizes());
    assert.equal(fresh.purchasedSizeSteps, 0);
    assert.equal(fresh.purchasedItemSlots, 0);
    assert.equal(fresh.purchasedRocketSlots, 0);

    const built = normalizeArcadeVehicleProfileRecord('manta', {
        ...fresh, vehicleId: 'manta', sizeWorkshopUnlocked: true, purchasedSizeSteps: 7,
        partSizes: sizes({ hull: 125, utility: 115, nose: 95 }), purchasedItemSlots: 2, purchasedRocketSlots: 1,
    });
    const stored = JSON.parse(JSON.stringify({ manta: built }));
    const { profiles } = readArcadeVehicleProfileRecord(stored);
    for (const key of ['sizeWorkshopUnlocked', 'partSizes', 'purchasedSizeSteps', 'purchasedItemSlots', 'purchasedRocketSlots']) {
        assert.deepEqual(profiles.manta[key], built[key], key);
    }
});

test('Zahlen werden gegen Überlauf und Müll geklemmt; verletzte Summenregel setzt die Größen zurück', () => {
    const junk = normalizeArcadeSizeProfileFields({
        sizeWorkshopUnlocked: 'ja', purchasedSizeSteps: Infinity, purchasedItemSlots: 1e308,
        purchasedRocketSlots: -4, partSizes: { hull: NaN, nose: '110' },
    });
    assert.equal(junk.sizeWorkshopUnlocked, false);
    assert.equal(junk.purchasedSizeSteps, 25);
    assert.equal(junk.purchasedItemSlots, 3);
    assert.equal(junk.purchasedRocketSlots, 0);
    assert.deepEqual(junk.partSizes, sizes(), 'ohne Freigabe bleiben alle Gruppen bei 100 %');
    for (const source of [undefined, null, [], 'abc']) {
        assert.deepEqual(normalizeArcadeSizeProfileFields(source).partSizes, sizes());
    }
    const cheated = normalizeArcadeSizeProfileFields({ sizeWorkshopUnlocked: true, purchasedSizeSteps: 1, partSizes: sizes({ hull: 125 }) });
    assert.deepEqual(cheated.partSizes, sizes(), 'mehr belegt als gekauft -> Werkszustand');

    assert.ok(Number.isSafeInteger(resolveArcadeSizeStepCost(MAX)));
    assert.equal(resolveArcadeSizeStepCost(-3), 100);
    const rich = evaluateArcadeSizeStepPurchase(profileOf('ship5', { xpBank: Infinity }));
    assert.equal(rich.ok, true);
    assert.equal(rich.next.xpBank, MAX - 100);
    const spent = evaluateArcadeSizeStepPurchase(profileOf('ship5', { xpBank: 500, spentUpgradeXp: MAX }));
    assert.equal(spent.next.spentUpgradeXp, MAX);
});

test('Sichtbare Größe folgt der funktionalen Größe, gespeicherte scale-Werte werden ignoriert', () => {
    const parts = [{ name: 'Rumpf', role: 'core', children: [{ name: 'Kind', role: 'nose' }] }, { name: 'Deko' }];
    assert.deepEqual(
        resolveArcadeSizedPartStyle(parts, { Rumpf: { scale: 1.2, color: 0xff0000 }, Deko: { scale: 0.9, variant: 'lab_helix_interceptor' } }, sizes({ hull: 110 })),
        { Rumpf: { color: 0xff0000, scale: 1.1 } },
    );
    assert.deepEqual(resolveArcadeSizedPartStyle(parts, { Rumpf: { scale: 1.2 } }, sizes()), {});
});

test('MG-Werte wachsen nur mit gesetzten Arcade-Multiplikatoren', () => {
    const mg = { DAMAGE: 10, RANGE: 100, COOLDOWN: 0.08 };
    assert.equal(applyArcadeBuildToMachineGunConfig(mg, {}), mg, 'andere Modi: dasselbe Objekt');
    assert.equal(applyArcadeBuildToMachineGunConfig(mg, { arcadeDamageMultiplier: 1, arcadeRangeMultiplier: 1 }), mg);
    const boosted = applyArcadeBuildToMachineGunConfig(mg, { arcadeDamageMultiplier: 1.15, arcadeRangeMultiplier: 1.1 });
    assert.ok(Math.abs(boosted.DAMAGE - 11.5) < 1e-9);
    assert.ok(Math.abs(boosted.RANGE - 110) < 1e-9);
    assert.equal(boosted.FALLOFF_RANGE, 100, 'Schadensabfall bleibt an der MG-Reichweite');
    assert.equal(boosted.COOLDOWN, 0.08);
});

test('Nasen-Reichweite verlängert nur die Flugweite: auf der Zusatzstrecke trifft das MG mit Mindestschaden', () => {
    const resolver = new MGHitResolver({ players: [] });
    const mg = applyArcadeBuildToMachineGunConfig({ DAMAGE: 10, RANGE: 100, MIN_FALLOFF: 0.5 }, { arcadeRangeMultiplier: 1.1 });
    const hits = [];
    const target = { alive: true, position: { x: 0, y: 0, z: 0 }, takeDamage: (amount) => { hits.push(amount); return { isDead: false }; } };
    resolver.applyHit({}, target, 50, mg);
    resolver.applyHit({}, target, 105, mg);
    assert.deepEqual(hits, [7.5, 5], 'halbe MG-Reichweite 75 %, dahinter Mindestschaden 50 %');
});

// --- Runtime: Werte kommen im Run an ---

function makePlayer(vehicleId, { isBot = false } = {}) {
    return {
        vehicleId, isBot, baseSpeed: 40, speed: 40, turnSpeed: 2, hasShield: false,
        maxHp: 1, hp: 1, maxShieldHp: 1, shieldHP: 0, position: null, inventory: [], rocketInventory: [],
    };
}

function mantaBonuses(partSizes, extra = {}) {
    return getArcadeRunVehicleBonuses(profileOf('manta', { purchasedSizeSteps: 25, partSizes: sizes(partSizes), ...extra }));
}

test('Runtime: Mensch mit Rumpf 125 % hat im Gauntlet 120 % des Tabellenlebens, Bots bleiben bei 100 %', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades(mantaBonuses({ hull: 125, wings: 125, engines: 125, utility: 125 }, { purchasedItemSlots: 3 }));
    const human = makePlayer('manta');
    const bot = makePlayer('manta', { isBot: true });
    for (const player of [human, bot]) {
        strategy.resetPlayerHealth(player);
        strategy.applySpawnStatBonuses(player);
    }
    assert.equal(human.maxHp, 180, '150 * 1,2');
    assert.equal(bot.maxHp, 150);
    assert.deepEqual(human.arcadePartSizes, sizes({ hull: 125, wings: 125, engines: 125, utility: 125 }));
    assert.deepEqual(bot.arcadePartSizes, sizes(), 'Bots fliegen in Werksgröße');
    assert.ok(Math.abs(strategy.getTurnRateMultiplier(human) - 0.8625) < 1e-9, 'Wendigkeit 75 * 1,15');
    assert.equal(strategy.getTurnRateMultiplier(bot), 0.75);
    assert.ok(Math.abs(human.baseSpeed - 40 * 0.9) < 1e-9, 'Tempo 80 * 1,125 = 90 %');
    assert.equal(human.itemCapacity, 10);
    assert.equal(bot.itemCapacity, 7);
    assert.equal(human.maxShieldHp, 48, 'Schild 40 * 1,2');
    assert.equal(human.arcadeRollMultiplier, 1.1);
    assert.equal(human.arcadeBoostDurationMultiplier, 1.15);
    assert.equal(bot.arcadeRollMultiplier, 1);
    strategy.grantShield(human);
    assert.equal(human.shieldHP, 48);

    const otherShip = makePlayer('drone');
    strategy.resetPlayerHealth(otherShip);
    strategy.applySpawnStatBonuses(otherShip);
    assert.equal(otherShip.maxHp, 70, 'der Manta-Build gilt nicht für ein anderes Fahrzeug');
    assert.deepEqual(otherShip.arcadePartSizes, sizes());
});

test('Runtime: Endlos-Parcours (Kampfprofil) übernimmt Leben, Regeneration und Schild aus dem Build', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'endless_parcours' });
    strategy.applyVehicleUpgrades(mantaBonuses({ hull: 125, nose: 125, utility: 125 }));
    const human = makePlayer('manta');
    strategy.resetPlayerHealth(human);
    strategy.applySpawnStatBonuses(human);
    assert.equal(human.maxHp, 180);
    assert.equal(human.arcadeRegenDelay, 2.4);
    assert.equal(human.arcadeDamageMultiplier, 1.15);
    assert.equal(human.arcadeRangeMultiplier, 1.1);
    assert.equal(human.maxShieldHp, 48);
});

test('Runtime: Daily und andere Modi bleiben unverändert', () => {
    const daily = new ArcadeModeStrategy({ runType: 'gauntlet', isDailyChallenge: true });
    daily.applyVehicleUpgrades(mantaBonuses({ hull: 125, utility: 125 }));
    const dailyPlayer = makePlayer('manta');
    daily.resetPlayerHealth(dailyPlayer);
    daily.applySpawnStatBonuses(dailyPlayer);
    assert.equal(dailyPlayer.maxHp, 100);
    assert.equal(dailyPlayer.maxShieldHp, 40);
    assert.equal(dailyPlayer.arcadePartSizes, undefined);
    assert.equal(dailyPlayer.arcadeRegenDelay, undefined);
    assert.equal(daily.getTurnRateMultiplier(dailyPlayer), 1);

    const hunt = new HuntModeStrategy();
    const plain = makePlayer('manta');
    hunt.resetPlayerHealth(plain);
    assert.equal(plain.maxShieldHp, 40);
    plain.hp = 50;
    plain.maxHp = 100;
    plain.lastDamageTimestamp = -Infinity;
    hunt.updateHealthRegen(plain, 1, null, 100);
    assert.equal(plain.hp, 52.5, 'Hunt-Regeneration ohne Arcade-Multiplikator wie bisher');
    const recent = { ...makePlayer('manta'), hp: 50, maxHp: 100, lastDamageTimestamp: 98 };
    hunt.updateHealthRegen(recent, 1, null, 100);
    assert.equal(recent.hp, 50, 'ohne Build wartet die Regeneration 3 s');
    const built = { ...makePlayer('manta'), hp: 50, maxHp: 100, lastDamageTimestamp: 98, arcadeRegenDelay: 1.5 };
    hunt.updateHealthRegen(built, 1, null, 100);
    assert.equal(built.hp, 52.5, 'Rumpf-Build verkürzt die Wartezeit, das Tempo der Heilung bleibt');
    // Raketenschaden: echter Trefferweg in arcade-vehicle-size-runtime.contract.test.mjs (C).
});

test('Runtime: Boost-Dauer folgt dem Antriebs-Multiplikator, ohne ihn bleibt sie gleich', () => {
    const plain = { boostCharge: 99, manualBoostActive: false };
    updateBoostState(plain, 0, null);
    const built = { boostCharge: 99, manualBoostActive: false, arcadeBoostDurationMultiplier: 1.15 };
    updateBoostState(built, 0, null);
    assert.ok(Math.abs(built.boostCharge - plain.boostCharge * 1.15) < 1e-9);
});
