import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ReplayScenePresentationSystem } from '../src/entities/replay/ReplayScenePresentationSystem.js';
import {
    hideKillcamLivePresentation,
    restoreKillcamLivePresentation,
} from '../src/hunt/KillcamPresentationOps.js';
import { MatchFlowLifecycleController } from '../src/ui/MatchFlowLifecycleController.js';

function createLivePlayer(index, alive) {
    const player = {
        index,
        isBot: index !== 0,
        alive,
        position: new THREE.Vector3(index * 5, 2, 0),
        quaternion: new THREE.Quaternion(),
        trail: {},
    };
    player.view = {
        group: new THREE.Group(),
        syncFromState() { this.group.position.copy(player.position); },
        applyModelScale() {},
    };
    player.view.group.visible = alive;
    return player;
}

function createReplayClip() {
    const frames = [];
    for (let i = 0; i <= 10; i += 1) {
        frames.push({
            time: i * 0.1,
            players: [
                { idx: 0, x: 0, y: 2, z: -i, qw: 1, alive: true },
                { idx: 1, x: 5, y: 2, z: -i, qw: 1, alive: true },
                { idx: 2, x: 9, y: 2, z: -i, qw: 1, alive: true },
            ],
        });
    }
    return { sourceDuration: 1, displayDuration: 2, players: [{ idx: 0 }, { idx: 1 }, { idx: 2 }], frames };
}

test('killcam replay hands borrowed vehicle views back hidden when their player died meanwhile', () => {
    const victim = createLivePlayer(0, false);
    const botKilledDuringReplay = createLivePlayer(1, true);
    const botStillAlive = createLivePlayer(2, true);
    const livePlayers = [victim, botKilledDuringReplay, botStillAlive];
    const replay = new ReplayScenePresentationSystem({}, { presentationKind: 'killcam-replay' });

    assert.equal(replay.playClip(createReplayClip(), { loop: false, useLivePlayerViews: true, livePlayers }), true);
    replay.seekSourceTime(0.5, 1 / 60);
    botKilledDuringReplay.alive = false;
    replay.clear();

    assert.equal(botKilledDuringReplay.view.group.visible, false, 'a bot killed during the killcam must not reappear');
    assert.equal(botStillAlive.view.group.visible, true);
    assert.equal(victim.view.group.visible, false);
});

test('killcam presentation restore keeps players hidden that died while it was hidden', () => {
    const botKilledDuringKillcam = createLivePlayer(1, true);
    const botStillAlive = createLivePlayer(2, true);
    const respawnedVictim = createLivePlayer(0, false);
    const killcam = { _presentationEntries: [], replaySystem: null, entityManager: {} };

    hideKillcamLivePresentation(killcam, [respawnedVictim, botKilledDuringKillcam, botStillAlive]);
    botKilledDuringKillcam.alive = false;
    respawnedVictim.alive = true;
    restoreKillcamLivePresentation(killcam);

    assert.equal(botKilledDuringKillcam.view.group.visible, false);
    assert.equal(botStillAlive.view.group.visible, true);
    assert.equal(respawnedVictim.view.group.visible, true);
});

test('round end stops a running killcam before the round-end ghost replay starts', () => {
    const calls = [];
    let killcamActive = true;
    const entityManager = {
        resetKillcamFrameCapture() { killcamActive = false; calls.push('killcam-cleared'); },
        playLastRoundGhost() { calls.push('ghost'); return true; },
        clearLastRoundGhost() { calls.push('ghost'); },
    };
    const lifecycleController = new MatchFlowLifecycleController({
        matchFlowUiController: { _getMatchRuntimeProjection: () => ({}), applyMatchUiState() {} },
        game: { entityManager },
        runtimePort: {},
        coordinateRoundEnd: () => ({}),
    });

    lifecycleController.onRoundEnd({ name: 'Bot 2' });

    assert.equal(killcamActive, false, 'the killcam must not keep running over the result board');
    assert.ok(calls.indexOf('killcam-cleared') >= 0 && calls.indexOf('killcam-cleared') < calls.indexOf('ghost'));
});
