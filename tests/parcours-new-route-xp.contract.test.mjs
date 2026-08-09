import assert from 'node:assert/strict';
import test from 'node:test';

import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { isParcoursMapDefinition, isMapEligibleForModePath } from '../src/shared/contracts/MapModeContract.js';
import { addXp, createArcadeVehicleProfile, XP_REWARD_TABLE } from '../src/state/arcade/ArcadeVehicleProfile.js';

// A map exactly as a new parcours would be authored: enabled flag, checkpoints, finish.
// Nothing here is registered anywhere else — that is the point of this test.
const BRAND_NEW_PARCOURS = Object.freeze({
    enabled: true,
    routeId: 'brand_new_route_v1',
    checkpoints: [
        { id: 'CP01', type: 'entry', pos: [0, 0, 0], radius: 1.2, forward: [1, 0, 0] },
        { id: 'CP02', type: 'gate', pos: [10, 0, 0], radius: 1.2, forward: [1, 0, 0] },
        { id: 'CP03', type: 'gate', pos: [20, 0, 0], radius: 1.2, forward: [1, 0, 0] },
    ],
    finish: { id: 'FINISH', type: 'finish', pos: [30, 0, 0], radius: 1.3, forward: [1, 0, 0] },
});

const BRAND_NEW_MAP = Object.freeze({
    name: 'Brand New Parcours',
    size: [120, 60, 80],
    playerSpawn: { x: -10, y: 0, z: 0 },
    parcours: BRAND_NEW_PARCOURS,
});

// Mirrors GameRuntimeArcadeSupport: the run runtime maps the system's event types
// onto the reward table and pays them into the active vehicle profile.
function createXpSink() {
    const events = [];
    let profile = createArcadeVehicleProfile('ship5', 0);
    const rewardByEvent = {
        checkpoint: XP_REWARD_TABLE.parcoursCheckpoint,
        finish: XP_REWARD_TABLE.parcoursFinish,
        new_best_time: XP_REWARD_TABLE.parcoursNewBestTime,
    };
    return {
        events,
        getProfile: () => profile,
        callback(eventType) {
            const reward = rewardByEvent[String(eventType)] || 0;
            events.push({ eventType, reward });
            if (reward > 0) profile = addXp(profile, reward, 0).profile;
        },
    };
}

function createHarness(parcoursDefinition) {
    const nowRef = { value: 0 };
    const player = { index: 0, isBot: false, alive: true, hitboxRadius: 0.8, position: { x: -1, y: 0, z: 0 } };
    const entityManager = {
        arena: { currentMapDefinition: { parcours: parcoursDefinition } },
        players: [player],
        audio: { play() {} },
        recorder: { logEvent() {} },
        _notifyPlayerFeedback() {},
    };
    const system = new ParcoursProgressSystem(entityManager, { nowProvider: () => nowRef.value });
    const sink = createXpSink();
    system.setXpEventCallback((eventType, playerIndex) => sink.callback(eventType, playerIndex));
    system.startRound([player]);
    system.onPlayerSpawn(player, { reason: 'spawn_all' });
    return { nowRef, player, system, sink };
}

function crossCheckpoint(system, player, entry, nowMs, distance = 0.45) {
    const pos = Array.isArray(entry?.pos) ? entry.pos : [0, 0, 0];
    const forward = Array.isArray(entry?.forward) ? entry.forward : [1, 0, 0];
    const previousPosition = {
        x: pos[0] - (forward[0] * distance),
        y: pos[1] - (forward[1] * distance),
        z: pos[2] - (forward[2] * distance),
    };
    player.position.x = pos[0] + (forward[0] * distance);
    player.position.y = pos[1] + (forward[1] * distance);
    player.position.z = pos[2] + (forward[2] * distance);
    return system.updatePlayerProgress(player, previousPosition, nowMs);
}

test('a newly authored parcours map is recognised and startable in the arcade path', () => {
    assert.equal(isParcoursMapDefinition(BRAND_NEW_MAP), true);
    assert.equal(isMapEligibleForModePath(BRAND_NEW_MAP, 'arcade'), true);
});

test('a newly authored parcours pays xp without any code change', () => {
    const harness = createHarness(BRAND_NEW_PARCOURS);
    const route = harness.system.getRouteSnapshot();
    assert.equal(route.checkpoints.length, 3, 'the authored checkpoints become a route');

    let clock = 100;
    for (const checkpoint of route.checkpoints) {
        harness.nowRef.value = clock;
        assert.equal(
            crossCheckpoint(harness.system, harness.player, checkpoint, clock)?.type,
            'checkpoint',
            `${checkpoint.id} is accepted`
        );
        clock += 250;
    }
    harness.nowRef.value = clock;
    assert.equal(crossCheckpoint(harness.system, harness.player, route.finish, clock)?.type, 'finish');

    assert.deepEqual(
        harness.sink.events.map((entry) => entry.eventType),
        ['checkpoint', 'checkpoint', 'checkpoint', 'finish']
    );
    const expected = 3 * XP_REWARD_TABLE.parcoursCheckpoint + XP_REWARD_TABLE.parcoursFinish;
    assert.equal(harness.sink.getProfile().xp, expected);
    assert.equal(harness.sink.getProfile().xpBank, expected, 'the earned xp is spendable in the hangar');
});

test('the reward table stays the single source for parcours xp', () => {
    // A new parcours must never need its own reward numbers.
    assert.ok(XP_REWARD_TABLE.parcoursCheckpoint > 0);
    assert.ok(XP_REWARD_TABLE.parcoursFinish > 0);
    assert.ok(XP_REWARD_TABLE.parcoursNewBestTime > 0);
});

test('a parcours without checkpoints yields no route and no xp instead of crashing', () => {
    const harness = createHarness({ ...BRAND_NEW_PARCOURS, checkpoints: [] });
    assert.equal(harness.system.getRouteSnapshot(), null);
    assert.equal(harness.sink.events.length, 0);
});
