import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { KINETIC_TIDE_MAP } from '../src/core/config/maps/presets/kinetic_tide.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

const map = KINETIC_TIDE_MAP.kinetic_tide;
const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;
const SPEED = CONFIG_SECTIONS.PLAYER.SPEED;
const STEP_DISTANCE = 4;

function createHarness() {
    const entityManager = {
        arena: { currentMapDefinition: map },
        // Without the real config the route would be built unscaled while the player flies
        // in world space, and nothing would ever trigger.
        entityRuntimeConfig: CONFIG_SECTIONS,
        _simulationClockMs: 0,
    };
    const system = new ParcoursProgressSystem(entityManager);
    const player = {
        index: 0,
        alive: true,
        isBot: false,
        hitboxRadius: 1.1,
        position: {
            x: map.playerSpawn.x * MAP_SCALE,
            y: map.playerSpawn.y * MAP_SCALE,
            z: map.playerSpawn.z * MAP_SCALE,
        },
    };
    system.startRound([player]);
    return { entityManager, system, player };
}

/**
 * Flies the player from its current position to a target in small steps, handing the
 * runtime the same previous/current pair a real frame would. Checkpoints are only
 * validated on a crossing, so the step size has to stay well below a trigger radius.
 */
function flyTo({ entityManager, system, player }, target) {
    const from = { ...player.position };
    const delta = [target[0] - from.x, target[1] - from.y, target[2] - from.z];
    const distance = Math.hypot(...delta);
    const steps = Math.max(1, Math.ceil(distance / STEP_DISTANCE));

    for (let step = 1; step <= steps; step += 1) {
        const previousPosition = { ...player.position };
        const ratio = step / steps;
        player.position.x = from.x + delta[0] * ratio;
        player.position.y = from.y + delta[1] * ratio;
        player.position.z = from.z + delta[2] * ratio;
        entityManager._simulationClockMs += ((distance / steps) / SPEED) * 1000;
        system.updatePlayerProgress(player, previousPosition, entityManager._simulationClockMs);
    }
}

function routeStages(system) {
    const snapshot = system.getRouteSnapshot();
    const byStage = new Map();
    for (const entry of snapshot.checkpoints) {
        if (!byStage.has(entry.routeIndex)) byStage.set(entry.routeIndex, entry);
    }
    return {
        total: snapshot.totalCheckpoints,
        stages: [...byStage.entries()].sort((left, right) => left[0] - right[0]).map(([, entry]) => entry),
        finish: snapshot.finish,
    };
}

test('a player flying the authored line validates every Kinetic Tide checkpoint in order', () => {
    const harness = createHarness();
    const { total, stages, finish } = routeStages(harness.system);

    assert.equal(total, 16);
    assert.equal(stages.length, 16);

    const reached = [];
    for (const stage of stages) {
        flyTo(harness, stage.pos);
        // Stopping on the centre leaves the crossing unfinished: the runtime wants the
        // player to end up in front of the gate plane, so fly on through it.
        const length = Math.hypot(...stage.forward) || 1;
        flyTo(harness, stage.forward.map(
            (value, axis) => stage.pos[axis] + (value / length) * (stage.radius * 0.5),
        ));
        reached.push({
            id: stage.id,
            current: harness.system.getPlayerHudState(0).currentCheckpoint,
        });
    }

    // Every stage has to advance the counter by exactly one. A stall means a trigger the
    // player cannot hit on the authored line, a jump means a stage was skipped.
    assert.deepEqual(
        reached.map((entry) => entry.current),
        stages.map((_, index) => index + 1),
        `progress stalled at ${JSON.stringify(reached)}`,
    );

    flyTo(harness, finish.pos);
    const finishForwardLength = Math.hypot(...finish.forward) || 1;
    flyTo(harness, finish.forward.map(
        (value, axis) => finish.pos[axis] + (value / finishForwardLength) * (finish.radius * 0.5),
    ));
    const hud = harness.system.getPlayerHudState(0);
    assert.equal(hud.completed, true, 'the finish completes the route');
    assert.equal(hud.currentCheckpoint, 16);
    assert.equal(hud.wrongOrderCount, 0, 'no stage triggers out of order');
    assert.equal(hud.resetCount, 0, 'no segment times out on the authored line');
});

test('the authored line keeps every segment inside the segment time limit', () => {
    const harness = createHarness();
    const { stages, finish } = routeStages(harness.system);
    const limitMs = map.parcours.rules.maxSegmentTimeMs;

    let previousPos = [
        map.playerSpawn.x * MAP_SCALE,
        map.playerSpawn.y * MAP_SCALE,
        map.playerSpawn.z * MAP_SCALE,
    ];
    for (const entry of [...stages, finish]) {
        const distance = Math.hypot(
            entry.pos[0] - previousPos[0],
            entry.pos[1] - previousPos[1],
            entry.pos[2] - previousPos[2],
        );
        const segmentMs = (distance / SPEED) * 1000;
        assert.ok(
            segmentMs < limitMs,
            `${entry.id}: ${Math.round(segmentMs)}ms at base speed exceeds the ${limitMs}ms segment limit`,
        );
        previousPos = entry.pos;
    }
});
