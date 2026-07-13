import test from 'node:test';
import assert from 'node:assert/strict';

import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

function createRouteDefinition() {
    return {
        enabled: true,
        routeId: 'unit_route',
        checkpoints: [{
            id: 'CP01',
            pos: [0, 0, 0],
            radius: 2,
            forward: [1, 0, 0],
        }],
        finish: {
            id: 'FINISH',
            pos: [10, 0, 0],
            radius: 2,
            forward: [1, 0, 0],
        },
        rules: {
            ordered: true,
            showGhost: true,
            resetOnDeath: true,
        },
    };
}

function createPlayer(index, { isBot = false } = {}) {
    return {
        index,
        isBot,
        alive: true,
        hitboxRadius: 0.8,
        position: { x: -1, y: 0, z: 0 },
    };
}

function createEntityManager(routeDefinition) {
    let progressProvider = null;
    return {
        arena: {
            currentMapDefinition: {
                parcours: routeDefinition,
            },
            _portalGateSystem: {
                checkpointRingRuntime: {
                    setProgressProvider(provider) {
                        progressProvider = typeof provider === 'function' ? provider : null;
                    },
                    setParticleSystem() {},
                },
            },
        },
        renderer: {
            viewportSystem: {
                localPlayerIndex: 0,
            },
        },
        particles: null,
        recorder: {
            logEvent() {},
        },
        _notifyPlayerFeedback() {},
        __getProgressProvider() {
            return progressProvider;
        },
    };
}

function crossCheckpoint(system, player, checkpoint, nowMs, distance = 0.5) {
    const pos = Array.isArray(checkpoint?.pos) ? checkpoint.pos : [0, 0, 0];
    const forward = Array.isArray(checkpoint?.forward) ? checkpoint.forward : [1, 0, 0];
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

function crossFinish(system, player, finish, nowMs, distance = 0.5) {
    const pos = Array.isArray(finish?.pos) ? finish.pos : [0, 0, 0];
    const forward = Array.isArray(finish?.forward) ? finish.forward : [1, 0, 0];
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

test('ParcoursProgressSystem starts ghost recording only for human players', () => {
    const routeDefinition = createRouteDefinition();
    const human = createPlayer(0, { isBot: false });
    const bot = createPlayer(1, { isBot: true });
    const ghostStartEvents = [];
    const recorderStarts = [];
    const ghostRecorder = {
        _recording: false,
        sample() {},
        startRecording(playerIndex, nowMs) {
            recorderStarts.push({ playerIndex, nowMs });
            this._recording = true;
            return true;
        },
        stopRecording() {
            this._recording = false;
            return null;
        },
        reset() {
            this._recording = false;
        },
        get isRecording() {
            return this._recording;
        },
    };
    const entityManager = createEntityManager(routeDefinition);
    const system = new ParcoursProgressSystem(entityManager);
    system.setGhostRecorder(ghostRecorder);
    system.setLeaderboardCallback((payload) => {
        if (payload?.type === 'ghost_start') {
            ghostStartEvents.push(payload);
        }
    });
    system.startRound([human, bot]);

    const routeSnapshot = system.getRouteSnapshot();
    const firstCheckpoint = routeSnapshot?.checkpoints?.[0];
    assert.ok(firstCheckpoint);

    crossCheckpoint(system, bot, firstCheckpoint, 1000);
    crossCheckpoint(system, human, firstCheckpoint, 1200);
    crossCheckpoint(system, bot, firstCheckpoint, 1400);

    assert.deepEqual(recorderStarts, [{ playerIndex: 0, nowMs: 1200 }]);
    assert.deepEqual(ghostStartEvents, [{
        type: 'ghost_start',
        playerIndex: 0,
        routeId: 'unit_route',
        source: 'parcours_checkpoint_start',
    }]);
});

test('ParcoursProgressSystem progress provider follows local viewport player index', () => {
    const routeDefinition = createRouteDefinition();
    const player0 = createPlayer(0, { isBot: false });
    const player1 = createPlayer(1, { isBot: false });
    const entityManager = createEntityManager(routeDefinition);
    entityManager.renderer.viewportSystem.localPlayerIndex = 1;
    entityManager.players = [player0, player1];
    const system = new ParcoursProgressSystem(entityManager);
    system.startRound([player0, player1]);

    const provider = entityManager.__getProgressProvider();
    assert.equal(typeof provider, 'function');

    const routeSnapshot = system.getRouteSnapshot();
    const firstCheckpoint = routeSnapshot?.checkpoints?.[0];
    assert.ok(firstCheckpoint);
    crossCheckpoint(system, player1, firstCheckpoint, 1000);

    const snapshot = provider();
    assert.equal(snapshot?.nextCheckpointIndex, 1);
    assert.equal(snapshot?.lastCheckpointId, 'CP01');
});

test('ParcoursProgressSystem lets only the owning human finish the ghost recording', () => {
    const routeDefinition = createRouteDefinition();
    const human = createPlayer(0, { isBot: false });
    const bot = createPlayer(1, { isBot: true });
    const stopCalls = [];
    const ghostRecorder = {
        _recording: false,
        _owner: -1,
        sample() {},
        startRecording(playerIndex) {
            this._recording = true;
            this._owner = playerIndex;
            return true;
        },
        stopRecording() {
            stopCalls.push(this._owner);
            this._recording = false;
            return {
                frames: [
                    { time: 0, players: [{ idx: this._owner }] },
                    { time: 1, players: [{ idx: this._owner }] },
                ],
                players: [{ idx: this._owner, color: 0xffffff }],
                sourceDuration: 1,
                displayDuration: 1,
            };
        },
        reset() {
            this._recording = false;
            this._owner = -1;
        },
        isOwnedBy(playerIndex) {
            return this._owner === playerIndex;
        },
        get isRecording() {
            return this._recording;
        },
    };
    const finishEvents = [];
    const entityManager = createEntityManager(routeDefinition);
    const system = new ParcoursProgressSystem(entityManager);
    system.setGhostRecorder(ghostRecorder);
    system.setLeaderboardCallback((payload) => {
        if (payload?.type === 'finish') {
            finishEvents.push(payload);
        }
    });
    system.startRound([human, bot]);

    const routeSnapshot = system.getRouteSnapshot();
    const firstCheckpoint = routeSnapshot?.checkpoints?.[0];
    const finish = routeSnapshot?.finish;
    assert.ok(firstCheckpoint);
    assert.ok(finish);

    crossCheckpoint(system, human, firstCheckpoint, 1000);
    crossCheckpoint(system, bot, firstCheckpoint, 1100);
    crossFinish(system, bot, finish, 2000);
    crossFinish(system, human, finish, 2200);

    assert.deepEqual(stopCalls, [0]);
    assert.equal(finishEvents[0]?.playerIndex, 1);
    assert.equal(finishEvents[0]?.ghostClip, null);
    assert.equal(finishEvents[1]?.playerIndex, 0);
    assert.equal(finishEvents[1]?.ghostClip?.players?.[0]?.idx, 0);
});

test('ParcoursProgressSystem cancels active ghost recording on death, timeout and reset', () => {
    const routeDefinition = createRouteDefinition();
    routeDefinition.rules.maxSegmentTimeMs = 200;
    const human = createPlayer(0, { isBot: false });
    const cancelCalls = [];
    const ghostRecorder = {
        _recording: false,
        _owner: -1,
        sample() {},
        startRecording(playerIndex) {
            this._recording = true;
            this._owner = playerIndex;
            return true;
        },
        stopRecording() {
            this._recording = false;
            return null;
        },
        cancelRecording(reason, playerIndex = null) {
            if (!this._recording) return false;
            if (playerIndex != null && playerIndex !== this._owner) return false;
            cancelCalls.push({ reason, playerIndex });
            this._recording = false;
            return true;
        },
        reset() {
            this._recording = false;
            this._owner = -1;
        },
        isOwnedBy(playerIndex) {
            return this._recording === true && this._owner === playerIndex;
        },
        get isRecording() {
            return this._recording;
        },
    };
    const system = new ParcoursProgressSystem(createEntityManager(routeDefinition));
    system.setGhostRecorder(ghostRecorder);
    system.startRound([human]);

    const routeSnapshot = system.getRouteSnapshot();
    const firstCheckpoint = routeSnapshot?.checkpoints?.[0];
    assert.ok(firstCheckpoint);

    crossCheckpoint(system, human, firstCheckpoint, 1000);
    system.onPlayerDeath(human, { cause: 'wall' });
    assert.deepEqual(cancelCalls[0], { reason: 'death:wall', playerIndex: 0 });
    assert.equal(ghostRecorder.isRecording, false);

    crossCheckpoint(system, human, firstCheckpoint, 1300);
    human.position.x = 2;
    human.position.y = 0;
    human.position.z = 0;
    system.updatePlayerProgress(human, { x: 1.6, y: 0, z: 0 }, 1601);
    assert.deepEqual(cancelCalls[1], { reason: 'segment-timeout', playerIndex: 0 });
    assert.equal(ghostRecorder.isRecording, false);

    crossCheckpoint(system, human, firstCheckpoint, 1900);
    system.reset();
    assert.deepEqual(cancelCalls[2], { reason: 'parcours-reset', playerIndex: null });
    assert.equal(ghostRecorder.isRecording, false);
});
