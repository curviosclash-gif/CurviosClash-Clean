// The run tier only sets the floor of the bot difficulty: later waves still climb the authored
// wave table (EASY -> NORMAL -> HARD). Before, the tier AI ("NORMAL" on Normal) replaced every
// wave row, so Arena Waves and Endless Parcours never reached their HARD waves.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

import { ARENA_WAVES_BOT_CAPACITY } from '../src/shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { tryActivateEndlessSlot } from '../src/entities/endless/EndlessParcoursSlotOps.js';
import { ENDLESS_PARCOURS_WAVE_PHASES } from '../src/shared/contracts/EndlessParcoursWaveContract.js';
import { resolveHigherArcadeBotDifficulty } from '../src/entities/directors/ArcadeEncounterCatalog.js';

test('the higher of tier floor and wave difficulty wins', () => {
    assert.equal(resolveHigherArcadeBotDifficulty('NORMAL', 'EASY'), 'NORMAL');
    assert.equal(resolveHigherArcadeBotDifficulty('NORMAL', 'HARD'), 'HARD');
    assert.equal(resolveHigherArcadeBotDifficulty('HARD', 'EASY'), 'HARD');
    assert.equal(resolveHigherArcadeBotDifficulty(undefined, 'EASY'), 'EASY', 'without a tier the wave row stays');
    assert.equal(resolveHigherArcadeBotDifficulty('NORMAL', undefined), 'NORMAL');
});

function arenaFixture() {
    const human = { index: 0, isBot: false, alive: true, maxHp: 100, hp: 100, baseSpeed: 10, speed: 10, fightLoadout: {}, position: { x: 0, y: 1, z: 0 } };
    const bots = Array.from({ length: ARENA_WAVES_BOT_CAPACITY }, (_, slot) => ({ player: { index: slot + 1, isBot: true, alive: false, maxHp: 100, hp: 100 }, ai: { setArcadeBotAggressiveness() {} }, slot }));
    const difficulties = new Map();
    const manager = {
        humanPlayers: [human], players: [human, ...bots.map((entry) => entry.player)], bots,
        _findSpawnPosition(_x, _z, { player }) { return { x: player.index, y: 1, z: 9 }; },
        activateBotSlot({ slot, difficulty }) { difficulties.set(slot, difficulty); bots[slot].player.alive = true; return true; },
        deactivateBotSlot(slot) { bots[slot].player.alive = false; return true; },
        powerupManager: { spawnAtAnchor() {} },
    };
    return { manager, difficulties };
}

function clearArena(runtime, manager) {
    for (let wave = 1; wave <= 2; wave++) {
        for (const slot of [...runtime._activeSlots]) runtime.handleGameplayEvent({
            type: 'kill', playerIndex: 0, victimIndex: manager.bots[slot].player.index,
        });
        runtime.update(5);
    }
    assert.equal(runtime.phase, 'upgrade');
}

test('arena waves climb to HARD on the Normal tier and never drop below the tier', () => {
    const f = arenaFixture();
    const runtime = new ArenaWavesRuntime();
    runtime.rankContext = { botStrength: { ai: 'NORMAL', tierId: 'normal' } };
    runtime.start({ entityManager: f.manager });
    runtime.update(5); runtime.update(1);
    assert.equal(f.difficulties.get(0), 'NORMAL', 'wave 1 (EASY row) is lifted to the Normal floor');
    for (let mapIndex = 0; mapIndex < 2; mapIndex++) {
        clearArena(runtime, f.manager);
        runtime.selectChoice(runtime.getHudState().choices[0]);
        runtime.start({ entityManager: f.manager });
        runtime.update(5); runtime.update(1);
    }
    assert.equal(runtime.mapIndex, 2);
    const waveFiveSlot = [...runtime._slotWave.entries()].find(([, wave]) => wave === 1)[0];
    assert.equal(f.difficulties.get(waveFiveSlot), 'HARD', 'wave 5 uses its HARD row');
});

function endlessRuntime(rankContext, waveNumber) {
    const anchor = { id: 'a1', x: 0, y: 1, z: 30 };
    const player = { maxHp: 100, hp: 100, inventory: [], rocketInventory: [] };
    let difficulty = null;
    const runtime = {
        rankContext, waveNumber, baseSeed: 1, runId: 'run', elapsedCombatSeconds: 10, lastBotActivationAtSeconds: 0,
        respiteUntilSeconds: 0, wavePhase: ENDLESS_PARCOURS_WAVE_PHASES.ATTACK, currentModuleIndex: 0, _activationSequence: 0,
        activeModules: new Map([[0, { module: { recovery: false, botAnchors: [anchor] } }]]),
        _isSpawnAnchorSafe: () => true,
        _tmpSpawnDirection: new Vector3(),
        projectCoursePoint: () => ({ tangent: { x: 0, y: 0, z: 1 } }),
        entityManager: { humanPlayers: [{}], activateBotSlot(request) { difficulty = request.difficulty; return true; } },
    };
    const slotState = { slot: 0, state: 'reserved', reservedWave: waveNumber, telegraphedAt: 0, plannedAnchor: { ...anchor }, plannedElite: false, life: 0, activationGeneration: 0, player };
    assert.equal(tryActivateEndlessSlot(runtime, slotState), true);
    return difficulty;
}

test('endless parcours bots follow the wave table above the tier floor', () => {
    const normal = { botStrength: { ai: 'NORMAL', tierId: 'normal' } };
    assert.equal(endlessRuntime(normal, 1), 'NORMAL', 'early EASY waves are lifted to the tier');
    assert.equal(endlessRuntime(normal, 6), 'HARD', 'wave 6 reaches its HARD row on Normal');
    assert.equal(endlessRuntime({ botStrength: { ai: 'HARD', tierId: 'hard' } }, 1), 'HARD');
    assert.equal(endlessRuntime(null, 1), 'EASY', 'without a rank context the wave table decides');
});
