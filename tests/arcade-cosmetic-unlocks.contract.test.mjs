import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_COSMETIC_COLORS,
    ARCADE_TRAIL_STYLE_UNLOCKS,
    ARCADE_WEAPON_STYLE_UNLOCKS,
    applyArcadeCosmeticLoadoutToPlayer,
    listUnlockedArcadeTrailStyles,
    listUnlockedArcadeWeaponStyles,
    resolveArcadeCosmeticLoadout,
    resolveArcadeTrailColor,
    resolveArcadeWeaponColors,
    selectArcadeTrailStyle,
    selectArcadeWeaponStyle,
} from '../src/shared/contracts/ArcadeVehicleCosmeticContract.js';
import { createArcadeVehicleProfile, getMasteryPerks } from '../src/state/arcade/ArcadeVehicleProfile.js';

test('W7.3 unlocks every trail style at the specified vehicle level', () => {
    assert.deepEqual(ARCADE_TRAIL_STYLE_UNLOCKS, Object.freeze({
        standard: 1,
        ion: 4,
        ember: 7,
        acid: 10,
        violet: 13,
        frost: 17,
        solar: 22,
        prism: 28,
    }));
    assert.deepEqual(listUnlockedArcadeTrailStyles(27), [
        'standard', 'ion', 'ember', 'acid', 'violet', 'frost', 'solar',
    ]);
    assert.deepEqual(listUnlockedArcadeTrailStyles(28), [
        'standard', 'ion', 'ember', 'acid', 'violet', 'frost', 'solar', 'prism',
    ]);
});

test('W7.3 unlocks identical weapon styles for all five weapon families', () => {
    assert.deepEqual(ARCADE_WEAPON_STYLE_UNLOCKS, Object.freeze({
        standard: 1,
        ion: 5,
        ember: 12,
        nova: 20,
    }));
    for (const family of ['mg', 'rockets', 'flamethrower', 'railgun', 'lightning']) {
        assert.deepEqual(listUnlockedArcadeWeaponStyles(19, family), ['standard', 'ion', 'ember']);
        assert.deepEqual(listUnlockedArcadeWeaponStyles(20, family), ['standard', 'ion', 'ember', 'nova']);
    }
});

test('W7.3 rejects locked selections and changes neither XP bank nor another vehicle', () => {
    const ship1 = { ...createArcadeVehicleProfile('ship1', 0), level: 11, xp: 3210, xpBank: 777 };
    const ship2 = { ...createArcadeVehicleProfile('ship2', 0), level: 30, xp: 9999, xpBank: 456 };
    const lockedTrail = selectArcadeTrailStyle(ship1, 'violet', 10);
    const lockedWeapon = selectArcadeWeaponStyle(ship1, 'mg', 'ember', 10);

    assert.equal(lockedTrail.ok, false);
    assert.equal(lockedTrail.code, 'level_locked');
    assert.equal(lockedTrail.profile.trailStyleId, 'standard');
    assert.equal(lockedWeapon.ok, false);
    assert.equal(lockedWeapon.code, 'level_locked');
    assert.equal(lockedWeapon.profile.weaponStyleIds.mg, 'standard');

    const selected = selectArcadeTrailStyle(ship1, 'acid', 20);
    const armed = selectArcadeWeaponStyle(selected.profile, 'mg', 'ion', 30);
    assert.equal(armed.ok, true);
    assert.equal(armed.profile.trailStyleId, 'acid');
    assert.equal(armed.profile.weaponStyleIds.mg, 'ion');
    assert.equal(armed.profile.xp, ship1.xp);
    assert.equal(armed.profile.xpBank, ship1.xpBank);
    assert.equal(ship2.trailStyleId, 'standard');
    assert.equal(ship2.weaponStyleIds.mg, 'standard');
    assert.equal(ship2.xpBank, 456);
});

test('W7.3 forces standard visuals outside Arcade and for bots', () => {
    const profile = {
        ...createArcadeVehicleProfile('ship1', 0),
        level: 30,
        trailStyleId: 'prism',
        weaponStyleIds: { mg: 'nova', rockets: 'ion', flamethrower: 'ember', railgun: 'nova', lightning: 'ion' },
    };
    assert.equal(resolveArcadeCosmeticLoadout({ arcadeEnabled: false, isBot: false, profile }).trailStyleId, 'standard');
    assert.equal(resolveArcadeCosmeticLoadout({ arcadeEnabled: true, isBot: true, profile }).trailStyleId, 'standard');
    assert.deepEqual(resolveArcadeCosmeticLoadout({ arcadeEnabled: false, isBot: false, profile }).weaponStyleIds, {
        mg: 'standard', rockets: 'standard', flamethrower: 'standard', railgun: 'standard', lightning: 'standard',
    });
});

test('W7.3 applies only presentation fields and leaves trail gameplay properties untouched', () => {
    const appliedStyles = [];
    const player = {
        isBot: false,
        hp: 100,
        damage: 25,
        trail: {
            width: 1.25,
            lifetime: 12,
            ownerIndex: 3,
            setCosmeticStyle: (styleId) => appliedStyles.push(styleId),
        },
    };
    const profile = { ...createArcadeVehicleProfile('ship3', 0), level: 30, trailStyleId: 'prism' };
    applyArcadeCosmeticLoadoutToPlayer(player, profile, true);
    assert.deepEqual(appliedStyles, ['prism']);
    assert.equal(player.hp, 100);
    assert.equal(player.damage, 25);
    assert.equal(player.trail.width, 1.25);
    assert.equal(player.trail.lifetime, 12);
    assert.equal(player.trail.ownerIndex, 3);
});

test('W7.3 prism and nova use deterministic allocation-free color sequences', () => {
    assert.deepEqual(
        Array.from({ length: 8 }, (_, index) => resolveArcadeTrailColor('prism', 0xffffff, index)),
        [
            ARCADE_COSMETIC_COLORS.ion, ARCADE_COSMETIC_COLORS.violet,
            ARCADE_COSMETIC_COLORS.ion, ARCADE_COSMETIC_COLORS.violet,
            ARCADE_COSMETIC_COLORS.ion, ARCADE_COSMETIC_COLORS.violet,
            ARCADE_COSMETIC_COLORS.ion, ARCADE_COSMETIC_COLORS.violet,
        ],
    );
    assert.deepEqual(resolveArcadeWeaponColors('nova'), [
        ARCADE_COSMETIC_COLORS.violet,
        ARCADE_COSMETIC_COLORS.solar,
    ]);
});

test('W7.3 vehicle levels grant no passive score, combo, XP or vehicle-stat bonus', () => {
    assert.deepEqual(getMasteryPerks(30), {
        scoreBonusPct: 0,
        comboDecaySlowPct: 0,
        xpBonusPct: 0,
    });
});
