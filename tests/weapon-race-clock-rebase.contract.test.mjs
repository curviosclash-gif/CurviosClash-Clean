import assert from 'node:assert/strict';
import test from 'node:test';

import { WeaponRaceRuntime } from '../src/core/arcade/WeaponRaceRuntime.js';
import { WEAPON_RACE_FINISH_GRACE_SECONDS } from '../src/shared/contracts/WeaponRaceContract.js';

// Race times live on the match simulation clock. That clock starts again at zero when a round
// starts (spawnAll) or when a sector rebuild hands the race a new entity manager (rebind). The race
// must carry its played time across such a switch instead of clamping every finish to its start.
function createManager(clockMs = 0) {
    const human = { index: 0, isBot: false, position: { x: 0, y: 0, z: 0 } };
    const bot = { index: 1, isBot: true, position: { x: 0, y: 0, z: 0 } };
    return {
        players: [human, bot],
        humanPlayers: [human],
        _projectileSystem: { clearForOwner() {} },
        _simulationClockMs: clockMs,
    };
}

test('a race armed before the round start reset keeps its played time', () => {
    const manager = createManager(50_000);
    const runtime = new WeaponRaceRuntime({ now: () => 1_790_000_000_000 });
    runtime.start({ entityManager: manager });

    manager._simulationClockMs = 0; // spawnAll starts the round clock again
    runtime.update();
    manager._simulationClockMs = 30_000;
    runtime.update();
    runtime.handleFinish({ playerIndex: 0, finishedAtMs: manager._simulationClockMs });

    assert.equal(runtime.state.racers['0'].finishTimeMs, 30_000);
});

test('a sector rebuild with a fresh entity manager keeps the race time running', () => {
    const first = createManager(0);
    const runtime = new WeaponRaceRuntime({ now: () => 1_790_000_000_000 });
    runtime.start({ entityManager: first });
    first._simulationClockMs = 10_000;
    runtime.update();

    const second = createManager(0);
    runtime.rebind({ entityManager: second });
    runtime.update();
    second._simulationClockMs = 20_000;
    runtime.update();
    runtime.handleFinish({ playerIndex: 0, finishedAtMs: second._simulationClockMs });

    assert.equal(runtime.state.racers['0'].finishTimeMs, 30_000, '10 s before and 20 s after the rebuild');
});

test('the grace period survives a clock switch after the first finish', () => {
    const first = createManager(0);
    const runtime = new WeaponRaceRuntime({ now: () => 1_790_000_000_000 });
    runtime.start({ entityManager: first });
    first._simulationClockMs = 30_000;
    runtime.update();
    runtime.handleFinish({ playerIndex: 0, finishedAtMs: first._simulationClockMs });

    const second = createManager(0);
    runtime.rebind({ entityManager: second });
    runtime.update();
    second._simulationClockMs = 5_000;

    assert.equal(runtime.getHudState().graceRemainingMs, WEAPON_RACE_FINISH_GRACE_SECONDS * 1000 - 5_000);
    assert.equal(runtime.getRoundOutcome(), null, 'only 5 s of the grace period have been played');
});

test('normal ticks on one clock never move the race start', () => {
    const manager = createManager(0);
    const runtime = new WeaponRaceRuntime({ now: () => 1_790_000_000_000 });
    runtime.start({ entityManager: manager });
    for (let ms = 1_000; ms <= 12_000; ms += 1_000) {
        manager._simulationClockMs = ms;
        runtime.update();
    }
    assert.equal(runtime.state.startedAtMs, 0);
});
