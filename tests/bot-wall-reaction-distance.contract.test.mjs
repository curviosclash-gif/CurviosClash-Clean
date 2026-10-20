import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { BotAI } from '../src/entities/Bot.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';

// The product config with NORMAL bots, the difficulty the measured Hunt matches use.
// BotAI.update re-reads BOT.ACTIVE_DIFFICULTY every tick, so it has to say NORMAL here.
const ENTITY_RUNTIME_CONFIG = Object.freeze({
    ...CONFIG_SECTIONS,
    BOT: { ...CONFIG_SECTIONS.BOT, ACTIVE_DIFFICULTY: 'NORMAL' },
});

// A die that always rolls 0.5: above the NORMAL error rate (no probe noise) and far above
// the boost chance, so every steering decision comes from the probes alone.
const STEADY_RNG = Object.freeze({ next: () => 0.5 });

/**
 * Stands for the arena: one flat wall across the flight path, `wallDistance` units in
 * front of a bot at the origin that flies toward -Z. The bounds are wide and centred on
 * the bot, so no height bias pulls it up or down.
 */
function createWallArena(wallDistance) {
    return {
        currentMapKey: 'standard',
        bounds: { minX: -400, maxX: 400, minY: -200, maxY: 200, minZ: -400, maxZ: 400 },
        checkBotCollisionFast(position, radius) {
            return position.z - radius <= -wallDistance;
        },
    };
}

/**
 * Stands for Player: only what the sensors read. `trail` is left out on purpose, so the
 * trail probe finds no entity manager and reports a clear path; this test is about walls.
 */
function createPlayer({ speed, baseSpeed = 40, boosting = false }) {
    return {
        index: 1,
        isBot: true,
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        inventory: [],
        rocketInventory: [],
        hitboxRadius: 0.8,
        speed,
        baseSpeed,
        turnSpeed: 3.4,
        isBoosting: boosting,
        position: new THREE.Vector3(0, 0, 0),
        getDirection(out) {
            return out.set(0, 0, -1);
        },
    };
}

function steersAway(input) {
    return input.yawLeft === true || input.yawRight === true || input.pitchUp === true || input.pitchDown === true;
}

function decide(player, arena) {
    const bot = new BotAI({ entityRuntimeConfig: ENTITY_RUNTIME_CONFIG, runtimeRng: STEADY_RNG, difficulty: 'NORMAL' });
    return bot.update(1 / 60, player, arena, [player], []);
}

// A NORMAL bot at 40 u/s turns on a radius of 40 / 3.4 = 11.8 units and decides every
// 0.14 s (5.6 units). A wall it first notices 13 units ahead (the old fixed look-ahead) is
// already inside that distance: the measured Hunt bots flew straight into such walls.
test('a bot at cruise speed starts turning while a wall is still far enough away to clear it', () => {
    const input = decide(createPlayer({ speed: 40 }), createWallArena(17));

    assert.equal(steersAway(input), true, 'a wall 17 units ahead at 40 u/s is noticed and avoided');
    assert.equal(input.boost, false, 'no boost toward a wall');
});

// Boosted to 92 u/s the same bot needs about 42 units to turn away; the old look-ahead
// stopped at 31 units, so a boosting bot met the wall before it saw it.
test('a boosting bot sees a wall in front far enough ahead for its boost speed', () => {
    const input = decide(createPlayer({ speed: 92, boosting: true }), createWallArena(36));

    assert.equal(steersAway(input), true, 'a wall 36 units ahead at boost speed is noticed and avoided');
    assert.equal(input.boost, false, 'the bot stops boosting toward the wall');
});

test('open space ahead keeps the bot on its course', () => {
    const input = decide(createPlayer({ speed: 40 }), createWallArena(80));

    assert.equal(steersAway(input), false, 'no wall within reach, no evasive turn');
});

// Planar play keeps its tuned look-ahead: solo planar Hunt measured better with a short one
// (the Hunt bridge sets it to 11), so the reaction-distance floor applies in 3D only.
test('planar sensing keeps the tuned look-ahead instead of the 3D reaction distance', () => {
    const bot = new BotAI({ entityRuntimeConfig: ENTITY_RUNTIME_CONFIG, runtimeRng: STEADY_RNG, difficulty: 'NORMAL' });
    bot.profile.lookAhead = 11;
    const player = createPlayer({ speed: 40 });

    const planarLookAhead = bot.sensors._computeDynamicLookAhead(player, true);
    const spatialLookAhead = bot.sensors._computeDynamicLookAhead(player, false);

    assert.ok(planarLookAhead <= 12, `planar look-ahead stays at the tuned value and the 12-unit minimum (got ${planarLookAhead})`);
    assert.ok(spatialLookAhead > 17, `3D look-ahead covers the turn at 40 u/s (got ${spatialLookAhead})`);
});