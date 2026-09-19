import assert from 'node:assert/strict';
import test from 'node:test';

import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { createTeamScoreboard } from '../src/shared/contracts/TeamHuntContract.js';
import {
    buildParticipantComparisonBlock,
    getComparisonColumns,
} from '../src/ui/postmatch/PostMatchComparisonBlock.js';
import { buildArcadeProgressionBlock } from '../src/ui/postmatch/PostMatchArcadeProgressionBlock.js';
import { resolveArcadePostMatchProgression } from '../src/core/arcade/ArcadePostMatchProgression.js';
import {
    addXp,
    createArcadeVehicleProfile,
    saveVehicleProfiles,
    xpForLevel,
} from '../src/state/arcade/ArcadeVehicleProfile.js';

function players() {
    return [
        { index: 0, isBot: false, score: 1, entitySlotActive: true },
        { index: 1, isBot: true, score: 0, entitySlotActive: true },
    ];
}

test('W7.6 host-owned combat counters accumulate and survive an old network snapshot as zero', () => {
    const scoring = new HuntScoring(() => 0);
    scoring.registerBurnedTrailMeters(0, 3.5);
    scoring.registerBurnedTrailMeters(0, 1.25);
    scoring.registerFlagCapture(0);
    scoring.registerRepairDroneHpRestored(0, 6.5);
    const rows = scoring.getScoreboard(players());
    assert.equal(rows[0].burnedTrailMeters, 4.75);
    assert.equal(rows[0].flagCaptures, 1);
    assert.equal(rows[0].repairDroneHpRestored, 6.5);

    const replica = new HuntScoring(() => 0);
    replica.applyScoreboard([{ playerIndex: 0, kills: 2 }]);
    const oldRow = replica.getScoreboard(players()).find((row) => row.playerIndex === 0);
    assert.equal(oldRow.burnedTrailMeters, 0);
    assert.equal(oldRow.flagCaptures, 0);
    assert.equal(oldRow.repairDroneHpRestored, 0);
});

test('W7.6 runtime projection normalizes new host counters for clients', () => {
    const projection = createMatchRuntimeProjection({
        hunt: { scoreboardRows: [{
            playerIndex: 0,
            damage: 12,
            shieldDamage: 7,
            intercepts: 2,
            unitsDestroyed: 3,
            burnedTrailMeters: 4.5,
            flagCaptures: 1,
            repairDroneHpRestored: 8.25,
        }] },
    });
    assert.deepEqual(
        Object.fromEntries(Object.entries(projection.hunt.scoreboardRows[0]).filter(([key]) => [
            'damage', 'shieldDamage', 'intercepts', 'unitsDestroyed', 'burnedTrailMeters',
            'flagCaptures', 'repairDroneHpRestored',
        ].includes(key))),
        {
            damage: 12,
            shieldDamage: 7,
            intercepts: 2,
            unitsDestroyed: 3,
            burnedTrailMeters: 4.5,
            flagCaptures: 1,
            repairDroneHpRestored: 8.25,
        }
    );
});

test('W7.6 team projections transfer participant counters additively', () => {
    const rows = createTeamScoreboard([
        { playerIndex: 0, burnedTrailMeters: 2.5, flagCaptures: 1, repairDroneHpRestored: 4 },
        { playerIndex: 1, burnedTrailMeters: 3, flagCaptures: 2, repairDroneHpRestored: 6 },
    ], [{ index: 0, teamId: 'ALPHA' }, { index: 1, teamId: 'ALPHA' }]);
    assert.equal(rows[0].burnedTrailMeters, 5.5);
    assert.equal(rows[0].flagCaptures, 3);
    assert.equal(rows[0].repairDroneHpRestored, 10);
});

test('W7.6 comparison exposes only supported non-empty columns and weapon-race DNF data', () => {
    const block = buildParticipantComparisonBlock({
        players: players(),
        huntScoreboard: [
            { playerIndex: 0, kills: 2, deaths: 1, assists: 0, damage: 90, shieldDamage: 0, intercepts: 1 },
            { playerIndex: 1, kills: 0, deaths: 2, assists: 1, damage: 0, shieldDamage: 0, intercepts: 0 },
        ],
        weaponRaceStandings: [
            { playerId: '0', place: 1, result: 'finished', finishTimeMs: 61_500 },
            { playerId: '1', place: 2, result: 'dnf' },
        ],
        checkpointResetsByPlayer: { 0: 2, 1: 0 },
    });
    assert.equal(block.tier, 'detail');
    assert.deepEqual(getComparisonColumns(block).map((column) => column.key), [
        'kills', 'deaths', 'assists', 'healthDamage', 'rocketIntercepts',
        'weaponRacePlace', 'weaponRaceResult', 'checkpointResets',
    ]);
    assert.equal(block.entries[1].extra.weaponRaceDnf, 1);
    assert.equal(Object.hasOwn(block.entries[0].extra, 'shieldDamage'), true, 'supported zero values remain normalized');
});

test('W7.6 empty or unsupported comparison columns are suppressed', () => {
    const block = buildParticipantComparisonBlock({
        players: players(),
        huntScoreboard: [
            { playerIndex: 0, kills: 0, deaths: 0, assists: 0, damage: 0, shieldDamage: 0 },
            { playerIndex: 1, kills: 0, deaths: 0, assists: 0, damage: 0, shieldDamage: 0 },
        ],
    });
    assert.equal(block, null);
});

test('W7.6 arcade progression block contains vehicle, bank, levels and newly unlocked content', () => {
    const block = buildArcadeProgressionBlock({
        vehicleId: 'ship2',
        xpEarned: 420,
        priorLevel: 3,
        newLevel: 5,
        xpBank: 900,
        unlockedSlots: ['wing_left'],
        unlockedTiers: ['T2'],
        unlockedFamilies: ['flamethrower'],
        unlockedCosmetics: ['Spur Ion', 'Waffenstil Ion'],
    });
    assert.equal(block.id, 'arcade-progression');
    assert.equal(block.tier, 'detail');
    assert.deepEqual(block.rows.map((row) => row.key), [
        'vehicle', 'xp-earned', 'level-change', 'xp-bank', 'unlocked-slots',
        'unlocked-tiers', 'unlocked-families', 'unlocked-cosmetics',
    ]);
    assert.equal(block.rows.some((row) => /mastery|waffen-xp/i.test(row.key)), false);
});

test('W7.6 arcade progression is derived from the bound vehicle profile without weapon mastery', () => {
    const records = new Map();
    const store = {
        loadJsonRecord(key, fallback) { return records.has(key) ? records.get(key) : fallback; },
        saveJsonRecord(key, value) { records.set(key, structuredClone(value)); return true; },
    };
    const before = addXp(createArcadeVehicleProfile('ship2', 1), xpForLevel(3), 2).profile;
    const gain = xpForLevel(5) - before.xp;
    const after = addXp(before, gain, 3).profile;
    saveVehicleProfiles(store, { ship2: after });
    const summary = resolveArcadePostMatchProgression(store, { vehicleId: 'ship2', xpEarned: gain });
    assert.equal(summary.priorLevel, 3);
    assert.equal(summary.newLevel, 5);
    assert.equal(summary.xpBank, after.xpBank);
    assert.ok(summary.unlockedCosmetics.includes('Spur Ion'));
    assert.ok(summary.unlockedCosmetics.includes('Waffenstil Ion'));
    assert.equal(Object.hasOwn(summary, 'weaponMastery'), false);
});
