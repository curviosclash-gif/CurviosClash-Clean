import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { isSoloVolumeFlight, SoloFlightController } from '../src/entities/ai/SoloFlightController.js';
import { PlayerInputSystem } from '../src/entities/systems/PlayerInputSystem.js';
import { PlayerController } from '../src/entities/player/PlayerController.js';

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
    assert.equal(isSoloVolumeFlight({ ...context, flagObjectives: [{}] }, player), false);
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

test('solo and guard escapes reach the simulated physical turn under inverted controls', () => {
    for (const solo of [true, false]) {
        let expected;
        for (const invertControls of [false, true]) {
            for (const invertPitchBase of [false, true]) {
                const { player, context } = fixture((position) => position.z < -20);
                Object.assign(player, { isBot: true, invertControls, invertPitchBase });
                if (!solo) context.players.push({ index: 2, alive: true });
                const action = new SoloFlightController().update({
                    rollAxis: 0.7, rollLeft: true, shootMG: true,
                }, 1 / 60, player, context);
                const controls = new PlayerController().resolveControlState(player, action, false, 1 / 60);
                assert.ok(controls.yawInput || controls.pitchInput, 'the wall requires an escape turn');
                assert.equal(controls.rollInput, 0, 'the selected route has no roll');
                assert.equal(action.shootMG, true);
                const physicalTurn = [controls.yawInput || 0, controls.pitchInput || 0];
                expected ??= physicalTurn;
                assert.deepEqual(physicalTurn, expected);
            }
        }
    }
});

test('boosted collision probes cover thin walls with the smallest hull radius', () => {
    for (const [speed, radius, wallZ] of [[90, 0.8, -2.88], [155, 0.2, -2.79]]) {
        const { player, manager } = fixture();
        const arena = {
            checkBotCollisionFast: (position, hullRadius) => Math.abs(position.z - wallZ) <= hullRadius,
        };
        const control = new SoloFlightController();
        control._score(player, arena, manager, 0, 0, speed, 3.4, radius, radius * 2, 7);
        assert.ok(control.clearTime < 0.1, `the ${speed} u/s path must detect the nearby thin wall`);
    }
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

test('a respawn starts a fresh route history for the reused bot', () => {
    const { player, manager, context } = fixture();
    context.entityManager = manager;
    manager._simulationClockMs = 1000;
    player.fightSpawnedAtSeconds = 0;
    const control = new SoloFlightController();
    control.update({}, 1 / 60, player, context);
    control.historyCount = 20;
    manager._simulationClockMs = 2000;
    player.fightSpawnedAtSeconds = 2;
    control.update({}, 1 / 60, player, context);
    assert.equal(control.historyCount, 1);
});

test('the shared input path protects a 2D combat bot while preserving its weapons', () => {
    const { player, manager, arena, context } = fixture((position) => position.z < -25);
    player.isBot = true;
    player.alive = true;
    const enemy = { index: 2, alive: true, position: new THREE.Vector3(0, 0, -60) };
    context.mode = 'HUNT';
    context.rules.planarMode = true;
    context.navigationPlayers = [player, enemy];
    context.entityManager = manager;
    manager.arena = arena;
    manager.botByPlayer = new Map([[player, {
        requiresObservation: false,
        update: () => ({ boost: true, shootMG: true, yawLeft: false, yawRight: false }),
    }]]);
    const system = new PlayerInputSystem(manager);
    system._resolveRuntimeContext = () => context;
    const input = system.resolvePlayerInput(player, 1 / 60, null);
    assert.equal(input.shootMG, true);
    assert.equal(input.boost, false);
    assert.equal(input.yawLeft || input.yawRight, true);
    assert.equal(input.pitchUp || input.pitchDown, false);
    assert.equal(system._flightSafety.byPlayer.size, 1);
    system.resetBotState();
    assert.equal(system._flightSafety.byPlayer.size, 0);
});

test('all modes use the safety guard, while a clear course keeps the policy action', () => {
    const { player, manager, context } = fixture();
    const controller = new SoloFlightController();
    for (const mode of ['CLASSIC', 'HUNT', 'ARCADE', 'ESCORT']) {
        const action = { yawLeft: true, shootRocket: true, boost: false };
        context.mode = mode;
        context.players = [player, { index: 2, alive: true }];
        context.entityManager = manager;
        assert.equal(controller.update(action, 1 / 60, player, context), action);
        assert.equal(action.yawLeft, true, mode);
        assert.equal(action.shootRocket, true, mode);
    }
});

test('the safety guard steers away from a wall in 3D without removing combat actions', () => {
    const { player, manager, context } = fixture((position) => position.z < -25);
    context.mode = 'ARCADE';
    context.players = [player, { index: 2, alive: true }];
    context.entityManager = manager;
    const action = { shootMG: true, shootItem: true, yawLeft: false, yawRight: false, boost: false };
    new SoloFlightController().update(action, 1 / 60, player, context);
    assert.equal(action.shootMG, true);
    assert.equal(action.shootItem, true);
    assert.equal(action.yawLeft || action.yawRight || action.pitchUp || action.pitchDown, true);
});
