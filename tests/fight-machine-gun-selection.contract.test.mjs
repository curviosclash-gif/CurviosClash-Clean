import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';
import {
    FIGHT_MACHINE_GUN_MODELS,
    normalizeFightMachineGunId,
    resolveFightMachineGunConfig,
} from '../src/shared/contracts/FightMachineGunContract.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
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
    target.position.set(5, 0, -30);
    assert.equal(resolver.resolveHit(player, mg).target, null);
});
