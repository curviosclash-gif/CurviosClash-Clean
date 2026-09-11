import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    calculateEndlessScore,
    ENDLESS_PARCOURS_BOT_CAPACITY,
    resolveEndlessDesiredBotCount,
    resolveEndlessDifficultyTier,
    resolveEndlessReinforcementDelay,
} from '../src/shared/contracts/EndlessParcoursContract.js';
import {
    generateEndlessParcoursModule,
    generateEndlessParcoursSequence,
} from '../src/entities/endless/EndlessParcoursGenerator.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import {
    ENDLESS_PARCOURS_RECORDS_STORAGE_KEY,
    loadEndlessParcoursRecords,
    saveEndlessParcoursRecords,
    updateEndlessParcoursRecords,
} from '../src/state/arcade/EndlessParcoursRecords.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { Arena } from '../src/entities/Arena.js';
import { findFixedMenuPresetSeedById } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';

function createRuntimeHarness(seed = 1337) {
    const sceneObjects = new Set();
    const renderer = {
        addToScene: (object) => sceneObjects.add(object),
        removeFromScene: (object) => sceneObjects.delete(object),
    };
    const batches = new Map();
    const arena = {
        bounds: {},
        enterStaticStreamingMode(bounds) { this.bounds = { ...bounds }; },
        exitStaticStreamingMode() { this.exited = true; },
        registerStaticColliderBatch(ownerId, colliders) { batches.set(ownerId, colliders); },
        unregisterStaticColliderBatch(ownerId) { batches.delete(ownerId); },
        getStaticColliderBatchCount() { return batches.size; },
        checkCollisionFast() { return false; },
    };
    const powerupManager = {
        items: [],
        spawnAtAnchor(anchor) { this.items.push({ ...anchor }); },
        removeByOwnerId(ownerId) {
            this.items = this.items.filter((item) => item.ownerId !== ownerId);
        },
    };
    const human = {
        index: 0,
        isBot: false,
        alive: true,
        entitySlotActive: true,
        baseSpeed: 18,
        speed: 18,
        position: new THREE.Vector3(0, 8, 8),
        getDirection(out) { return out.set(0, 0, 1); },
        setControlOptions(options) {
            if (options.speed) this.baseSpeed = options.speed;
        },
    };
    const bots = Array.from({ length: ENDLESS_PARCOURS_BOT_CAPACITY }, (_, slot) => ({
        player: {
            index: slot + 1,
            isBot: true,
            alive: false,
            entitySlotActive: false,
            position: new THREE.Vector3(),
        },
        ai: {},
    }));
    const roundEndRequests = [];
    const entityManager = {
        humanPlayers: [human],
        bots,
        players: [human, ...bots.map((entry) => entry.player)],
        _lockOnCache: new Map(),
        _projectileSystem: { clearInBounds() {} },
        requestRoundEnd(request) { roundEndRequests.push(request); return true; },
        activateBotSlot({ slot, position, role, difficulty }) {
            const player = bots[slot].player;
            if (player.entitySlotActive) return false;
            player.entitySlotActive = true;
            player.alive = true;
            player.position.set(position.x, position.y, position.z);
            player.scenarioRole = role;
            player.difficulty = difficulty;
            return true;
        },
        deactivateBotSlot(slot) {
            const player = bots[slot].player;
            player.entitySlotActive = false;
            player.alive = false;
            return true;
        },
        _notifyPlayerFeedback() {},
    };
    const runtime = new EndlessParcoursRuntime({
        baseSeed: seed,
        renderer,
        arena,
        powerupManager,
        entityManager,
        audio: { play() {} },
        wallClockIso: () => '2026-08-19T10:00:00.000Z',
    });
    return { runtime, human, bots, batches, powerupManager, roundEndRequests, sceneObjects };
}

test('endless module generation is deterministic, connected and has an intro', () => {
    const first = generateEndlessParcoursSequence(92731, 40, 4);
    const second = generateEndlessParcoursSequence(92731, 40, 4);
    assert.deepEqual(first, second);
    assert.equal(first[0].templateId, 'combat_free_intro');
    assert.equal(first[0].colliders.length, 0);
    assert.equal(first[0].pickups.length, 0);
    for (let index = 1; index < first.length; index += 1) {
        assert.equal(first[index - 1].exitConnector, first[index].entranceConnector);
        assert.equal(first[index].originZ, index * 120);
    }
    assert.notDeepEqual(
        generateEndlessParcoursSequence(92731, 20, 4),
        generateEndlessParcoursSequence(92732, 20, 4),
    );
});

test('difficulty, bot count, reinforcement delay and score use the specified thresholds', () => {
    assert.deepEqual([89, 90, 239, 240, 449, 450].map(resolveEndlessDifficultyTier), [1, 2, 2, 3, 3, 4]);
    assert.equal(resolveEndlessDesiredBotCount(0), 2);
    assert.equal(resolveEndlessDesiredBotCount(450), 12);
    assert.equal(resolveEndlessDesiredBotCount(9999), 12);
    assert.ok(resolveEndlessReinforcementDelay(360) < resolveEndlessReinforcementDelay(0));
    assert.equal(calculateEndlessScore({
        maxProgressMeters: 123.9,
        survivalSeconds: 61.9,
        botKills: 2,
        completedModules: 3,
    }), 2348);
});

test('runtime keeps streaming resources bounded and activates stable slots after the intro', () => {
    const { runtime, human, bots, batches, powerupManager, sceneObjects } = createRuntimeHarness();
    assert.equal(runtime.combatStarted, false);
    assert.equal(bots.filter((entry) => entry.player.alive).length, 0);

    human.position.z = 121;
    runtime.update(0);
    assert.equal(runtime.combatStarted, true);
    assert.ok(runtime.getHudState().spawnWarning);
    runtime.update(1);
    runtime.update(0);
    runtime.update(1.5);
    runtime.update(0);
    runtime.update(1.5);
    assert.equal(bots.filter((entry) => entry.player.alive).length, 2);

    for (let moduleIndex = 2; moduleIndex < 80; moduleIndex += 1) {
        human.position.z = moduleIndex * 120 + 1;
        runtime.update(1 / 60);
        const snapshot = runtime.getDebugSnapshot();
        assert.ok(snapshot.activeModules <= 7);
        assert.ok(snapshot.colliderBatches <= 7);
        assert.ok(snapshot.pickups <= 14);
        assert.equal(snapshot.botSlots.length, 12);
        assert.ok(sceneObjects.size <= 7);
    }
    assert.equal(batches.size, runtime.activeModules.size);
    assert.ok(powerupManager.items.length <= 14);
    runtime.dispose();
    assert.equal(batches.size, 0);
    assert.equal(sceneObjects.size, 0);
});

test('bot death is not refilled within a wave and its stable slot is reusable next wave', () => {
    const { runtime, human, bots } = createRuntimeHarness(99);
    human.position.z = 121;
    runtime.update(0);
    runtime.update(1);
    runtime.update(0.2);
    const entry = bots.find((bot) => bot.player.alive);
    const playerIndex = entry.player.index;
    entry.player.alive = false;
    runtime.handlePlayerDeath(entry.player, 'ROCKET', { killer: human });
    runtime.update(3);
    assert.equal(entry.player.alive, false);
    runtime.update(30);
    runtime.update(4);
    runtime.update(15);
    runtime.update(0);
    runtime.update(1);
    assert.equal(entry.player.index, playerIndex);
    assert.equal(entry.player.alive, true);
    assert.equal(runtime.botKills, 1);
    runtime.dispose();
});

test('finalization is exactly once and persistence failure stays non-fatal', () => {
    const { runtime, human, roundEndRequests } = createRuntimeHarness(7);
    runtime.setRecordStore({
        loadJsonRecord() { return null; },
        saveJsonRecord() { throw new Error('disk full'); },
    });
    human.position.z = 480;
    runtime.update(10);
    const first = runtime.finalize('ENDLESS_PLAYER_DEATH');
    const second = runtime.finalize('ENDLESS_VOID');
    assert.equal(first, second);
    assert.equal(roundEndRequests.length, 1);
    assert.equal(runtime.getHudState().persistence.ok, false);
    runtime.dispose();
});

test('record normalization rejects broken data and updates best plus last', () => {
    const empty = loadEndlessParcoursRecords({ loadJsonRecord: () => ({ schemaVersion: 'broken' }) });
    assert.equal(empty.best.score, 0);
    const update = updateEndlessParcoursRecords(empty, {
        score: 900,
        distanceMeters: 42,
        survivalSeconds: 12,
        completedModules: 2,
        botKills: 1,
        seed: 55,
    }, '2026-08-19T10:00:00.000Z');
    assert.equal(update.isNewRecord, true);
    let savedKey = '';
    assert.deepEqual(saveEndlessParcoursRecords({
        saveJsonRecord(key) { savedKey = key; return true; },
    }, update.records), { ok: true, reason: 'ok' });
    assert.equal(savedKey, ENDLESS_PARCOURS_RECORDS_STORAGE_KEY);
});

test('Arcade endless composes Hunt combat without changing the global mode id', () => {
    const strategy = new ArcadeModeStrategy({
        runType: 'endless_parcours',
        combatProfile: 'hunt',
        random: () => 0.25,
    });
    assert.equal(strategy.modeType, 'ARCADE');
    assert.equal(strategy.getPickupModeType(), 'HUNT');
    assert.equal(strategy.hasCombatHud(), true);
    assert.equal(strategy.hasMachineGun(), true);
    assert.equal(strategy.requiresShootItemIndex(), true);
    assert.ok(strategy.resolveRocketProjectileParams('ROCKET_WEAK'));
    assert.ok(strategy.filterSpawnableTypes(['ROCKET_WEAK', 'MG_TURRET', 'SLOW_TIME'], {
        ROCKET_WEAK: {}, MG_TURRET: {}, SLOW_TIME: {},
    }).includes('ROCKET_WEAK'));
});

test('inactive stable slots do not affect elimination outcome', () => {
    const human = { alive: true, entitySlotActive: true };
    const inactive = Array.from({ length: 12 }, () => ({ alive: false, entitySlotActive: false }));
    const system = new RoundOutcomeSystem({ getPlayers: () => [human, ...inactive] });
    assert.equal(system.resolve().shouldEnd, false);
    assert.equal(system.requestRoundEnd({ winner: null, allowNoWinner: true, reason: 'ENDLESS_PLAYER_DEATH' }), true);
    assert.equal(system.resolve().reason, 'ENDLESS_PLAYER_DEATH');
});

test('static collider batches invalidate the collision grid even at the same size', () => {
    const arena = new Arena({ removeFromScene() {} });
    arena.enterStaticStreamingMode({ minX: -1000, maxX: 1000, minY: -1000, maxY: 1000, minZ: -1000, maxZ: 1000 });
    const boxes = (near) => Array.from({ length: 12 }, (_, index) => ({
        box: new THREE.Box3(
            new THREE.Vector3((near && index === 0) ? -1 : 100 + index * 4, -1, -1),
            new THREE.Vector3((near && index === 0) ? 1 : 102 + index * 4, 1, 1),
        ),
    }));
    arena.registerStaticColliderBatch('stream', boxes(false));
    assert.equal(arena.checkCollisionFast(new THREE.Vector3(0, 0, 0), 0.5), false);
    const before = arena.staticCollisionRevision;
    arena.registerStaticColliderBatch('stream', boxes(true));
    assert.ok(arena.staticCollisionRevision > before);
    assert.equal(arena.checkCollisionFast(new THREE.Vector3(0, 0, 0), 0.5), true);
    arena.exitStaticStreamingMode();
});

test('settings and fixed preset expose Endlosjagd as Arcade + Hunt profile', () => {
    const normalized = normalizeArcadeRunSettings({ runType: 'endless_parcours', combatProfile: 'hunt' });
    assert.equal(normalized.runType, 'endless_parcours');
    assert.equal(normalized.combatProfile, 'hunt');
    assert.equal(normalizeArcadeRunSettings({ runType: 'gauntlet', combatProfile: 'hunt' }).combatProfile, '');
    const preset = findFixedMenuPresetSeedById('endlosjagd');
    assert.equal(preset.values.gameMode, 'ARCADE');
    assert.equal(preset.values['arcade.runType'], 'endless_parcours');
    assert.equal(preset.values['arcade.combatProfile'], 'hunt');
});
