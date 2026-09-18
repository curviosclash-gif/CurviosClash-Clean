import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { HuntBotPolicy } from '../src/hunt/HuntBotPolicy.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { applyPlayerPowerup, consumeFlamethrowerFuel } from '../src/entities/player/PlayerEffectOps.js';
import {
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

const CLASSIC_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: false, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' },
};

function createVehicle(index, position, config) {
    return {
        id: `p${index}`,
        index,
        isBot: true,
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        hitboxRadius: 0.8,
        speed: 18,
        baseSpeed: 18,
        inventory: [],
        rocketInventory: [],
        selectedItemIndex: 0,
        activeEffects: [],
        entityRuntimeConfig: config,
        position: new THREE.Vector3(position[0], position[1], position[2]),
        getDirection(out) {
            return out.set(0, 0, -1);
        },
        getAimDirection(out) {
            return out.set(0, 0, -1);
        },
    };
}

function createHuntPolicy(player, enemy) {
    const policy = new HuntBotPolicy();
    policy._fallbackPolicy.update = () => ({
        yawLeft: false,
        yawRight: false,
        pitchUp: false,
        pitchDown: false,
        boost: false,
        shootMG: false,
        shootItem: false,
        shootItemIndex: -1,
        useItem: -1,
    });
    policy._fallbackPolicy.getSensorSnapshot = () => ({
        targetYaw: 0,
        targetPitch: 0,
        pressure: 0,
        projectileThreat: false,
        targetPlayer: enemy,
        targetInFront: true,
        targetDistanceSq: player.position.distanceToSquared(enemy.position),
    });
    return policy;
}

function runHuntPolicy(player, enemy) {
    return createHuntPolicy(player, enemy).update(1 / 60, player, {
        players: [player, enemy],
        arena: {},
    });
}

function createHuntPair(enemyPosition) {
    const player = createVehicle(0, [0, 0, 0], HUNT_MODE_CONFIG);
    const enemy = createVehicle(1, enemyPosition, HUNT_MODE_CONFIG);
    return { player, enemy };
}

test('hunt bots hold the flame key only while the enemy stands inside the cone', () => {
    const { player, enemy } = createHuntPair([0, 0, -10]);
    applyPlayerPowerup(player, 'FLAMETHROWER');
    assert.equal(player.hasFlamethrower, true);

    assert.equal(runHuntPolicy(player, enemy).shootMG, true);
});

test('hunt bots keep the flame key down when the enemy stands beside the cone', () => {
    // Ten units away, but sixty degrees off the aim axis - far outside the thirty degree cone.
    const { player, enemy } = createHuntPair([Math.sin(Math.PI / 3) * 10, 0, -Math.cos(Math.PI / 3) * 10]);
    applyPlayerPowerup(player, 'FLAMETHROWER');

    assert.equal(runHuntPolicy(player, enemy).shootMG, false);
});

test('hunt bots waste no fuel on enemies beyond the cone range', () => {
    const { player, enemy } = createHuntPair([0, 0, -40]);
    // Machine gun range reaches far past the flame, so without the flame rule this would be true.
    assert.equal(runHuntPolicy(player, enemy).shootMG, true);

    applyPlayerPowerup(player, 'FLAMETHROWER');
    assert.equal(runHuntPolicy(player, enemy).shootMG, false);
});

test('an empty tank hands the key back to the machine gun rule', () => {
    const { player, enemy } = createHuntPair([0, 0, -40]);
    applyPlayerPowerup(player, 'FLAMETHROWER');
    consumeFlamethrowerFuel(player, 99);
    assert.equal(player.hasFlamethrower, false);

    assert.equal(runHuntPolicy(player, enemy).shootMG, true);
});

test('hunt bots arm the flamethrower once an enemy closes in, not across the arena', () => {
    const near = createHuntPair([0, 0, -30]);
    near.player.inventory = ['FLAMETHROWER'];
    assert.equal(runHuntPolicy(near.player, near.enemy).useItem, 0);

    const far = createHuntPair([0, 0, -80]);
    far.player.inventory = ['FLAMETHROWER'];
    assert.equal(runHuntPolicy(far.player, far.enemy).useItem, -1);
});

function createSafeObservation() {
    const observation = new Array(OBSERVATION_LENGTH_V1).fill(0);
    observation[WALL_DISTANCE_FRONT] = 1;
    observation[WALL_DISTANCE_LEFT] = 1;
    observation[WALL_DISTANCE_RIGHT] = 1;
    observation[WALL_DISTANCE_UP] = 1;
    observation[WALL_DISTANCE_DOWN] = 1;
    observation[LOCAL_OPENNESS_RATIO] = 1;
    observation[TARGET_DISTANCE_RATIO] = 0.35;
    observation[TARGET_IN_FRONT] = 1;
    observation[PRESSURE_LEVEL] = 0;
    observation[PROJECTILE_THREAT] = 0;
    return observation;
}

function runClassicHeuristic(enemyPosition) {
    const player = createVehicle(0, [0, 0, 0], CLASSIC_MODE_CONFIG);
    const enemy = createVehicle(1, enemyPosition, CLASSIC_MODE_CONFIG);
    applyPlayerPowerup(player, 'FLAMETHROWER');
    assert.equal(player.hasFlamethrower, true);
    return new HeuristicBotPolicy().update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player, enemy],
        arena: {},
        rules: { huntEnabled: false },
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });
}

test('classic heuristic bots burn trails only when an enemy is inside the cone', () => {
    assert.equal(runClassicHeuristic([0, 0, -10]).shootMG, true);
    assert.equal(runClassicHeuristic([0, 0, -40]).shootMG, false);
});
