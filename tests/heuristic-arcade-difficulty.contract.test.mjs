import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import {
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';

/**
 * Stands for a bot's Player: only what the heuristic reads. It looks down -Z and holds one
 * SLOW_DOWN, an offensive item the bot shoots at a rival only from a good corridor - which is
 * exactly where difficulty (aim) and aggressiveness (attack window) draw the line.
 */
function createPlayer(index, z = 0) {
    return {
        index,
        isBot: true,
        alive: true,
        position: new THREE.Vector3(0, 0, z),
        speed: 18,
        baseSpeed: 18,
        hitboxRadius: 0.8,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        inventory: ['SLOW_DOWN'],
        selectedItemIndex: 0,
        getDirection(out) {
            return out.set(0, 0, -1);
        },
    };
}

/** Open space, calm pressure, a rival ahead at the given corridor alignment and range. */
function createObservation({ alignment, distanceRatio }) {
    const observation = new Array(OBSERVATION_LENGTH_V1).fill(0);
    observation[WALL_DISTANCE_FRONT] = 1;
    observation[WALL_DISTANCE_LEFT] = 1;
    observation[WALL_DISTANCE_RIGHT] = 1;
    observation[WALL_DISTANCE_UP] = 1;
    observation[WALL_DISTANCE_DOWN] = 1;
    observation[LOCAL_OPENNESS_RATIO] = 1;
    observation[PRESSURE_LEVEL] = 0.2;
    observation[PROJECTILE_THREAT] = 0;
    observation[TARGET_IN_FRONT] = 1;
    observation[TARGET_ALIGNMENT] = alignment;
    observation[TARGET_DISTANCE_RATIO] = distanceRatio;
    return observation;
}

/**
 * The runtime context of an Arcade combat sector as BotRuntimeContextFactory builds it:
 * mode ARCADE (arcade.enabled, no hunt combat profile) and no parcours route or ring to fly.
 */
function createArcadeSectorContext(bot, rival, observation, botSettings = { activeDifficulty: 'NORMAL' }) {
    return {
        mode: 'ARCADE',
        runtimeConfig: { arcade: { enabled: true }, bot: botSettings },
        observation,
        players: [bot, rival],
        visiblePlayers: [bot, rival],
        navigationPlayers: [bot, rival],
        projectiles: [],
        powerups: [],
        visiblePowerups: [],
        arena: { checkpointRings: [] },
    };
}

function firesItemAt(policy, observationValues, botSettings) {
    const bot = createPlayer(1);
    const rival = createPlayer(2, -30);
    const context = createArcadeSectorContext(bot, rival, createObservation(observationValues), botSettings);
    const input = policy.update(1 / 60, bot, context);
    return input.shootItem === true && input.shootItemIndex === 0;
}

test('a HARD heuristic bot in an Arcade combat sector takes a shot an EASY one still holds back', () => {
    // Alignment 0.6 sits between the HARD and the EASY aiming bar; the range is inside both windows.
    const corridor = { alignment: 0.6, distanceRatio: 0.35 };
    const easy = new HeuristicBotPolicy({ difficulty: 'EASY' });
    const hard = new HeuristicBotPolicy({ difficulty: 'HARD' });

    assert.equal(firesItemAt(hard, corridor, { activeDifficulty: 'HARD' }), true,
        'a HARD Arcade bot fires its offensive item down a fair corridor');
    assert.equal(firesItemAt(easy, corridor, { activeDifficulty: 'EASY' }), false,
        'an EASY Arcade bot waits for a cleaner line');
});

test('the Arcade stage reaches the heuristic through the runtime bot settings', () => {
    const corridor = { alignment: 0.6, distanceRatio: 0.35 };
    // Built as EASY, then the sector profile raises activeDifficulty to HARD (pressure or tier).
    const policy = new HeuristicBotPolicy({ difficulty: 'EASY' });
    assert.equal(firesItemAt(policy, corridor, { activeDifficulty: 'HARD' }), true,
        'the sector stage, not the constructor default, decides how the bot aims');
    assert.equal(policy.getDecisionSnapshot().difficulty, 'hard');
});

test('an Arcade combat sector heuristic engages its rival instead of only steering clear', () => {
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL' });
    firesItemAt(policy, { alignment: 0.95, distanceRatio: 0.3 });
    const { intent } = policy.getDecisionSnapshot();
    assert.notEqual(intent, 'avoid', 'a bot with a rival in front does not merely avoid');
});

test('setArcadeBotAggressiveness widens or narrows the heuristic attack window', () => {
    // Range 0.75 lies just outside a neutral NORMAL bot's attack window.
    const longShot = { alignment: 0.9, distanceRatio: 0.75 };
    const neutral = new HeuristicBotPolicy({ difficulty: 'NORMAL' });
    const fierce = new HeuristicBotPolicy({ difficulty: 'NORMAL' });
    const timid = new HeuristicBotPolicy({ difficulty: 'NORMAL' });
    fierce.setArcadeBotAggressiveness(0.85);
    timid.setArcadeBotAggressiveness(0.2);

    assert.equal(firesItemAt(neutral, longShot), false, 'a neutral squad holds the long shot');
    assert.equal(firesItemAt(fierce, longShot), true, 'an aggressive squad (0.85) takes the long shot');
    assert.equal(firesItemAt(timid, longShot), false, 'a timid squad (0.2) holds it as well');
    assert.ok(fierce.profile.attackWindow > neutral.profile.attackWindow, 'aggressiveness widens the attack window');
    assert.ok(timid.profile.attackWindow < neutral.profile.attackWindow, 'restraint narrows it');
    assert.ok(fierce.profile.preferredRange < timid.profile.preferredRange, 'an aggressive bot closes in further');
});

test('Arcade aggressiveness survives a sector change that re-syncs the bot settings', () => {
    const longShot = { alignment: 0.9, distanceRatio: 0.75 };
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL' });
    policy.setArcadeBotAggressiveness(0.85);
    // A new runtimeConfig.bot object makes the policy re-read profile and difficulty.
    assert.equal(firesItemAt(policy, longShot, { activeDifficulty: 'NORMAL', heuristicProfile: 'balanced' }), true,
        'the squad aggressiveness is still applied after the profile is re-read');
});

test('Arcade aggressiveness comes from the runtime bot settings at creation, like the rule bot', () => {
    const fromConfig = new HeuristicBotPolicy({
        difficulty: 'NORMAL',
        runtimeConfig: { bot: { arcadeAggressiveness: 0.85 } },
    });
    const neutral = new HeuristicBotPolicy({ difficulty: 'NORMAL' });
    assert.ok(fromConfig.profile.attackWindow > neutral.profile.attackWindow);
});

test('a neutral aggressiveness leaves Classic and Hunt heuristic profiles untouched', () => {
    const plain = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'aggressive' });
    const neutral = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'aggressive' });
    neutral.setArcadeBotAggressiveness(0.5);
    assert.deepEqual({ ...neutral.profile }, { ...plain.profile });
});

test('an Arcade parcours sector still flies the next gate without shooting', () => {
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const bot = createPlayer(1);
    const rival = createPlayer(2, -30);
    const context = createArcadeSectorContext(bot, rival, createObservation({ alignment: 0.95, distanceRatio: 0.3 }));
    context.arena = {
        checkpointRings: [{ pos: { x: 0, y: 0, z: -60 }, mesh: { userData: { ringState: 'next' } } }],
    };
    const input = policy.update(1 / 60, bot, context);
    assert.equal(policy.getDecisionSnapshot().intent, 'parcours-target');
    assert.equal(input.shootItem, false, 'a parcours bot does not fire items at rivals');
});
