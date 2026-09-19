import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import {
    WEAPON_RACE_BOT_COUNT,
    WEAPON_RACE_CHECKPOINT_XP,
    WEAPON_RACE_FINISH_GRACE_SECONDS,
    WEAPON_RACE_GHOST_ROUTE_ID,
    WEAPON_RACE_MAP_KEY,
    WEAPON_RACE_RUN_TYPE,
    WEAPON_RACE_SCHEMA_VERSION,
    WEAPON_RACE_WEAPON_STAGES,
    isWeaponRaceConfig,
    resolveWeaponRaceStage,
} from '../src/shared/contracts/WeaponRaceContract.js';
import {
    createWeaponRaceState,
    finishWeaponRaceRacer,
    rankWeaponRaceRacers,
    recordWeaponRaceCheckpoint,
    updateWeaponRaceProgress,
} from '../src/state/arcade/WeaponRaceState.js';

test('W7.4 weapon race has a versioned offline Arcade contract on parcours_assault', () => {
    assert.equal(WEAPON_RACE_SCHEMA_VERSION, 'weapon-race.v1');
    assert.equal(WEAPON_RACE_RUN_TYPE, 'weapon_race');
    assert.equal(WEAPON_RACE_MAP_KEY, 'parcours_assault');
    assert.equal(WEAPON_RACE_BOT_COUNT, 4);
    assert.equal(WEAPON_RACE_FINISH_GRACE_SECONDS, 15);
    assert.equal(WEAPON_RACE_GHOST_ROUTE_ID, 'weapon-race:parcours_assault');
    assert.equal(isWeaponRaceConfig({
        arcade: { enabled: true, runType: 'weapon_race' },
        session: { sessionType: 'single', mapKey: 'parcours_assault' },
    }), true);
    assert.equal(isWeaponRaceConfig({ arcade: { enabled: true, runType: 'weapon_race' }, mapKey: 'standard' }), false);
    assert.equal(isWeaponRaceConfig({ arcade: { enabled: false, runType: 'weapon_race' }, mapKey: 'parcours_assault' }), false);
    assert.equal(isWeaponRaceConfig({
        arcade: { enabled: true, runType: 'weapon_race' },
        session: { sessionType: 'online', mapKey: 'parcours_assault' },
    }), false);
});

test('W7.4 old Arcade settings stay backward compatible while weapon_race is accepted', () => {
    const legacy = normalizeArcadeRunSettings({
        profileId: 'legacy-profile',
        seed: 77,
        sectorCount: 8,
        replayHooksEnabled: false,
    });

    assert.equal(legacy.runType, 'gauntlet');
    assert.equal(legacy.profileId, 'legacy-profile');
    assert.equal(legacy.seed, 77);
    assert.equal(legacy.sectorCount, 8);
    assert.equal(legacy.replayHooksEnabled, false);
    assert.equal(normalizeArcadeRunSettings({ runType: 'WEAPON_RACE', combatProfile: 'hunt' }).runType, 'weapon_race');
    assert.equal(normalizeArcadeRunSettings({ runType: 'WEAPON_RACE', combatProfile: 'hunt' }).combatProfile, 'hunt');
});

test('W7.4 checkpoint weapon order and payloads are fixed and lookup has no random fallback', () => {
    assert.deepEqual(WEAPON_RACE_WEAPON_STAGES, [
        { checkpointId: 'CP02_MG', weaponId: 'machine_gun', ammo: null, durationSeconds: null },
        { checkpointId: 'CP03_MG', weaponId: 'flamethrower', ammo: null, durationSeconds: 4 },
        { checkpointId: 'CP05_ROCKET', weaponId: 'rocket_medium', ammo: 3, durationSeconds: null },
        { checkpointId: 'CP07_HEAVY', weaponId: 'railgun', ammo: 3, durationSeconds: null },
        { checkpointId: 'CP08_FINAL', weaponId: 'lightning', ammo: 1, durationSeconds: null },
    ]);
    assert.deepEqual(resolveWeaponRaceStage('CP05_ROCKET'), WEAPON_RACE_WEAPON_STAGES[2]);
    assert.equal(resolveWeaponRaceStage('CP04_TUNNEL'), null);
    assert.equal(resolveWeaponRaceStage('unknown'), null);
});

test('W7.4 checkpoint XP is awarded to the human at most once per run', () => {
    const state = createWeaponRaceState({
        startedAtMs: 1000,
        humanPlayerId: 'player',
        racerIds: ['player', 'bot-1'],
    });

    const first = recordWeaponRaceCheckpoint(state, 'player', 'CP02_MG');
    const repeated = recordWeaponRaceCheckpoint(state, 'player', 'CP02_MG');
    recordWeaponRaceCheckpoint(state, 'bot-1', 'CP02_MG');
    const afterReturn = recordWeaponRaceCheckpoint(state, 'player', 'CP02_MG');

    assert.equal(first.awardedXp, WEAPON_RACE_CHECKPOINT_XP);
    assert.equal(repeated.awardedXp, 0);
    assert.equal(afterReturn.awardedXp, 0);
    assert.equal(state.racers.player.checkpointXp, 10);
    assert.deepEqual(state.racers.player.awardedCheckpointIds, ['CP02_MG']);
    assert.equal(state.racers['bot-1'].checkpointXp, 0);
});

test('W7.4 finished racers rank by time and the first finish starts the fixed grace period', () => {
    const state = createWeaponRaceState({ startedAtMs: 1000, racerIds: ['p2', 'p1', 'p3'] });

    finishWeaponRaceRacer(state, 'p2', 6000);
    finishWeaponRaceRacer(state, 'p1', 5500);
    finishWeaponRaceRacer(state, 'p3', 6000);

    assert.equal(state.firstFinishAtMs, 6000);
    assert.equal(state.graceEndsAtMs, 21_000);
    assert.deepEqual(rankWeaponRaceRacers(state).map((row) => row.playerId), ['p1', 'p2', 'p3']);
    assert.deepEqual(rankWeaponRaceRacers(state).map((row) => row.finishTimeMs), [4500, 5000, 5000]);
});

test('W7.4 DNF ranking uses checkpoint, distance, then stable player id', () => {
    const state = createWeaponRaceState({ racerIds: ['bot-c', 'bot-b', 'bot-a', 'winner'] });
    recordWeaponRaceCheckpoint(state, 'bot-c', 'CP05_ROCKET');
    recordWeaponRaceCheckpoint(state, 'bot-b', 'CP05_ROCKET');
    recordWeaponRaceCheckpoint(state, 'bot-a', 'CP05_ROCKET');
    recordWeaponRaceCheckpoint(state, 'winner', 'CP08_FINAL');
    updateWeaponRaceProgress(state, 'bot-c', 12);
    updateWeaponRaceProgress(state, 'bot-b', 9);
    updateWeaponRaceProgress(state, 'bot-a', 9);
    finishWeaponRaceRacer(state, 'winner', 4000);

    const ranking = rankWeaponRaceRacers(state);

    assert.deepEqual(ranking.map((row) => row.playerId), ['winner', 'bot-a', 'bot-b', 'bot-c']);
    assert.deepEqual(ranking.map((row) => row.result), ['finished', 'DNF', 'DNF', 'DNF']);
});
