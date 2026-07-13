import assert from 'node:assert/strict';
import test from 'node:test';

import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

function createParcoursDefinition(overrides = {}) {
    const sourceRules = overrides.rules || {};
    return {
        enabled: true,
        routeId: overrides.routeId || 'audio_route',
        checkpoints: Array.isArray(overrides.checkpoints) ? overrides.checkpoints : [
            { id: 'CP01', type: 'entry', pos: [0, 0, 0], radius: 1.2, forward: [1, 0, 0] },
            { id: 'CP02', type: 'gate', pos: [10, 0, 0], radius: 1.2, forward: [1, 0, 0] },
            { id: 'CP03', type: 'gate', pos: [20, 0, 0], radius: 1.2, forward: [1, 0, 0] },
        ],
        finish: overrides.finish || { id: 'FINISH', type: 'finish', pos: [30, 0, 0], radius: 1.3, forward: [1, 0, 0] },
        rules: {
            ordered: sourceRules.ordered !== false,
            bidirectionalCheckpoints: sourceRules.bidirectionalCheckpoints !== false,
            resetOnDeath: sourceRules.resetOnDeath !== false,
            resetToLastValid: sourceRules.resetToLastValid === true,
            maxSegmentTimeMs: Number.isFinite(Number(sourceRules.maxSegmentTimeMs)) ? Number(sourceRules.maxSegmentTimeMs) : 4000,
            cooldownMs: Number.isFinite(Number(sourceRules.cooldownMs)) ? Number(sourceRules.cooldownMs) : 450,
            allowLaneAliases: sourceRules.allowLaneAliases !== false,
            winnerByParcoursComplete: sourceRules.winnerByParcoursComplete !== false,
            wrongOrderCooldownMs: Number.isFinite(Number(sourceRules.wrongOrderCooldownMs)) ? Number(sourceRules.wrongOrderCooldownMs) : 700,
            wrongOrderPenaltyMs: Number.isFinite(Number(sourceRules.wrongOrderPenaltyMs)) ? Number(sourceRules.wrongOrderPenaltyMs) : 2000,
            errorIndicatorMs: Number.isFinite(Number(sourceRules.errorIndicatorMs)) ? Number(sourceRules.errorIndicatorMs) : 1000,
            showGhost: sourceRules.showGhost !== false,
        },
    };
}

function createHarness(parcoursDefinition, playerOverrides = {}) {
    const nowRef = { value: 0 };
    const audioEvents = [];
    const player = {
        index: 0,
        isBot: false,
        alive: true,
        hitboxRadius: 0.8,
        position: { x: -1, y: 0, z: 0 },
        ...playerOverrides,
    };
    const entityManager = {
        arena: {
            currentMapDefinition: {
                parcours: parcoursDefinition,
            },
        },
        players: [player],
        audio: {
            play(type, options = {}) {
                audioEvents.push({ type, options });
            },
        },
        recorder: {
            logEvent() {},
        },
        _notifyPlayerFeedback() {},
    };
    const system = new ParcoursProgressSystem(entityManager, {
        nowProvider: () => nowRef.value,
    });
    system.startRound([player]);
    system.onPlayerSpawn(player, { reason: 'spawn_all' });
    return { nowRef, player, system, audioEvents };
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

test('ParcoursProgressSystem plays checkpoint and finish audio only for accepted human progress', () => {
    const harness = createHarness(createParcoursDefinition());
    const route = harness.system.getRouteSnapshot();
    const cp01 = route.checkpoints.find((entry) => entry.id === 'CP01');
    const cp02 = route.checkpoints.find((entry) => entry.id === 'CP02');
    const cp03 = route.checkpoints.find((entry) => entry.id === 'CP03');

    harness.nowRef.value = 100;
    assert.equal(crossCheckpoint(harness.system, harness.player, cp01, harness.nowRef.value)?.type, 'checkpoint');
    assert.deepEqual(harness.audioEvents.map((entry) => entry.type), ['PARCOURS_CP']);

    const snapshotAfterStart = harness.system.getPlayerProgressSnapshot(harness.player.index, harness.nowRef.value);
    assert.equal(snapshotAfterStart?.nextCheckpointIndex, 1);
    assert.ok(snapshotAfterStart?.startedAtMs > 0);

    harness.nowRef.value = 350;
    assert.equal(crossCheckpoint(harness.system, harness.player, cp02, harness.nowRef.value)?.type, 'checkpoint');
    harness.nowRef.value = 600;
    assert.equal(crossCheckpoint(harness.system, harness.player, cp03, harness.nowRef.value)?.type, 'checkpoint');
    harness.nowRef.value = 900;
    assert.equal(crossCheckpoint(harness.system, harness.player, route.finish, harness.nowRef.value)?.type, 'finish');

    assert.deepEqual(
        harness.audioEvents.map((entry) => entry.type),
        ['PARCOURS_CP', 'PARCOURS_CP', 'PARCOURS_CP', 'PARCOURS_FINISH']
    );
});

test('ParcoursProgressSystem uses branch audio for branch checkpoints and suppresses bot-local spam', () => {
    const branchHarness = createHarness(createParcoursDefinition({
        checkpoints: [
            { id: 'CP01', type: 'entry', pos: [0, 0, 0], radius: 1.2, forward: [1, 0, 0] },
            { id: 'CP02', type: 'gate', pos: [10, 0, 0], radius: 1.2, forward: [1, 0, 0], nextIds: ['CP03_TUNNEL', 'CP03_BOOST'] },
            { id: 'CP03_TUNNEL', type: 'branch_tunnel', pos: [20, 0, -6], radius: 1.2, forward: [1, 0, 0], nextIds: ['CP04'] },
            { id: 'CP03_BOOST', type: 'branch_boost', pos: [20, 0, 6], radius: 1.2, forward: [1, 0, 0], nextIds: ['CP04'] },
            { id: 'CP04', type: 'gate', pos: [30, 0, 0], radius: 1.2, forward: [1, 0, 0] },
        ],
        finish: { id: 'FINISH', type: 'finish', pos: [40, 0, 0], radius: 1.3, forward: [1, 0, 0] },
    }));
    const branchRoute = branchHarness.system.getRouteSnapshot();
    const cp01 = branchRoute.checkpoints.find((entry) => entry.id === 'CP01');
    const cp02 = branchRoute.checkpoints.find((entry) => entry.id === 'CP02');
    const branchBoost = branchRoute.checkpoints.find((entry) => entry.id === 'CP03_BOOST');

    branchHarness.nowRef.value = 100;
    assert.equal(crossCheckpoint(branchHarness.system, branchHarness.player, cp01, branchHarness.nowRef.value)?.type, 'checkpoint');
    branchHarness.nowRef.value = 260;
    assert.equal(crossCheckpoint(branchHarness.system, branchHarness.player, cp02, branchHarness.nowRef.value)?.type, 'checkpoint');
    branchHarness.nowRef.value = 420;
    assert.equal(crossCheckpoint(branchHarness.system, branchHarness.player, branchBoost, branchHarness.nowRef.value)?.type, 'checkpoint');
    assert.deepEqual(
        branchHarness.audioEvents.map((entry) => entry.type),
        ['PARCOURS_CP', 'PARCOURS_CP', 'PARCOURS_BRANCH']
    );

    const botHarness = createHarness(createParcoursDefinition(), { isBot: true });
    const botRoute = botHarness.system.getRouteSnapshot();
    const botCp01 = botRoute.checkpoints.find((entry) => entry.id === 'CP01');

    botHarness.nowRef.value = 100;
    assert.equal(crossCheckpoint(botHarness.system, botHarness.player, botCp01, botHarness.nowRef.value)?.type, 'checkpoint');
    assert.deepEqual(botHarness.audioEvents, []);
});
