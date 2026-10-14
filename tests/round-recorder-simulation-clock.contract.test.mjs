import assert from 'node:assert/strict';
import test from 'node:test';

import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { createMatchSessionPort } from '../src/state/MatchLifecycleSessionPort.js';
import { RoundRecorder } from '../src/state/RoundRecorder.js';

function createPosition() {
    return { clone: () => ({ set() { return this; } }) };
}

test('round metrics use simulation time and rebase after spawnAll resets the round clock', () => {
    const human = { index: 0, isBot: false, alive: true, spawn() {} };
    const bot = { index: 1, isBot: true, alive: true, spawn() {} };
    const recorder = new RoundRecorder();
    recorder.setReplayCaptureEnabled(false);
    const manager = {
        _simulationClockMs: 52_000,
        recorder,
        players: [human, bot],
        _respawnSystem: { reset() {} },
        _huntScoring: { reset() {} },
        _roundOutcomeSystem: { reset() {} },
        createSpawnContext: () => null,
        _findSpawnPosition: () => createPosition(),
        _findSafeSpawnDirection: () => null,
        resetKillcamFrameCapture() {},
        spawnAll() { new EntitySpawnOps(this).spawnAll(); },
        getHumanPlayers() { return this.players.filter((player) => !player.isBot); },
    };
    const port = createMatchSessionPort({
        recorder,
        matchSessionRuntimeBridge: {
            getCurrentMatchSessionRefs: () => ({ entityManager: manager, powerupManager: { clear() {} } }),
        },
    });

    port.resetRoundRuntime();

    assert.equal(manager._simulationClockMs, 0);
    assert.deepEqual(recorder.events.slice(0, recorder.eventCount).map(({ type, time }) => [type, time]), [
        ['SPAWN', 0],
        ['SPAWN', 0],
    ]);

    manager._simulationClockMs = 7_000;
    recorder.markPlayerDeath(bot, 'WALL');
    const summary = recorder.finalizeRound(human, manager.players);

    assert.equal(summary.duration, 7);
    assert.deepEqual(summary.botSurvivalSeconds, [7]);
    assert.deepEqual(summary.botDeathSurvivalSeconds, [7]);
    assert.equal(recorder.events[recorder.eventCount - 1].time, 7);
});
