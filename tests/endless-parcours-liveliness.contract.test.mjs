import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    calculateEndlessScore,
    ENDLESS_PARCOURS_BOT_CAPACITY,
    resolveEndlessMilestones,
} from '../src/shared/contracts/EndlessParcoursContract.js';
import {
    ENDLESS_PARCOURS_CHECKPOINT,
    ENDLESS_PARCOURS_ELITE,
    ENDLESS_PARCOURS_SHAKEOFF_SCORE,
    ENDLESS_PARCOURS_STREAK,
    resolveEndlessEliteWaveIndex,
    resolveEndlessSpeedMultiplier,
    resolveEndlessStagePalette,
    resolveEndlessStreakBonus,
    resolveEndlessStreakMultiplier,
    resolveEndlessVoidWarning,
    shouldSpawnEndlessElite,
} from '../src/shared/contracts/EndlessParcoursStageContract.js';
import {
    ENDLESS_CONNECTORS,
    ENDLESS_DRIFT_LIMITS,
    isEndlessConnectorAllowed,
    resolveEndlessCourseCenter,
} from '../src/entities/endless/EndlessParcoursConnectors.js';
import {
    ENDLESS_RECOVERY_GUARANTEE,
    generateEndlessParcoursSequence,
} from '../src/entities/endless/EndlessParcoursGenerator.js';
import { EndlessParcoursPath } from '../src/entities/endless/EndlessParcoursPath.js';
import { isCycleColliderClosed } from '../src/entities/endless/EndlessParcoursModuleBuilder.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { resolveEndlessCheckpointIndex } from '../src/entities/endless/EndlessParcoursRunOps.js';
import {
    ENDLESS_PARCOURS_RECORDS_LEGACY_SCHEMA_VERSION,
    ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION,
    ENDLESS_PARCOURS_TOP_RUNS,
    normalizeEndlessParcoursRecords,
    resolveEndlessMilestoneLabel,
    summarizeEndlessRecordsLine,
    updateEndlessParcoursRecords,
} from '../src/shared/contracts/EndlessParcoursRecordsContract.js';
import * as stateRecords from '../src/state/arcade/EndlessParcoursRecords.js';
import { resolveScenarioBotTuning } from '../src/hunt/HuntScenarioBotRoles.js';
import { beginEndlessAttackWave } from '../src/entities/endless/EndlessParcoursWaveOps.js';

function createHarness(seed = 4242) {
    const sceneObjects = new Set();
    const batchWrites = [];
    const batches = new Map();
    const feedback = [];
    const sounds = [];
    const spawnCalls = [];
    const renderer = {
        addToScene: (object) => sceneObjects.add(object),
        removeFromScene: (object) => sceneObjects.delete(object),
    };
    const arena = {
        bounds: {},
        enterStaticStreamingMode(bounds) { this.bounds = { ...bounds }; },
        exitStaticStreamingMode() { this.exited = true; },
        registerStaticColliderBatch(ownerId, colliders) {
            batches.set(ownerId, colliders);
            batchWrites.push(ownerId);
        },
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
        baseSpeed: 20,
        speed: 20,
        hp: 100,
        maxHp: 100,
        inventory: [],
        position: new THREE.Vector3(0, 8, 8),
        getDirection(out) { return out.set(0, 0, 1); },
        setControlOptions(options) {
            if (options.speed) this.appliedSpeed = options.speed;
        },
        spawn(position, direction) {
            this.position.copy(position);
            this.alive = true;
            this.hp = this.maxHp;
            void direction;
        },
    };
    const bots = Array.from({ length: ENDLESS_PARCOURS_BOT_CAPACITY }, (_, slot) => ({
        player: {
            index: slot + 1,
            isBot: true,
            alive: false,
            entitySlotActive: false,
            hp: 100,
            maxHp: 100,
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
        _spawnOps: {
            spawnPlayerAt(player, position, direction) {
                spawnCalls.push({ index: player.index, z: position.z });
                player.spawn(position, direction);
                return true;
            },
        },
        requestRoundEnd(request) { roundEndRequests.push(request); return true; },
        activateBotSlot({ slot, position, role, difficulty }) {
            const player = bots[slot].player;
            if (player.entitySlotActive) return false;
            player.entitySlotActive = true;
            player.alive = true;
            player.maxHp = 100;
            player.hp = 100;
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
        _killPlayer(player, cause) {
            player.alive = false;
            player.lastCause = cause;
        },
        _notifyPlayerFeedback(_player, message) { feedback.push(String(message || '')); },
    };
    const runtime = new EndlessParcoursRuntime({
        baseSeed: seed,
        renderer,
        arena,
        powerupManager,
        entityManager,
        audio: { play(id) { sounds.push(String(id)); } },
        wallClockIso: () => '2026-09-09T10:00:00.000Z',
    });
    return {
        runtime, human, bots, batches, batchWrites, powerupManager,
        roundEndRequests, sceneObjects, feedback, sounds, spawnCalls, entityManager,
    };
}

/** Bringt den Lauf in den Kampfzustand, ohne die Zeit gross vorzuspulen. */
function enterCombat(harness, seconds = 1) {
    harness.human.position.z = 121;
    harness.runtime.update(0);
    if (seconds <= 0) return;
    harness.runtime.update(1);
    harness.runtime.update(0);
    harness.runtime.update(Math.max(1.5, seconds));
}

test('the course really bends: connectors vary, chain stays linked and drift stays bounded', () => {
    const sequence = generateEndlessParcoursSequence(20260909, 60, 3);
    const usedConnectors = new Set(sequence.map((module) => module.exitConnector));
    assert.ok(usedConnectors.size > 1, 'die Strecke darf nicht nur aus Geraden bestehen');
    assert.ok(
        [...usedConnectors].some((id) => id !== 'straight'),
        'mindestens ein echter Knick muss vorkommen'
    );
    for (let index = 1; index < sequence.length; index += 1) {
        const previous = sequence[index - 1];
        const current = sequence[index];
        assert.equal(previous.exitConnector, current.entranceConnector);
        assert.deepEqual(
            { x: current.entryDrift.x, y: current.entryDrift.y },
            { x: previous.exitDrift.x, y: previous.exitDrift.y },
            'der Korridor darf am Modulwechsel nicht springen'
        );
        assert.ok(current.exitDrift.x >= ENDLESS_DRIFT_LIMITS.minX);
        assert.ok(current.exitDrift.x <= ENDLESS_DRIFT_LIMITS.maxX);
        assert.ok(current.exitDrift.y >= ENDLESS_DRIFT_LIMITS.minY);
        assert.ok(current.exitDrift.y <= ENDLESS_DRIFT_LIMITS.maxY);
    }
});

test('drift limits refuse connectors that would leave the allowed corridor band', () => {
    assert.equal(isEndlessConnectorAllowed({ x: 40, y: 0 }, ENDLESS_CONNECTORS.bend_right), false);
    assert.equal(isEndlessConnectorAllowed({ x: 40, y: 0 }, ENDLESS_CONNECTORS.bend_left), true);
    assert.equal(isEndlessConnectorAllowed({ x: 0, y: 28 }, ENDLESS_CONNECTORS.climb), false);
    assert.equal(isEndlessConnectorAllowed({ x: 40, y: 28 }, ENDLESS_CONNECTORS.straight), true);
});

test('the corridor centre eases instead of jumping at the module seam', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 14, y: 0 };
    assert.deepEqual(resolveEndlessCourseCenter(from, to, 0), { x: 0, y: 0 });
    assert.equal(Math.round(resolveEndlessCourseCenter(from, to, 0.5).x), 7);
    assert.equal(Math.round(resolveEndlessCourseCenter(from, to, 1).x), 14);
    const early = resolveEndlessCourseCenter(from, to, 0.08).x;
    assert.ok(early < 14 * 0.08, 'der Knick startet weich, nicht linear');
});

test('the path cache freezes a module tier so replaying the same stretch is stable', () => {
    const path = new EndlessParcoursPath({ baseSeed: 777 });
    const earlyModule = path.getModule(3, 1);
    const laterSameIndex = path.getModule(3, 4);
    assert.deepEqual(earlyModule, laterSameIndex, 'ein bereits gebauter Abschnitt darf sich nicht rueckwirkend aendern');
    assert.equal(path.getChainLength(), 4);
    const fresh = new EndlessParcoursPath({ baseSeed: 777 });
    assert.deepEqual(fresh.getModule(3, 1), earlyModule, 'dieselbe Saat ergibt dieselbe Strecke');
});

test('a recovery module is guaranteed within the promised window and keeps its pickups', () => {
    for (const seed of [11, 2024, 98765]) {
        const sequence = generateEndlessParcoursSequence(seed, 40, 4);
        let sinceRecovery = 0;
        let sawRecovery = false;
        for (let index = 1; index < sequence.length; index += 1) {
            if (sequence[index].recovery) {
                sawRecovery = true;
                assert.equal(sequence[index].pickups.length, 2, 'das Erholungsmodul behaelt beide Items');
                sinceRecovery = 0;
                continue;
            }
            sinceRecovery += 1;
            assert.ok(
                sinceRecovery <= ENDLESS_RECOVERY_GUARANTEE,
                `Seed ${seed}: nach ${sinceRecovery} Bausteinen fehlt weiterhin Nachschub`
            );
        }
        assert.ok(sawRecovery);
    }
});

test('checkpoint crossing pays, arms the revive and is counted once per gate', () => {
    const harness = createHarness(1234);
    enterCombat(harness);
    const { runtime } = harness;
    assert.equal(runtime.checkpointsPassed, 1);
    assert.equal(runtime.lastCheckpointIndex, 0);
    assert.ok(runtime.bonusScore >= ENDLESS_PARCOURS_CHECKPOINT.bonusScore);
    assert.ok(harness.sounds.includes('PARCOURS_CP'), 'das Tor muss hoerbar sein');
    assert.ok(runtime.getHudState().reviveArmed, 'nach dem Tor ist die Rettung bereit');

    const bonusAfterFirstGate = runtime.bonusScore;
    harness.human.position.z = 200;
    runtime.update(1 / 60);
    assert.equal(runtime.checkpointsPassed, 1, 'ohne neues Tor darf nichts dazukommen');
    assert.equal(runtime.bonusScore, bonusAfterFirstGate);

    harness.human.position.z = 240;
    runtime.update(1 / 60);
    assert.equal(runtime.checkpointsPassed, 2);
    runtime.dispose();
});

test('checkpoint index maps distance to gates without searching modules', () => {
    assert.equal(resolveEndlessCheckpointIndex(0), -1);
    assert.equal(resolveEndlessCheckpointIndex(115), -1);
    assert.equal(resolveEndlessCheckpointIndex(116), 0);
    assert.equal(resolveEndlessCheckpointIndex(236), 1);
    assert.equal(resolveEndlessCheckpointIndex(999), 7);
});

test('death inside the revive window continues the run exactly once per gate', () => {
    const harness = createHarness(555);
    enterCombat(harness);
    const { runtime, human } = harness;
    assert.ok(runtime.getHudState().reviveArmed);

    human.alive = false;
    runtime.handlePlayerDeath(human, 'ROCKET');
    assert.equal(runtime._pendingFinalReason, '', 'die Rettung darf den Lauf nicht beenden');
    assert.equal(human.alive, true, 'der Spieler steht wieder am Tor');
    assert.equal(runtime.reviveCount, 1);
    assert.equal(harness.spawnCalls.length, 1);
    assert.ok(harness.spawnCalls[0].z < 116, 'die Rettung setzt vor dem Tor ein');

    human.alive = false;
    runtime.handlePlayerDeath(human, 'ROCKET');
    assert.equal(runtime.reviveCount, 1, 'pro Tor gibt es nur eine Rettung');
    assert.equal(runtime._pendingFinalReason, 'ENDLESS_PLAYER_DEATH');
    runtime.dispose();
});

test('the revive window closes and then a death ends the run', () => {
    const harness = createHarness(556);
    enterCombat(harness);
    const { runtime, human } = harness;
    runtime.update(ENDLESS_PARCOURS_CHECKPOINT.reviveWindowSeconds + 1);
    human.alive = false;
    runtime.handlePlayerDeath(human, 'ROCKET');
    assert.equal(runtime.reviveCount, 0);
    assert.equal(runtime._pendingFinalReason, 'ENDLESS_PLAYER_DEATH');
    runtime.dispose();
});

test('streak multiplier grows in halves, is capped and pays only the surplus', () => {
    assert.equal(resolveEndlessStreakMultiplier(0), 1);
    assert.equal(resolveEndlessStreakMultiplier(1), 1);
    assert.equal(resolveEndlessStreakMultiplier(2), 1.5);
    assert.equal(resolveEndlessStreakMultiplier(5), 3);
    assert.equal(resolveEndlessStreakMultiplier(99), ENDLESS_PARCOURS_STREAK.maxMultiplier);
    assert.equal(resolveEndlessStreakBonus(250, 1), 0);
    assert.equal(resolveEndlessStreakBonus(250, 3), 250);
});

test('a kill extends the streak and a hit on the player breaks it', () => {
    const harness = createHarness(88);
    enterCombat(harness);
    const { runtime, human } = harness;
    const bot = harness.bots.find((entry) => entry.player.alive);
    assert.ok(bot, 'nach dem Intro muss ein Jaeger unterwegs sein');
    const streakBeforeKill = runtime.streak;
    bot.player.alive = false;
    runtime.handlePlayerDeath(bot.player, 'MG', { killer: human });
    assert.equal(runtime.botKills, 1);
    assert.ok(runtime.streak > streakBeforeKill, 'ein Abschuss verlaengert die Serie');
    const streakAfterKill = runtime.streak;

    human.hp = 60;
    runtime.update(1 / 60);
    assert.equal(runtime.streak, 0, 'ein Treffer beendet die Serie');
    assert.ok(streakAfterKill > 0);
    assert.ok(runtime.bestStreak >= streakAfterKill, 'die beste Serie bleibt erhalten');
    runtime.dispose();
});

test('the first tick does not count as a hit or as a pickup', () => {
    const harness = createHarness(90);
    // Ein Loadout kann Items mitbringen; das darf keine Serie erfinden.
    harness.human.inventory = ['ROCKET_WEAK'];
    enterCombat(harness);
    const { runtime } = harness;
    assert.equal(runtime.streak, 1, 'nur das Tor zaehlt, nicht der Messstart');
    assert.equal(runtime.lastStreakKind, 'checkpoint');
    runtime.dispose();
});

test('the streak decays once its window has passed', () => {
    const harness = createHarness(89);
    enterCombat(harness);
    const { runtime } = harness;
    assert.ok(runtime.streak > 0);
    runtime.update(ENDLESS_PARCOURS_STREAK.windowSeconds + 0.5);
    assert.equal(runtime.streak, 0);
    runtime.dispose();
});

test('score counts the bonus pot without changing the original formula', () => {
    assert.equal(calculateEndlessScore({
        maxProgressMeters: 123.9,
        survivalSeconds: 61.9,
        botKills: 2,
        completedModules: 3,
    }), 2348);
    assert.equal(calculateEndlessScore({
        maxProgressMeters: 123.9,
        survivalSeconds: 61.9,
        botKills: 2,
        completedModules: 3,
        bonusScore: 1000,
    }), 3348);
});

test('stage palette answers every tier and darkens toward onslaught', () => {
    const intro = resolveEndlessStagePalette(0);
    const onslaught = resolveEndlessStagePalette(4);
    assert.equal(intro.label, 'INTRO');
    assert.equal(onslaught.label, 'ONSLAUGHT');
    assert.notEqual(intro.wall, onslaught.wall, 'die Stufe muss sichtbar anders aussehen');
    assert.ok(onslaught.wallEmissiveIntensity > intro.wallEmissiveIntensity);
    assert.ok(onslaught.wallEmissiveIntensity < 2, 'ueber 2 reisst das Tone Mapping die Farbe weg');
    assert.equal(resolveEndlessStagePalette(99).label, 'ONSLAUGHT');
});

test('runtime recolours the course when the threat tier changes', () => {
    const harness = createHarness(4711);
    enterCombat(harness);
    const { runtime } = harness;
    const introWall = runtime._materials.wall.color.getHex();
    runtime.update(120);
    assert.equal(runtime._activePaletteTier, 2);
    assert.notEqual(runtime._materials.wall.color.getHex(), introWall);
    assert.ok(harness.sounds.includes('PARCOURS_TIMEOUT'), 'der Stufenwechsel meldet sich');
    runtime.dispose();
});

test('hunters are announced before they appear and the warning names a side', () => {
    const harness = createHarness(31337);
    enterCombat(harness, 0);
    const { runtime } = harness;
    const warning = runtime.getHudState().spawnWarning;
    assert.ok(warning, 'ein Einsatz muss angekuendigt werden');
    assert.ok(['left', 'right', 'ahead', 'behind'].includes(warning.side));
    assert.ok(
        harness.sounds.includes('PARCOURS_BRANCH') || harness.sounds.includes('FIGHT_LEAD'),
        'die Ankuendigung ist hoerbar'
    );
    runtime.update(1);
    assert.equal(runtime.getHudState().spawnWarning, null, 'die Warnung laeuft ab');
    runtime.dispose();
});

test('elite waves start after the promised interval and are tougher', () => {
    assert.equal(resolveEndlessEliteWaveIndex(0), 0);
    assert.equal(resolveEndlessEliteWaveIndex(5), 1);
    assert.equal(shouldSpawnEndlessElite(0, 0), false);
    assert.equal(shouldSpawnEndlessElite(5, 0), true);
    assert.equal(shouldSpawnEndlessElite(5, 1), false);
    assert.equal(resolveScenarioBotTuning({ scenarioRole: 'elite' }).aggressionBonus, 0.42);
    assert.ok(resolveScenarioBotTuning({ scenarioRole: 'elite' }).prefersRocket);
});

test('an elite hunter enters the run, carries more health and pays more on death', () => {
    const harness = createHarness(6161);
    enterCombat(harness);
    const { runtime, human } = harness;
    beginEndlessAttackWave(runtime, 5);
    runtime.update(0);
    runtime.update(1.5);
    const elite = harness.bots.find((entry) => entry.player.isEndlessElite === true);
    assert.ok(elite, 'nach der ersten Welle muss ein Anfuehrer im Lauf sein');
    assert.ok(elite.player.maxHp > 100, 'der Anfuehrer haelt mehr aus');
    assert.equal(elite.player.scenarioRole, 'elite');

    const bonusBefore = runtime.bonusScore;
    elite.player.alive = false;
    runtime.handlePlayerDeath(elite.player, 'ROCKET', { killer: human });
    assert.equal(runtime.eliteKills, 1);
    assert.ok(
        runtime.bonusScore - bonusBefore >= ENDLESS_PARCOURS_ELITE.killScore - ENDLESS_PARCOURS_STREAK.killBaseScore,
        'der Anfuehrer bringt deutlich mehr Punkte'
    );
    runtime.dispose();
});

test('sluice gates open and close on a reproducible beat', () => {
    const cycle = { periodSeconds: 4, openSeconds: 1.5, phase: 0 };
    assert.equal(isCycleColliderClosed(cycle, 0), false);
    assert.equal(isCycleColliderClosed(cycle, 1.4), false);
    assert.equal(isCycleColliderClosed(cycle, 1.6), true);
    assert.equal(isCycleColliderClosed(cycle, 3.9), true);
    assert.equal(isCycleColliderClosed(cycle, 4.1), false);
    assert.equal(
        isCycleColliderClosed(cycle, 2),
        isCycleColliderClosed({ ...cycle, phase: 2 }, 0),
        'die Phase verschiebt den Takt, sie erfindet ihn nicht neu'
    );
});

test('a switching sluice re-registers its collider batch instead of standing still', () => {
    const harness = createHarness(20250909);
    enterCombat(harness);
    const { runtime } = harness;
    // Weit genug fahren, damit Taktschleusen im Katalog erreichbar sind.
    for (let step = 2; step < 40; step += 1) {
        harness.human.position.z = step * 120 + 5;
        runtime.update(1.1);
    }
    const cycleCount = runtime.getDebugSnapshot().cycleColliders;
    if (cycleCount === 0) {
        runtime.dispose();
        return;
    }
    const writesBefore = harness.batchWrites.length;
    for (let step = 0; step < 12; step += 1) runtime.update(0.4);
    assert.ok(
        harness.batchWrites.length > writesBefore,
        'ein Taktwechsel muss die Kollision neu anmelden, sonst bleibt die Sperre wirkungslos'
    );
    runtime.dispose();
});

test('shaking off a pursuer is rewarded instead of silently dropping it', () => {
    const harness = createHarness(9090);
    enterCombat(harness);
    const { runtime } = harness;
    const bonusBefore = runtime.bonusScore;
    const activeBefore = harness.bots.filter((entry) => entry.player.alive).length;
    assert.ok(activeBefore > 0);
    // Der Spieler zieht so weit vor, dass die Bausteine mit den Jaegern entladen werden.
    for (let step = 2; step < 8; step += 1) {
        harness.human.position.z = step * 120 + 10;
        runtime.update(0.2);
    }
    assert.ok(runtime.shakeoffs > 0, 'abgehaengte Verfolger muessen gezaehlt werden');
    assert.ok(runtime.bonusScore >= bonusBefore + ENDLESS_PARCOURS_SHAKEOFF_SCORE);
    assert.ok(harness.feedback.some((line) => line.includes('abgeschuettelt')));
    runtime.dispose();
});

test('falling behind warns before it kills', () => {
    const near = resolveEndlessVoidWarning(1000 - 200, 1000);
    assert.equal(near.warning, true);
    assert.ok(near.remainingMeters > 0);
    assert.equal(resolveEndlessVoidWarning(1000, 1000).warning, false);
    assert.ok(resolveEndlessVoidWarning(1000 - 271, 1000).remainingMeters <= 0);
});

test('the runtime surfaces the void warning and only then ends the run', () => {
    const harness = createHarness(4321);
    enterCombat(harness);
    const { runtime, human } = harness;
    human.position.z = 700;
    runtime.update(1 / 60);
    human.position.z = 700 - 200;
    runtime.update(1 / 60);
    const warned = runtime.getHudState().voidWarning;
    assert.equal(warned.active, true);
    assert.ok(warned.remainingMeters > 0);
    assert.equal(runtime._finalized, false, 'die Warnung allein beendet den Lauf nicht');
    assert.ok(harness.sounds.includes('PARCOURS_WRONG'));

    human.position.z = 700 - 280;
    runtime.update(1 / 60);
    assert.equal(runtime._finalized, true);
    assert.equal(harness.roundEndRequests.at(-1).reason, 'ENDLESS_VOID');
    runtime.dispose();
});

test('speed grows finer and further than the old four-module steps', () => {
    assert.equal(resolveEndlessSpeedMultiplier(0), 1);
    assert.equal(Number(resolveEndlessSpeedMultiplier(1).toFixed(2)), 1.02);
    assert.equal(Number(resolveEndlessSpeedMultiplier(10).toFixed(2)), 1.2);
    assert.equal(Number(resolveEndlessSpeedMultiplier(500).toFixed(2)), 1.6);
});

test('records keep a top list, unlock milestones and migrate the old format', () => {
    const legacy = normalizeEndlessParcoursRecords({
        schemaVersion: ENDLESS_PARCOURS_RECORDS_LEGACY_SCHEMA_VERSION,
        best: { score: 12000, distanceMeters: 1200, survivalSeconds: 310, botKills: 11 },
        last: { score: 900 },
    });
    assert.equal(legacy.schemaVersion, ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION);
    assert.equal(legacy.best.score, 12000, 'ein alter Rekord darf nicht verloren gehen');
    assert.equal(legacy.top.length, 1);
    assert.ok(legacy.milestones.includes('distance-1000'));
    assert.ok(legacy.milestones.includes('survival-300'));
    assert.ok(legacy.milestones.includes('kills-10'));

    let records = legacy;
    for (let run = 0; run < ENDLESS_PARCOURS_TOP_RUNS + 3; run += 1) {
        records = updateEndlessParcoursRecords(records, {
            score: 1000 + run * 100,
            distanceMeters: 300,
            survivalSeconds: 40,
            botKills: 1,
        }, '2026-09-09T10:00:00.000Z').records;
    }
    assert.equal(records.top.length, ENDLESS_PARCOURS_TOP_RUNS);
    assert.ok(records.top[0].score >= records.top[1].score, 'die Top-Liste ist sortiert');
    assert.equal(records.best.score, 12000, 'der Bestwert bleibt der beste Lauf');

    const eliteRun = updateEndlessParcoursRecords(records, {
        score: 60000,
        distanceMeters: 5200,
        survivalSeconds: 620,
        botKills: 30,
        eliteKills: 2,
        bestStreak: 6,
    }, '2026-09-09T11:00:00.000Z');
    assert.equal(eliteRun.isNewRecord, true);
    assert.ok(eliteRun.newMilestones.includes('elite-1'));
    assert.ok(eliteRun.newMilestones.includes('streak-5'));
    assert.ok(eliteRun.newMilestones.includes('score-50000'));
    assert.equal(
        eliteRun.newMilestones.includes('distance-1000'),
        false,
        'ein schon freigeschalteter Meilenstein zaehlt nicht doppelt'
    );
});

test('the menu summary makes the stored progress visible', () => {
    assert.match(summarizeEndlessRecordsLine(null), /noch kein Lauf/);
    const records = updateEndlessParcoursRecords(null, {
        score: 7400,
        distanceMeters: 1450,
        survivalSeconds: 320,
        botKills: 12,
    }, '2026-09-09T10:00:00.000Z').records;
    const line = summarizeEndlessRecordsLine(records);
    assert.match(line, /Bestwert 7400 Punkte/);
    assert.match(line, /weiteste Strecke 1450 m/);
    assert.match(line, /Top 1: 7400/);
    assert.match(line, /Meilensteine 3\//);
    assert.equal(resolveEndlessMilestoneLabel('distance-1000'), '1000 m überlebt');
    assert.equal(resolveEndlessMilestoneLabel('does-not-exist'), '');
});

test('the state layer still re-exports the record helpers it used to own', () => {
    assert.equal(typeof stateRecords.normalizeEndlessParcoursRecords, 'function');
    assert.equal(typeof stateRecords.updateEndlessParcoursRecords, 'function');
    assert.equal(
        stateRecords.ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION,
        ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION
    );
});

test('milestones read every metric the summary reports', () => {
    assert.deepEqual(resolveEndlessMilestones({}), []);
    assert.deepEqual(
        resolveEndlessMilestones({ distanceMeters: 1000 }),
        ['distance-1000']
    );
    assert.ok(resolveEndlessMilestones({ survivalSeconds: 600 }).includes('survival-600'));
});

test('the record marker is placed into the loaded stretch after the store arrives', () => {
    const harness = createHarness(6789);
    const { runtime } = harness;
    assert.equal(runtime.getDebugSnapshot().recordMarkers, 0);
    runtime.setRecordStore({
        loadJsonRecord: () => ({
            schemaVersion: ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION,
            best: { score: 9000, distanceMeters: 250 },
            bestDistance: { score: 4000, distanceMeters: 550 },
            last: {},
            top: [],
            milestones: [],
        }),
        saveJsonRecord: () => true,
    });
    assert.equal(runtime.getDebugSnapshot().recordMarkers, 1, 'der Rekord muss in der Strecke stehen');
    assert.equal(runtime.getHudState().recordDistanceMeters, 550);
    assert.equal(
        [...runtime.activeModules.entries()].find(([, instance]) => instance.recordMarker)?.[0],
        4,
        'the marker follows the distance record rather than the highest score'
    );
    runtime.dispose();
});

test('the run summary reports every new liveliness metric', () => {
    const harness = createHarness(2468);
    enterCombat(harness);
    const { runtime } = harness;
    const summary = runtime.finalize('ENDLESS_PLAYER_DEATH', { persist: false });
    assert.equal(summary.runType, 'endless_parcours');
    for (const key of [
        'eliteKills', 'bonusScore', 'bestStreak', 'checkpointsPassed', 'shakeoffs', 'revives',
    ]) {
        assert.ok(key in summary, `${key} fehlt in der Laufauswertung`);
    }
    assert.equal(summary.checkpointsPassed, 1);
    runtime.dispose();
});

test('streaming stays bounded even with bends, gates and markers in play', () => {
    const harness = createHarness(13579);
    const { runtime } = harness;
    enterCombat(harness);
    for (let moduleIndex = 2; moduleIndex < 60; moduleIndex += 1) {
        harness.human.position.z = moduleIndex * 120 + 1;
        runtime.update(1 / 60);
        const snapshot = runtime.getDebugSnapshot();
        assert.ok(snapshot.activeModules <= 7, `zu viele Bausteine: ${snapshot.activeModules}`);
        assert.ok(snapshot.colliderBatches <= 7);
        assert.ok(snapshot.pickups <= 14, `zu viele Items: ${snapshot.pickups}`);
        assert.ok(harness.sceneObjects.size <= 7);
    }
    runtime.dispose();
    assert.equal(harness.batches.size, 0);
    assert.equal(harness.sceneObjects.size, 0);
});
