import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';
import { MGTracerFx } from '../src/hunt/mg/MGTracerFx.js';
import { resolveHuntLineTarget, isTrailTargetDescriptor } from '../src/hunt/HuntTargetingOps.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import {
    FIGHT_MACHINE_GUN_MODELS,
    normalizeFightMachineGunId,
    resolveFightMachineGunConfig,
} from '../src/shared/contracts/FightMachineGunContract.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { GAMEPLAY_ACTION_RESULT_CODES } from '../src/shared/contracts/GameplayActionResultContract.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import {
    areHangarBuildsEqual,
    createDefaultHangarBuild,
    normalizeHangarBuild,
} from '../src/ui/hangar/HangarBuildDraftState.js';

test('Fight hangar offers four safe machine-gun sidegrades and persists the selection', () => {
    assert.equal(FIGHT_MACHINE_GUN_MODELS.length, 4);
    assert.equal(normalizeFightMachineGunId('unknown'), 'vector_m7');

    const base = createDefaultHangarBuild('ship5', { mode: 'fight', nowMs: 1 });
    const rapid = normalizeHangarBuild({ ...base, machineGunId: 'raptor_r9' });
    assert.equal(rapid.machineGunId, 'raptor_r9');
    assert.equal(areHangarBuildsEqual(base, rapid), false);
});

test('Fight machine-gun models change combat values without mutating the base config', () => {
    const base = { COOLDOWN: 0.1, DAMAGE: 10, RANGE: 100, OVERHEAT_PER_SHOT: 8, MIN_FALLOFF: 0.5 };
    const rapid = resolveFightMachineGunConfig(base, 'raptor_r9');
    const heavy = resolveFightMachineGunConfig(base, 'bastion_h3');
    const precision = resolveFightMachineGunConfig(base, 'lance_p4');

    assert.deepEqual(base, { COOLDOWN: 0.1, DAMAGE: 10, RANGE: 100, OVERHEAT_PER_SHOT: 8, MIN_FALLOFF: 0.5 });
    assert.equal(rapid.COOLDOWN, 0.07);
    assert.equal(rapid.DAMAGE, 7.5);
    assert.equal(heavy.DAMAGE, 15.5);
    assert.equal(precision.RANGE, 145);
    assert.equal(precision.MIN_FALLOFF, 0.8);
});

test('Fight machine-gun models resolve distinct pooled shot-animation profiles', () => {
    const base = {
        COOLDOWN: 0.1,
        DAMAGE: 10,
        RANGE: 100,
        OVERHEAT_PER_SHOT: 8,
        MIN_FALLOFF: 0.5,
        TRACER_BEAM_RADIUS: 0.16,
        TRACER_BULLET_RADIUS: 0.42,
    };
    const profiles = FIGHT_MACHINE_GUN_MODELS.map((model) => resolveFightMachineGunConfig(base, model.id));

    assert.deepEqual(profiles.map((profile) => profile.TRACER_STYLE), [
        'bolt',
        'pulse-train',
        'heavy-slug',
        'precision-needle',
    ]);
    assert.equal(new Set(profiles.map((profile) => [
        profile.TRACER_STYLE,
        profile.TRACER_BEAM_RADIUS,
        profile.TRACER_BULLET_RADIUS,
        profile.TRACER_DURATION_SECONDS,
        profile.TRACER_SEGMENT_COUNT,
    ].join(':'))).size, FIGHT_MACHINE_GUN_MODELS.length);
    assert.equal(profiles[1].TRACER_SEGMENT_COUNT, 3);
    assert.ok(profiles[2].TRACER_BEAM_RADIUS > profiles[0].TRACER_BEAM_RADIUS);
    assert.ok(profiles[3].TRACER_BEAM_RADIUS < profiles[0].TRACER_BEAM_RADIUS);
});

test('MG shot animations reuse their scene objects and preserve weapon colours on hits', () => {
    const added = [];
    const removed = [];
    const tracerFx = new MGTracerFx({
        renderer: {
            addToScene: (mesh) => added.push(mesh),
            removeFromScene: (mesh) => removed.push(mesh),
        },
    });
    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(0, 0, -20);
    const base = {
        TRACER_BEAM_RADIUS: 0.16,
        TRACER_BULLET_RADIUS: 0.42,
    };
    const rapid = resolveFightMachineGunConfig(base, 'raptor_r9');

    tracerFx.spawnTracer(start, end, true, rapid);
    const firstEntry = tracerFx.tracers[0];
    assert.equal(firstEntry.style, 'pulse-train');
    assert.equal(firstEntry.beamSegments.filter((segment) => segment.visible).length, 3);
    assert.equal(firstEntry.beamMaterial.color.getHex(), rapid.TRACER_COLOR);
    assert.notEqual(firstEntry.impactMaterial.color.getHex(), 0xffe38a);

    tracerFx.update(1);
    assert.equal(tracerFx.tracers.length, 0);
    assert.deepEqual(removed, [firstEntry.mesh]);

    tracerFx.spawnTracer(start, end, false, resolveFightMachineGunConfig(base, 'bastion_h3'));
    assert.equal(tracerFx.tracers[0], firstEntry);
    assert.equal(tracerFx.tracers[0].style, 'heavy-slug');
    assert.equal(added.length, 2);
});

test('Match setup carries the selected model only into Fight loadouts', () => {
    const settings = {
        vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship5' },
        localSettings: {
            modePath: 'fight',
            fightHangar: {
                activeBonusesByVehicle: {
                    ship5: { speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: 0, machineGunId: 'bastion_h3' },
                },
            },
        },
    };
    assert.equal(createRuntimeConfigSnapshot(settings).player.fightLoadouts.PLAYER_1.machineGunId, 'bastion_h3');
    settings.localSettings.modePath = 'normal';
    assert.equal(createRuntimeConfigSnapshot(settings).player.fightLoadouts, null);
});

test('Combat firing resolves the selected machine-gun model per player', () => {
    const entityRuntimeConfig = {
        ...DEFAULT_ENTITY_RUNTIME_CONFIG,
        HUNT: {
            ...DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT,
            MG: { COOLDOWN: 0.1, DAMAGE: 10, RANGE: 100, OVERHEAT_PER_SHOT: 8, MIN_FALLOFF: 0.5 },
        },
    };
    const entityManager = {
        entityRuntimeConfig,
        players: [],
        gameModeStrategy: { hasMachineGun: () => true },
    };
    const system = new OverheatGunSystem(entityManager, { players: [], services: { entityRuntimeConfig } });
    let firedConfig = null;
    system._hitResolver = {
        resolveHit(_player, mg, muzzle, aim) {
            firedConfig = mg;
            muzzle.set(0, 0, 0);
            aim.set(0, 0, -1);
            return { target: null, trail: null, point: null };
        },
    };
    system._tracerFx = { spawnTracer() {}, update() {}, clear() {} };
    const player = { alive: true, index: 0, shootCooldown: 0, fightLoadout: { machineGunId: 'raptor_r9' } };

    const result = system.tryFire(player);

    assert.equal(result.ok, true);
    assert.equal(result.machineGunId, 'raptor_r9');
    assert.equal(player.shootCooldown, 0.07);
    assert.equal(firedConfig.DAMAGE, 7.5);
    assert.equal(system.getOverheatValue(0), 10);

    player.shootCooldown = 0;
    system._lockoutByPlayer[0] = 0.5;
    const overheated = system.tryFire(player);
    assert.equal(overheated.ok, false);
    assert.equal(overheated.code, GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_OVERHEATED);
    assert.equal(player.shootCooldown, 0);
    assert.equal(system.getOverheatValue(0), 10);
});

test('Bot MG aim assist stays inside the configured targeting cone', () => {
    const player = {
        alive: true,
        isBot: true,
        index: 1,
        position: new THREE.Vector3(),
        getAimDirection: (out) => out.set(0, 0, -1),
    };
    const target = {
        alive: true,
        index: 2,
        position: new THREE.Vector3(5, 0, -30),
        hitboxRadius: 0.8,
    };
    const resolver = new MGHitResolver({ players: [player, target] });
    const mg = { RANGE: 95, AIM_DOT_MIN: 0.965 };

    assert.equal(resolver.resolveHit(player, mg).target?.playerIndex, target.index);

    target.position.set(10, 0, -30);
    assert.equal(resolver.resolveHit(player, mg).target, null);

    player.isBot = false;
    mg.HUMAN_AIM_ASSIST_ENABLED = false;
    target.position.set(5, 0, -30);
    assert.equal(resolver.resolveHit(player, mg).target, null);
});

test('Human Fight MG aim assist acquires, holds, and releases targets without steering the player', () => {
    const player = {
        alive: true,
        isBot: false,
        index: 0,
        position: new THREE.Vector3(),
        fightAimAssistTargetIndex: -1,
        fightAimAssistLockRemaining: 0,
        getAimDirection: (out) => out.set(0, 0, -1),
    };
    const target = {
        alive: true,
        index: 1,
        position: new THREE.Vector3(3.5, 0, -30),
        hitboxRadius: 0.8,
    };
    const resolver = new MGHitResolver({ players: [player, target] });
    const mg = {
        RANGE: 95,
        HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG: 7,
        HUMAN_AIM_ASSIST_RELEASE_ANGLE_DEG: 10,
        HUMAN_AIM_ASSIST_LOCK_SECONDS: 0.25,
    };

    assert.equal(resolver.resolveHit(player, mg).target?.playerIndex, target.index);
    assert.equal(player.fightAimAssistTargetIndex, target.index);
    assert.equal(player.fightAimAssistLockRemaining, 0.25);

    target.position.set(5.2, 0, -30);
    assert.equal(resolver.resolveHit(player, mg).target?.playerIndex, target.index);

    target.position.set(5.4, 0, -30);
    assert.equal(resolver.resolveHit(player, mg).target, null);
    assert.equal(player.fightAimAssistTargetIndex, -1);
});

test('Default MG targeting acquires wider targets and keeps HUD and firing aligned for every model', () => {
    assert.equal(HUNT_CONFIG.MG.RANGE, 152);
    assert.equal(HUNT_CONFIG.MG.HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG, 19.2);
    assert.equal(HUNT_CONFIG.MG.HUMAN_AIM_ASSIST_RELEASE_ANGLE_DEG, 28.8);

    for (const model of FIGHT_MACHINE_GUN_MODELS) {
        const player = {
            alive: true, isBot: false, index: 0,
            position: new THREE.Vector3(),
            fightLoadout: { machineGunId: model.id },
            getAimDirection: (out) => out.set(0, 0, -1),
        };
        const target = { alive: true, index: 1, position: new THREE.Vector3(), hitboxRadius: 0.8 };
        const runtime = {
            players: [player, target],
            entityRuntimeConfig: { ...DEFAULT_ENTITY_RUNTIME_CONFIG, HUNT: HUNT_CONFIG },
            cache: { lockOn: new Map() },
            callbacks: { getStrategy: () => ({ hasMachineGun: () => true }) },
        };
        const resolver = new MGHitResolver(runtime);
        const combat = new HuntCombatSystem(runtime);
        const mg = resolveFightMachineGunConfig(HUNT_CONFIG.MG, model.id);
        const check = (angle, distance, expected) => {
            const radians = angle * Math.PI / 180;
            target.position.set(Math.sin(radians) * distance, 0, -Math.cos(radians) * distance);
            runtime.cache.lockOn.clear();
            assert.equal(combat.checkLockOn(player)?.playerIndex ?? null, expected, `${model.id} HUD at ${angle} degrees`);
            assert.equal(resolver.resolveHit(player, mg).target?.playerIndex ?? null, expected, `${model.id} shot at ${angle} degrees`);
            assert.deepEqual(player.getAimDirection(new THREE.Vector3()).toArray(), [0, 0, -1]);
        };
        check(20, 30, null);
        check(19, 30, target.index);
        assert.equal(player.fightAimAssistLockRemaining, 0.4);
        check(28, 30, target.index);
        check(30, 30, null);
        check(19, 30, target.index);
        check(19, mg.RANGE + 5, null);
        check(19, 30, target.index);
        target.alive = false;
        check(11, 30, null);
    }
});

test('MG and HUD prefer aircraft over nearer trails and fall back to trails without an aircraft', () => {
    const player = {
        alive: true, isBot: false, index: 0, position: new THREE.Vector3(),
        getAimDirection: (out) => out.set(0, 0, -1),
    };
    const target = { alive: true, index: 1, position: new THREE.Vector3(0, 0, -30), hitboxRadius: 0.8 };
    const trailSpatialIndex = {
        checkProjectileTrailCollision(probe, radius) {
            if (Math.abs(probe.z + 10) > 0.5 + radius) return null;
            return {
                entry: { playerIndex: 1, segmentIdx: 0, fromX: -1, fromY: 0, fromZ: -10, toX: 1, toY: 0, toZ: -10 },
                closestPoint: { closestX: 0, closestY: 0, closestZ: -10 },
            };
        },
    };
    const runtime = {
        players: [player, target], trails: { spatialIndex: trailSpatialIndex },
        entityRuntimeConfig: { ...DEFAULT_ENTITY_RUNTIME_CONFIG, HUNT: HUNT_CONFIG },
        cache: { lockOn: new Map() },
        callbacks: { getStrategy: () => ({ hasMachineGun: () => true }) },
    };
    const mg = HUNT_CONFIG.MG;
    const resolver = new MGHitResolver(runtime);
    const combat = new HuntCombatSystem(runtime);
    assert.equal(isTrailTargetDescriptor(resolveHuntLineTarget({
        sourcePlayer: player, players: runtime.players, trailSpatialIndex,
        origin: player.position, direction: new THREE.Vector3(0, 0, -1),
        playerRange: mg.RANGE, trailRange: mg.RANGE,
    })), true, 'shared targeting preserves nearest-hit behavior by default');
    assert.equal(resolver.resolveHit(player, mg).target?.playerIndex, target.index);
    assert.equal(combat.checkLockOn(player)?.playerIndex, target.index);
    target.alive = false;
    runtime.cache.lockOn.clear();
    assert.equal(isTrailTargetDescriptor(resolver.resolveHit(player, mg).trail), true);
    assert.equal(isTrailTargetDescriptor(combat.checkLockOn(player)), true);
});

test('Fight HUD lock-on uses the same assisted MG direction and weapon range as firing', () => {
    const player = {
        alive: true,
        isBot: false,
        index: 0,
        position: new THREE.Vector3(),
        fightLoadout: { machineGunId: 'raptor_r9' },
        fightAimAssistTargetIndex: -1,
        fightAimAssistLockRemaining: 0,
        getAimDirection: (out) => out.set(0, 0, -1),
    };
    const target = {
        alive: true,
        index: 1,
        position: new THREE.Vector3(3.5, 0, -30),
        hitboxRadius: 0.8,
    };
    const entityRuntimeConfig = {
        ...DEFAULT_ENTITY_RUNTIME_CONFIG,
        HUNT: {
            ...DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT,
            TARGETING: { MUZZLE_OFFSET: 2.1 },
            MG: {
                RANGE: 95,
                TRAIL_SAMPLE_STEP: 0.45,
                TRAIL_HIT_RADIUS: 0.78,
                TRAIL_SELF_SKIP_RECENT: 8,
                HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG: 7,
                HUMAN_AIM_ASSIST_RELEASE_ANGLE_DEG: 10,
                HUMAN_AIM_ASSIST_LOCK_SECONDS: 0.25,
            },
        },
    };
    const runtime = {
        players: [player, target],
        entityRuntimeConfig,
        cache: { lockOn: new Map() },
        callbacks: { getStrategy: () => ({ hasMachineGun: () => true }) },
    };

    const lockTarget = new HuntCombatSystem(runtime).checkLockOn(player);
    assert.equal(lockTarget?.playerIndex, target.index);
    assert.equal(player.fightAimAssistTargetIndex, target.index);
});
