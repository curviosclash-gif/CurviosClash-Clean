import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { isSoloVolumeFlight, SoloFlightController } from '../src/entities/ai/SoloFlightController.js';

function fixture(blocked = () => false) {
    const manager = {
        checkGlobalCollision: () => ({ hit: false }),
        constructor: { deriveSelfTrailSkipRecentSegments: () => 7 },
    };
    const player = {
        index: 1,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        speed: 20,
        turnSpeed: 3.4,
        hitboxRadius: 0.8,
        trail: { entityManager: manager },
    };
    const arena = { checkBotCollisionFast: (position) => blocked(position) };
    return { player, arena, manager, context: { mode: 'CLASSIC', rules: { planarMode: false }, players: [player], arena } };
}

test('3D solo navigation applies only when no living enemy remains', () => {
    const { player, context } = fixture();
    assert.equal(isSoloVolumeFlight(context, player), true);
    assert.equal(isSoloVolumeFlight({ ...context, mode: 'HUNT' }, player), true);
    assert.equal(isSoloVolumeFlight({ ...context, rules: { planarMode: true } }, player), false);
    assert.equal(isSoloVolumeFlight({ ...context, players: [player, { alive: true, index: 2 }] }, player), false);
});

test('rollout flies straight in clear space and turns before a reachable wall', () => {
    const open = fixture();
    const control = new SoloFlightController();
    const straight = control.update({}, 0.1, open.player, open.context);
    assert.equal(straight.yawLeft || straight.yawRight || straight.pitchUp || straight.pitchDown, false);
    assert.equal(straight.boost, false);

    const wall = fixture((position) => position.z < -20);
    const turn = control.update({}, 0.1, wall.player, wall.context);
    assert.equal(turn.yawLeft || turn.yawRight || turn.pitchUp || turn.pitchDown, true);
});

test('rollout detects the collision along a turning arc and checks own trails', () => {
    const { player, arena, manager } = fixture((position) => position.z < -3);
    const control = new SoloFlightController();
    const score = control._score(player, arena, manager, 1, 0, 20, 3.4, 0.8, 1.6, 7);
    assert.ok(score < 100, 'a turn cannot instantaneously reach the side opening');

    let trailChecks = 0;
    manager.checkGlobalCollision = (_position, _radius, _index, skipRecent) => {
        assert.equal(skipRecent, 7);
        trailChecks++;
        return { hit: true };
    };
    const clearArena = fixture().arena;
    control.update({}, 0.1, player, { mode: 'HUNT', rules: { planarMode: false }, arena: clearArena, players: [player] });
    assert.ok(trailChecks > 0);
});

test('a collision at the horizon never receives the clear-path novelty reward', () => {
    const { player, manager } = fixture();
    const control = new SoloFlightController();
    control.history[0].set(0, 0, -29);
    control.historyCount = 1;
    const open = control._score(player, fixture().arena, manager, 0, 0, 20, 3.4, 0.8, 1.6, 7);
    const blocked = control._score(player, fixture((position) => position.z < -29).arena,
        manager, 0, 0, 20, 3.4, 0.8, 1.6, 7);
    assert.ok(open > blocked);
});

test('a safe unvisited route breaks a repeated straight route and reset clears memory', () => {
    const { player, arena, manager } = fixture();
    const control = new SoloFlightController();
    control.history[0].set(0, 0, -30);
    control.historyCount = 1;
    const repeat = control._score(player, arena, manager, 0, 0, 20, 3.4, 0.8, 1.6, 7);
    const newRoute = control._score(player, arena, manager, 1, 0, 20, 3.4, 0.8, 1.6, 7);
    assert.ok(newRoute > repeat);
    control.reset();
    assert.equal(control.historyCount, 0);
    assert.equal(control.clock, 0);
});
