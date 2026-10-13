import test from 'node:test';
import assert from 'node:assert/strict';

import {
    HUNT_PARCOURS_RIVAL_MAX_RETIRED,
    HUNT_PARCOURS_RIVAL_MAX_STAGE,
    HUNT_PARCOURS_RIVAL_NAMES,
    HUNT_PARCOURS_RIVAL_TRAITS,
    HUNT_PARCOURS_RIVAL_VERSION,
    applyHuntParcoursRivalDefeat,
    applyHuntParcoursRivalVictory,
    createHuntParcoursRivalState,
    normalizeHuntParcoursRivalState,
    resolveHuntParcoursRivalModifiers,
    resolveHuntParcoursRivalTierGroup,
    resolvePlayerWinStyle,
    scoreHuntParcoursNemesisMap,
} from '../src/shared/contracts/HuntParcoursRivalContract.js';

const BY_FINISH = { mapsWonByFinish: 2, mapsWonByKills: 0, rocketKills: 0, totalKills: 0, hitsTaken: 3 };
const BY_KILLS = { mapsWonByFinish: 0, mapsWonByKills: 2, rocketKills: 1, totalKills: 4, hitsTaken: 3 };
const BY_ROCKETS = { mapsWonByFinish: 0, mapsWonByKills: 2, rocketKills: 3, totalKills: 4, hitsTaken: 3 };
const FLAWLESS = { mapsWonByFinish: 0, mapsWonByKills: 2, rocketKills: 3, totalKills: 4, hitsTaken: 0 };

test('win style follows the documented priority: flawless, then kills (rockets), then finish', () => {
    assert.equal(resolvePlayerWinStyle(FLAWLESS), 'sharpshooter');
    assert.equal(resolvePlayerWinStyle(BY_ROCKETS), 'intercept_pro');
    assert.equal(resolvePlayerWinStyle(BY_KILLS), 'shield_bearer');
    assert.equal(resolvePlayerWinStyle(BY_FINISH), 'corner_artist');
    assert.equal(resolvePlayerWinStyle({ ...BY_KILLS, mapsWonByFinish: 2 }), 'corner_artist', 'a tie goes to the finish');
    assert.equal(resolvePlayerWinStyle(null), 'corner_artist');
    assert.equal(resolvePlayerWinStyle({ hitsTaken: 'x' }), 'corner_artist');
});

test('a new rival starts at stage 0 with a deterministic name from the list', () => {
    const a = createHuntParcoursRivalState(5);
    assert.equal(a.version, HUNT_PARCOURS_RIVAL_VERSION);
    assert.equal(a.stage, 0);
    assert.deepEqual(a.traits, []);
    assert.equal(a.name, HUNT_PARCOURS_RIVAL_NAMES[5]);
    assert.deepEqual(createHuntParcoursRivalState(5), a);
    assert.equal(createHuntParcoursRivalState(HUNT_PARCOURS_RIVAL_NAMES.length).name, HUNT_PARCOURS_RIVAL_NAMES[0]);
    assert.ok(HUNT_PARCOURS_RIVAL_NAMES.length >= 12);
    assert.equal(new Set(HUNT_PARCOURS_RIVAL_NAMES).size, HUNT_PARCOURS_RIVAL_NAMES.length);
});

test('each defeat raises the stage and learns a trait; at most three, the oldest drops, no duplicates', () => {
    const start = createHuntParcoursRivalState(0);
    let state = applyHuntParcoursRivalDefeat(start, BY_FINISH);
    assert.deepEqual(start.traits, [], 'original stays untouched');
    assert.equal(start.stage, 0);
    assert.equal(state.stage, 1);
    assert.deepEqual(state.traits, ['corner_artist']);
    state = applyHuntParcoursRivalDefeat(state, BY_KILLS);
    state = applyHuntParcoursRivalDefeat(state, BY_ROCKETS);
    assert.deepEqual(state.traits, ['corner_artist', 'shield_bearer', 'intercept_pro']);
    state = applyHuntParcoursRivalDefeat(state, FLAWLESS);
    assert.deepEqual(state.traits, ['shield_bearer', 'intercept_pro', 'sharpshooter']);
    state = applyHuntParcoursRivalDefeat(state, BY_KILLS);
    assert.deepEqual(state.traits, ['intercept_pro', 'sharpshooter', 'shield_bearer'], 'a known trait becomes the newest');
    assert.equal(state.stage, HUNT_PARCOURS_RIVAL_MAX_STAGE);
});

test('a defeat at stage 5 retires the rival: new name, stage 0, no traits, remembered in the list', () => {
    let state = createHuntParcoursRivalState(0);
    for (let i = 0; i < 5; i++) state = applyHuntParcoursRivalDefeat(state, BY_FINISH);
    const oldName = state.name;
    state = applyHuntParcoursRivalVictory(state);
    state = applyHuntParcoursRivalDefeat(state, BY_FINISH);
    assert.equal(state.stage, 0);
    assert.deepEqual(state.traits, []);
    assert.notEqual(state.name, oldName);
    assert.equal(state.name, HUNT_PARCOURS_RIVAL_NAMES[1]);
    assert.equal(state.rivalIndex, 1);
    assert.equal(state.rivalWins, 0);
    assert.deepEqual(state.retired, [{ name: oldName, stage: 5, rivalWins: 1 }]);
});

test('the retired list keeps the ten newest rivals, newest first', () => {
    let state = createHuntParcoursRivalState(0);
    for (let i = 0; i < 6 * 12; i++) state = applyHuntParcoursRivalDefeat(state, BY_FINISH);
    assert.equal(state.rivalIndex, 12);
    assert.equal(state.retired.length, HUNT_PARCOURS_RIVAL_MAX_RETIRED);
    assert.equal(state.retired[0].name, HUNT_PARCOURS_RIVAL_NAMES[11]);
    assert.equal(state.name, HUNT_PARCOURS_RIVAL_NAMES[0]);
});

test('a rival victory only counts up his wins', () => {
    const state = applyHuntParcoursRivalDefeat(createHuntParcoursRivalState(2), BY_KILLS);
    const next = applyHuntParcoursRivalVictory(state);
    assert.equal(next.rivalWins, 1);
    assert.deepEqual({ ...next, rivalWins: 0 }, state);
    assert.equal(state.rivalWins, 0);
});

test('normalization turns garbage and foreign versions into a fresh rival and repairs fields', () => {
    for (const raw of [null, undefined, 42, 'x', [], { version: 0, stage: 4 }]) {
        assert.deepEqual(normalizeHuntParcoursRivalState(raw, 3), createHuntParcoursRivalState(3));
    }
    const repaired = normalizeHuntParcoursRivalState({
        version: HUNT_PARCOURS_RIVAL_VERSION, seed: -7.5, rivalIndex: 'a', name: '', stage: 99,
        traits: ['sharpshooter', 'bogus', 'corner_artist', 'sharpshooter', 'shield_bearer', 'intercept_pro'],
        rivalWins: -3, retired: [{ name: 'Alt', stage: 9 }, null, { name: '' }, ...Array(20).fill({ name: 'X', stage: 1 })],
    });
    assert.equal(repaired.seed, 7);
    assert.equal(repaired.rivalIndex, 0);
    assert.equal(repaired.name, HUNT_PARCOURS_RIVAL_NAMES[7]);
    assert.equal(repaired.stage, 5);
    assert.deepEqual(repaired.traits, ['sharpshooter', 'shield_bearer', 'intercept_pro']);
    assert.equal(repaired.rivalWins, 0);
    assert.equal(repaired.retired.length, HUNT_PARCOURS_RIVAL_MAX_RETIRED);
    assert.deepEqual(repaired.retired[0], { name: 'Alt', stage: 5, rivalWins: 0 });
});

test('modifiers: health grows with the stage, traits add their named effects', () => {
    const base = resolveHuntParcoursRivalModifiers(createHuntParcoursRivalState(0));
    assert.deepEqual(base, {
        healthMultiplier: 1.6, shieldBonus: 0, speedMultiplier: 1, turnMultiplier: 1, interceptChance: 0, aimSpreadMultiplier: 1,
    });
    const full = resolveHuntParcoursRivalModifiers({
        version: HUNT_PARCOURS_RIVAL_VERSION, stage: 3, traits: ['shield_bearer', 'corner_artist', 'sharpshooter'],
    });
    assert.equal(full.healthMultiplier, 2.05);
    assert.equal(full.shieldBonus, HUNT_PARCOURS_RIVAL_TRAITS.shield_bearer.shieldBonus);
    assert.equal(full.shieldBonus, 40);
    assert.equal(full.speedMultiplier, 1.08);
    assert.equal(full.turnMultiplier, 1.1);
    assert.equal(full.aimSpreadMultiplier, 0.5);
    assert.equal(full.interceptChance, 0);
    const interceptor = resolveHuntParcoursRivalModifiers({ version: 1, stage: 5, traits: ['intercept_pro'] });
    assert.equal(interceptor.interceptChance, 0.9);
    assert.equal(interceptor.healthMultiplier, 2.35);
    assert.ok(Object.isFrozen(HUNT_PARCOURS_RIVAL_TRAITS) && Object.isFrozen(HUNT_PARCOURS_RIVAL_TRAITS.sharpshooter));
});

test('tier groups pair the stages for the leaderboard', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(resolveHuntParcoursRivalTierGroup), ['0-1', '0-1', '2-3', '2-3', '4-5', '4-5']);
    assert.equal(resolveHuntParcoursRivalTierGroup(-1), '0-1');
    assert.equal(resolveHuntParcoursRivalTierGroup(17), '4-5');
    assert.equal(resolveHuntParcoursRivalTierGroup('junk'), '0-1');
});

test('nemesis map score: win 1000 x (1 + 0.25 x stage), time bonus up to 500, 250 per kill', () => {
    assert.equal(scoreHuntParcoursNemesisMap({ won: true, stage: 0, elapsedMs: 60000, parMs: 60000, kills: 0 }), 1500);
    assert.equal(scoreHuntParcoursNemesisMap({ won: true, stage: 4, elapsedMs: 30000, parMs: 60000, kills: 2 }), 2000 + 500 + 500);
    assert.equal(scoreHuntParcoursNemesisMap({ won: true, stage: 2, elapsedMs: 90000, parMs: 60000, kills: 1 }), 1500 + 250 + 250);
    assert.equal(scoreHuntParcoursNemesisMap({ won: true, stage: 0, elapsedMs: 200000, parMs: 60000, kills: 0 }), 1000);
    assert.equal(scoreHuntParcoursNemesisMap({ won: false, stage: 5, elapsedMs: 1000, parMs: 60000, kills: 3 }), 750);
    assert.equal(scoreHuntParcoursNemesisMap({ won: true, stage: 0, elapsedMs: 90000 }), 1500, 'default par is 90 s');
    assert.equal(scoreHuntParcoursNemesisMap({ won: true, stage: 0, kills: -2 }), 1000, 'unknown time gives no bonus');
    assert.equal(scoreHuntParcoursNemesisMap(), 0);
});
