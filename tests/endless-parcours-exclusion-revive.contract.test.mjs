import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { tryEndlessRevive } from '../src/entities/endless/EndlessParcoursRunOps.js';
import { ExclusionZoneSystem, resolveExclusionZoneRocketTuning } from '../src/entities/systems/ExclusionZoneSystem.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { resolveEndlessTubeRadius } from '../src/entities/endless/EndlessParcoursTube.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { ENDLESS_PARCOURS_RULE_VERSION } from '../src/shared/contracts/EndlessParcoursWaveContract.js';
import { createArcadeRankContext } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { ARCADE_RANKED_VERSION, insertArcadeRankedResult, normalizeArcadeRankedLeaderboard,
    resolveArcadeRankKey } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
import { updateEndlessParcoursRecords, summarizeEndlessRecordsLine } from '../src/shared/contracts/EndlessParcoursRecordsContract.js';

function harness(previousSource = null) {
    const human = {
        index: 0, alive: true, isBot: false, hp: 100, shieldHP: 0,
        baseSpeed: 45, hitboxRadius: 1, spawnProtectionTimer: 0,
        position: new THREE.Vector3(0, 8, 10), inventory: [],
        getDirection(out) { return out.set(0, 0, 1); }, setControlOptions() {},
    };
    const launches = [], trims = [], spawnCalls = [];
    const arena = {
        openFaces: [], exclusionZoneSource: previousSource,
        enterStaticStreamingMode() {}, exitStaticStreamingMode() {},
        registerStaticColliderBatch() {}, unregisterStaticColliderBatch() {},
        checkWorldGeometryCollision() { return false; },
    };
    const projectiles = {
        clearInBounds() {},
        spawnExternalProjectile(options) {
            const projectile = { ...options, position: options.position.clone(), direction: options.direction.clone() };
            launches.push(projectile); return projectile;
        },
        trimZoneProjectiles(...limits) { trims.push(limits); },
    };
    const manager = {
        arena, humanPlayers: [human], players: [human], bots: [],
        entityRuntimeConfig: DEFAULT_ENTITY_RUNTIME_CONFIG,
        _projectileSystem: projectiles, _lockOnCache: new Map(),
        _spawnOps: { spawnPlayerAt(player, position, direction) {
            spawnCalls.push({ position: position.clone(), direction: direction.clone() });
            player.position.copy(position); player.alive = true;
        } },
    };
    const runtime = new EndlessParcoursRuntime({ baseSeed: 4242, arena, entityManager: manager,
        wallClockIso: () => '2026-10-17T00:00:00.000Z' });
    const system = new ExclusionZoneSystem(manager, { projectileSystem: projectiles });
    return { human, arena, launches, trims, spawnCalls, manager, runtime, system };
}

test('Endlos source follows the actual tube interior volumes across bends and seams', () => {
    const { runtime, human, arena } = harness();
    runtime._syncModules(7, 5);
    for (const { module } of runtime.activeModules.values()) {
        for (const t of [0.001, 0.25, 0.5, 0.999]) {
            const frame = runtime.getCoursePoint(module.moduleIndex, 0, 0, module.length * t);
            const radius = resolveEndlessTubeRadius(runtime.baseSeed, module.moduleIndex, t);
            const center = { ...frame.position }, right = { ...frame.right }, up = { ...frame.up };
            for (const direction of [right, up]) {
                for (const distance of [0, radius - 2, -radius + 2, radius + 3, -radius - 3]) {
                    human.position.set(center.x + direction.x * distance, center.y + direction.y * distance, center.z + direction.z * distance);
                    const inside = [...runtime.activeModules.values()].some(instance =>
                        sphereIntersectsStaticMeshCollider(instance.volumeCollider, human.position, human.hitboxRadius));
                    assert.equal(arena.exclusionZoneSource.isOutside(human), !inside);
                    if (Math.abs(distance) < radius - 1) assert.equal(inside, true);
                }
            }
        }
    }
    runtime.dispose();
});

test('Endlos starts salvos at exactly three seconds and keeps escalation intervals', () => {
    const h = harness();
    h.human.position.x = 100;
    h.system.update(2.999);
    assert.equal(h.human.exclusionZoneState.phase, 'GRACE');
    assert.equal(h.human.exclusionZoneState.countdownSeconds, 1);
    assert.equal(h.launches.length, 0);
    h.system.update(0.001);
    assert.equal(h.human.exclusionZoneState.phase, 'SALVO');
    assert.equal(h.human.exclusionZoneState.stage, 'WEAK');
    assert.equal(h.launches.length, 4);
    h.system.update(10);
    assert.equal(h.human.exclusionZoneState.stage, 'MEDIUM');
    assert.equal(h.launches.at(-1).type, 'ROCKET_MEDIUM');
    h.system.update(10);
    assert.equal(h.human.exclusionZoneState.stage, 'HEAVY');
    assert.equal(h.launches.at(-1).type, 'ROCKET_HEAVY');
    assert.equal(h.launches.filter((p) => p.type === 'ROCKET_WEAK').length, 16);
    assert.equal(h.launches.filter((p) => p.type === 'ROCKET_MEDIUM').length, 30);
    assert.equal(h.launches.filter((p) => p.type === 'ROCKET_HEAVY').length, 8);
    assert.ok(h.trims.every(([, perPlayer, global]) => perPlayer <= global && global === 64));
    assert.ok(h.launches.every((p) => p.target === h.human && p.targetReacquireDisabled
        && p.environmentProjectile && p.zoneProjectile));
    h.runtime.dispose();
});

test('all exterior directions use grace instead of immediate death; returning resets with hysteresis', () => {
    const h = harness();
    for (const position of [[100, 8, 10], [-100, 8, 10], [0, 40, 10], [0, -30, 10]]) {
        h.human.position.set(...position);
        h.runtime.update(0.01);
        assert.equal(h.human.alive, true);
        assert.equal(h.runtime._finalized, false);
        h.system.update(0.01);
        assert.equal(h.human.exclusionZoneState.phase, 'GRACE');
        h.human.position.set(0, 8, 10); h.system.update(0);
        assert.equal(h.human.exclusionZoneState.phase, 'SAFE');
    }
    const frame = h.runtime.getCoursePoint(0, 0, 0, 60);
    const center = { ...frame.position }, right = { ...frame.right };
    const radius = resolveEndlessTubeRadius(h.runtime.baseSeed, 0, 0.5);
    const place = distance => h.human.position.set(center.x + right.x * distance, center.y + right.y * distance, center.z + right.z * distance);
    place(radius + 1.1); h.system.update(3);
    assert.equal(h.human.exclusionZoneState.phase, 'SALVO');
    place(radius + 0.9); h.system.update(0);
    assert.equal(h.human.exclusionZoneState.phase, 'SALVO', 'partial edge return remains in hysteresis');
    place(radius + 0.5); h.system.update(0);
    assert.equal(h.human.exclusionZoneState.phase, 'SAFE');
    h.human.position.x = 100; h.system.update(2.99);
    assert.equal(h.human.exclusionZoneState.phase, 'GRACE', 'fresh full grace after return');
    h.runtime.dispose();
});

test('source keeps bot, ghost, protection, replica and finite-position guards', () => {
    const h = harness();
    for (const property of ['isBot', 'isGhost', 'spawnProtectionTimer']) {
        h.human.position.x = 100; h.human[property] = property === 'spawnProtectionTimer' ? 10 : true;
        h.system.update(30);
        assert.equal(h.human.exclusionZoneState.phase, 'SAFE');
        h.human[property] = property === 'spawnProtectionTimer' ? 0 : false;
    }
    h.system.setNetworkReplica(true); h.system.update(30);
    assert.equal(h.launches.length, 0);
    h.system.setNetworkReplica(false);
    h.human.position.set(0, 8, 10); h.system.update(0);
    h.human.position.x = NaN; h.system.update(30);
    assert.equal(h.human.position.x, 0);
    assert.equal(h.human.exclusionZoneState.phase, 'SAFE');
    h.runtime.dispose();
});

test('salvos use current Endlos speed, including later upgrades, without changing ordinary tuning', () => {
    const h = harness();
    const baseline = resolveExclusionZoneRocketTuning(h.manager.entityRuntimeConfig);
    h.human.position.x = 100; h.human.baseSpeed = 72;
    h.system.update(3);
    const fast = resolveExclusionZoneRocketTuning(h.manager.entityRuntimeConfig, 72);
    assert.equal(h.launches[0].speedMultiplier, fast.stages.WEAK.speedMultiplier);
    assert.ok(fast.stages.WEAK.rocketSpeed > 72);
    assert.ok(fast.stages.WEAK.rocketSpeed > baseline.stages.WEAK.rocketSpeed);
    h.human.baseSpeed = 90;
    h.system.update(3);
    assert.equal(h.launches.at(-1).speedMultiplier,
        resolveExclusionZoneRocketTuning(h.manager.entityRuntimeConfig, 90).stages.WEAK.speedMultiplier);
    assert.deepEqual(resolveExclusionZoneRocketTuning(h.manager.entityRuntimeConfig), baseline);
    h.runtime.dispose();
});

test('runtime restores only its own source on dispose and ended runs stop publishing danger', () => {
    const previous = { isOutside() { return false; } };
    const h = harness(previous), source = h.arena.exclusionZoneSource;
    h.human.position.x = 100;
    assert.equal(source.isOutside(h.human), true);
    h.runtime.finalize('ENDLESS_ABORT', { persist: false, requestRoundEnd: false });
    assert.equal(source.isOutside(h.human), false);
    h.runtime.dispose();
    assert.equal(h.arena.exclusionZoneSource, previous);
    const newer = harness(previous), foreign = { isOutside() { return true; } };
    newer.arena.exclusionZoneSource = foreign;
    newer.runtime.dispose();
    assert.equal(newer.arena.exclusionZoneSource, foreign, 'later ownership is preserved');
});

function passGate(h, index) {
    h.human.alive = true;
    h.human.position.copy(h.runtime.getCoursePoint(index, 0, 8, 116).position);
    h.runtime.update(0);
}

test('runtime scores arc length, rejects exterior gate shortcuts and respawns along the curve', () => {
    const h = harness(), metric = h.runtime.getPathMetric();
    const index = 8;
    const point = h.runtime.getCoursePoint(index, 0, 0, 110);
    h.human.position.copy(point.position);
    h.runtime.update(0);
    const station = metric.getStationAtProgress(index, 110 / 120);
    assert.ok(station > h.human.position.z + 0.1, 'bends add actual distance');
    assert.ok(Math.abs(h.runtime.maxProgressMeters - station) < 1e-5);
    assert.equal(h.runtime.currentModuleIndex, index);
    assert.equal(h.runtime.lastCheckpointIndex, index - 1);
    h.human.position.copy(h.runtime.getCoursePoint(index, 100, 0, 118).position);
    h.runtime.update(0);
    assert.equal(h.runtime.lastCheckpointIndex, index - 1, 'outside traversal grants no gate');
    assert.ok(Math.abs(h.runtime.maxProgressMeters - station) < 1e-5);
    passGate(h, index);
    assert.equal(h.runtime.lastCheckpointIndex, index);
    h.human.alive = false;
    h.runtime.handlePlayerDeath(h.human, 'PROJECTILE');
    const gateS = metric.getStationAtProgress(index, 116 / 120);
    const expected = metric.sampleAtS(gateS - 14);
    const spawn = h.spawnCalls.at(-1);
    assert.ok(spawn.position.distanceTo(expected.position) < 1e-6);
    assert.ok(spawn.direction.distanceTo(expected.tangent) < 1e-6);
    assert.ok(Math.abs(spawn.direction.x) + Math.abs(spawn.direction.y) > 0.001);
    assert.equal(h.arena.exclusionZoneSource.isOutside(h.human), false);
    h.runtime.dispose();
});

test('three successful gate rescues exhaust the run budget; a fourth death ends it', () => {
    const h = harness();
    for (let index = 0; index < 3; index++) {
        passGate(h, index);
        assert.equal(h.runtime.getHudState().reviveArmed, true);
        h.human.alive = false;
        h.runtime.handlePlayerDeath(h.human, 'PROJECTILE');
        assert.equal(h.human.alive, true);
        assert.equal(h.runtime.reviveCount, index + 1);
        assert.equal(h.runtime._pendingFinalReason, '');
    }
    passGate(h, 3);
    assert.equal(h.runtime.getHudState().reviveArmed, false, 'a fresh gate cannot refill rescues');
    h.human.alive = false;
    h.runtime.handlePlayerDeath(h.human, 'PROJECTILE');
    const summary = h.runtime.update(0);
    assert.equal(h.human.alive, false);
    assert.equal(h.spawnCalls.length, 3);
    assert.equal(h.runtime.reviveCount, 3);
    assert.equal(summary.reason, 'ENDLESS_PLAYER_DEATH');
    assert.equal(h.runtime._finalized, true);
    h.runtime.dispose();
    const fresh = harness();
    assert.equal(fresh.runtime.reviveCount, 0);
    fresh.runtime.dispose();
});

test('failed, missing and expired spawns cannot consume the rescue budget', () => {
    const h = harness();
    passGate(h, 0); h.human.alive = false;
    const original = h.manager._spawnOps;
    h.manager._spawnOps = { spawnPlayerAt() { return false; } };
    assert.equal(tryEndlessRevive(h.runtime, h.human), false);
    assert.equal(h.runtime.reviveCount, 0);
    h.manager._spawnOps = null;
    assert.equal(tryEndlessRevive(h.runtime, h.human), false);
    assert.equal(h.runtime.reviveCount, 0);
    h.manager._spawnOps = original;
    assert.equal(tryEndlessRevive(h.runtime, h.human), true);
    assert.equal(h.runtime.reviveCount, 1);
    passGate(h, 1); h.human.alive = false;
    h.runtime.elapsedCombatSeconds = h.runtime.reviveArmedUntilSeconds;
    assert.equal(tryEndlessRevive(h.runtime, h.human), false);
    assert.equal(h.runtime.reviveCount, 1);
    h.runtime.dispose();
});

test('P1 personal records and active HUD stay separate from v2 while all-time history survives', () => {
    const old = updateEndlessParcoursRecords(null, {
        score: 9000, distanceMeters: 4000, runId: 'legacy', ruleVersion: 'endless-parcours-rules.v2',
    }).records;
    assert.notEqual(ENDLESS_PARCOURS_RULE_VERSION, 'endless-parcours-rules.v2');
    const update = updateEndlessParcoursRecords(old, {
        score: 100, distanceMeters: 120, runId: 'p1', ruleVersion: ENDLESS_PARCOURS_RULE_VERSION,
    });
    assert.equal(update.isNewRecord, true);
    assert.equal(update.records.best.score, 9000, 'all-time maximum remains preserved');
    assert.equal(update.records.bestByRuleVersion['endless-parcours-rules.v2'].score, 9000);
    assert.equal(update.records.bestByRuleVersion[ENDLESS_PARCOURS_RULE_VERSION].score, 100);
    assert.deepEqual(update.records.topByRuleVersion['endless-parcours-rules.v2'], old.topByRuleVersion['endless-parcours-rules.v2']);
    assert.match(summarizeEndlessRecordsLine(update.records), /alle Regelstände.*9000/);
    const h = harness();
    h.runtime._records = old;
    assert.equal(h.runtime.getHudState().recordScore, 0);
    h.runtime._records = update.records;
    assert.equal(h.runtime.getHudState().recordScore, 100);
    assert.equal(h.runtime.getHudState().recordDistanceMeters, 120, 'distance marker uses the same station rules as the active run');
    const summary = h.runtime.finalize('ENDLESS_ABORT', { persist: false, requestRoundEnd: false });
    assert.equal(summary.ruleVersion, ENDLESS_PARCOURS_RULE_VERSION);
    h.runtime.dispose();
});

test('ranked keys and rows require the current Endlos rule while preserving unversioned boards', () => {
    const context = createArcadeRankContext({ runId: 'p1', runType: 'endless_parcours', vehicleId: 'ship5',
        profile: { level: 1 }, runSettings: normalizeArcadeRunSettings({ runType: 'endless_parcours' }) });
    assert.equal(context.endlessRuleVersion, ENDLESS_PARCOURS_RULE_VERSION);
    const { min, max } = context.levelRange;
    const oldKey = `endless_parcours:${context.scoreModel}:normal:${min}-${max}`;
    const oldRow = { runId: 'legacy', score: 9000, vehicleLevel: 1, scoreModel: context.scoreModel };
    const previous = { schemaVersion: ARCADE_RANKED_VERSION, boards: { [oldKey]: [oldRow] } };
    const ranked = insertArcadeRankedResult(previous, context, { score: 100 }, 0);
    assert.equal(ranked.key, `endless_parcours:${context.scoreModel}:${ENDLESS_PARCOURS_RULE_VERSION}:normal:${min}-${max}`);
    assert.equal(ranked.rank, 1);
    assert.deepEqual(ranked.leaderboard.boards[oldKey], [oldRow]);
    assert.equal(ranked.leaderboard.boards[ranked.key][0].endlessRuleVersion, ENDLESS_PARCOURS_RULE_VERSION);
    for (const version of [undefined, '', 'endless-parcours-rules.v2', 'endless-parcours-rules.v99']) {
        const invalid = { ...context, endlessRuleVersion: version };
        assert.equal(resolveArcadeRankKey(invalid), '');
        assert.deepEqual(insertArcadeRankedResult(previous, invalid, { score: 100 }, 0).leaderboard, normalizeArcadeRankedLeaderboard(previous));
    }
    const currentRow = ranked.leaderboard.boards[ranked.key][0];
    const normalized = normalizeArcadeRankedLeaderboard({ schemaVersion: ARCADE_RANKED_VERSION, boards: {
        [oldKey]: [oldRow], [ranked.key]: [oldRow, { ...currentRow, endlessRuleVersion: 'endless-parcours-rules.v2' }, currentRow],
    } });
    assert.deepEqual(normalized.boards[oldKey], [oldRow]);
    assert.deepEqual(normalized.boards[ranked.key], [currentRow]);
});
