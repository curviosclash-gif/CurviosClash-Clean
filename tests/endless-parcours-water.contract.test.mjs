import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EndlessParcoursPath } from '../src/entities/endless/EndlessParcoursPath.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { EndlessParcoursWaterSource, isEndlessWaterModule } from '../src/entities/endless/EndlessParcoursWater.js';
import { buildEndlessModuleInstance } from '../src/entities/endless/EndlessParcoursModuleBuilder.js';
import { createEndlessMaterials } from '../src/entities/endless/EndlessParcoursStageOps.js';
import { WaterZoneSystem } from '../src/entities/systems/WaterZoneSystem.js';
import { normalizeWaterZone } from '../src/shared/contracts/WaterZoneContract.js';
import { applyWaterGameplayState, resolveWaterAdjustedDelta } from '../src/entities/systems/WaterGameplayOps.js';

test('water sections are seeded, bounded and leave the intro and three sections per cycle dry', () => {
    const variants = new Set();
    for (let seed = 1; seed <= 64; seed++) {
        const sequence = Array.from({ length: 54 }, (_, moduleIndex) => isEndlessWaterModule({ moduleIndex }, seed));
        assert.ok(sequence.slice(0, 6).every(wet => !wet));
        assert.equal(sequence.slice(6, 30).filter(Boolean).length, 6);
        assert.equal(sequence.slice(30, 54).filter(Boolean).length, 6);
        for (let block = 1; block < 9; block++) assert.equal(new Set(sequence.slice(block * 6, block * 6 + 6)).size, 1);
        variants.add(sequence.join(''));
    }
    assert.equal(variants.size, 4);
});

test('curved water uses exactly the visible cabin volume, then disappears when its module unloads', () => {
    const seed = 4242, path = new EndlessParcoursPath({ baseSeed: seed }), materials = createEndlessMaterials();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const runtime = { activeModules: new Map(), _disposed: false }, source = new EndlessParcoursWaterSource(runtime);
    const sample = new THREE.Vector3();
    for (let index = 6; index < 30; index++) {
        const module = path.getModule(index, 4);
        const instance = buildEndlessModuleInstance({ module, geometry, materials, baseSeed: seed });
        runtime.activeModules.set(index, instance);
        assert.equal(Boolean(instance.waterMesh), instance.underwater);
        if (instance.waterMesh) {
            assert.equal(instance.waterMesh.geometry, instance.ownedGeometries[1]);
            assert.equal(instance.waterMesh.material, materials.water);
            assert.equal(instance.waterMesh.position.z, module.originZ);
            sample.set(instance.bounds.min.x + 0.5, instance.bounds.min.y + 0.5,
                (instance.bounds.min.z + instance.bounds.max.z) / 2);
            assert.equal(source.isPositionUnderwater(sample), false, 'the curved cabin does not fill its world AABB');
        }
        for (const t of [0.1, 0.5, 0.9]) {
            const frame = path.getMetric().sampleAtProgress(index, t);
            sample.copy(frame.position);
            assert.equal(source.isPositionUnderwater(sample), instance.underwater);
            sample.addScaledVector(frame.right, 100);
            assert.equal(source.isPositionUnderwater(sample), false, 'outside the tube is never water');
        }
        const middle = path.getMetric().sampleAtProgress(index, 0.5).position;
        runtime.activeModules.delete(index);
        assert.equal(source.isPositionUnderwater(middle), false);
        instance.ownedGeometries.forEach(g => g.dispose());
    }
    runtime._disposed = true;
    assert.equal(source.isPositionUnderwater({ x: NaN, y: 0, z: 0 }), false);
    geometry.dispose(); Object.values(materials).forEach(m => m.dispose()); path.dispose();
});

test('live water source selects effects by position without changing static zones or their network state', () => {
    const dynamicEffects = normalizeWaterZone({ effects: { speedMultiplier: 0.3 } }).effects;
    const source = { isPositionUnderwater: p => p?.x > 50, getEffects: () => dynamicEffects };
    const manager = { arena: { waterZoneSource: source } }, water = new WaterZoneSystem(manager);
    const legacy = normalizeWaterZone({ effects: { speedMultiplier: 0.8 } });
    water.zone = legacy;
    const before = water.serializeNetworkState();
    assert.equal(water.getEffects({ x: 60 }), dynamicEffects);
    assert.equal(water.getEffects({ x: 0 }), legacy.effects);
    assert.equal(water.getEffects(), legacy.effects);
    assert.equal(water.isPositionUnderwater({ x: 60 }), true);
    assert.deepEqual(water.serializeNetworkState(), before);
    manager.arena.waterZoneSource = null;
    assert.equal(water.getEffects({ x: 60 }), legacy.effects);
    water.dispose();
});

test('streamed water applies and restores player, projectile, fire and trail effects through the existing system', () => {
    const runtime = { activeModules: new Map(), _disposed: false };
    const source = new EndlessParcoursWaterSource(runtime);
    const water = new WaterZoneSystem({ arena: { waterZoneSource: source } });
    // A source may be attached after startRound: no authored water is necessary.
    assert.equal(water.startRound(), false);
    source.isPositionUnderwater = p => p?.x > 0;
    let gaps = 0;
    const player = { position: { x: 1 }, activeEffects: [{ type: 'BURNING', remaining: 2 }], flameActive: true,
        trail: { forceGap() { gaps++; }, resetWidth() {} } };
    assert.equal(applyWaterGameplayState(player, water, 0.1), true);
    assert.equal(player.waterSpeedMultiplier, 0.64); assert.equal(player.waterTurnMultiplier, 0.7);
    assert.equal(player.waterBuoyancy, 7.5); assert.equal(player.waterVisibilityMultiplier, 0.42);
    assert.equal(player.waterProjectileSpeedMultiplier, 0.58);
    assert.equal(resolveWaterAdjustedDelta(water, player.position, 1), 0.58);
    assert.equal(player.flameActive, false); assert.deepEqual(player.activeEffects, []); assert.equal(gaps, 1);
    player.position.x = -1;
    assert.equal(applyWaterGameplayState(player, water, 0.1), false);
    assert.equal(player.waterSpeedMultiplier, 1); assert.equal(player.waterTurnMultiplier, 1);
    assert.equal(player.waterBuoyancy, 0); assert.equal(player.waterVisibilityMultiplier, 1);
    assert.equal(player.waterProjectileSpeedMultiplier, 1);
    assert.equal(resolveWaterAdjustedDelta(water, player.position, 1), 1);
    water.dispose();
});

test('runtime restores only its own source and repeated restarts leave no water or render resources', () => {
    const previous = { id: 'previous' }, arena = { waterZoneSource: previous };
    for (let index = 0; index < 10; index++) {
        const manager = { humanPlayers: [], bots: [] };
        const runtime = new EndlessParcoursRuntime({ arena, entityManager: manager, baseSeed: index + 1 });
        const source = arena.waterZoneSource;
        assert.ok(source instanceof EndlessParcoursWaterSource);
        const materials = Object.values(runtime._materials), counts = materials.map(() => 0);
        materials.forEach((m, i) => m.addEventListener('dispose', () => counts[i]++));
        runtime.dispose(); runtime.dispose();
        assert.equal(arena.waterZoneSource, previous);
        assert.equal(source.isPositionUnderwater({ x: 0, y: 0, z: 0 }), false);
        assert.equal(runtime.activeModules.size, 0);
        assert.ok(counts.every(n => n === 1));
    }
    const runtime = new EndlessParcoursRuntime({ arena, entityManager: { humanPlayers: [], bots: [] } });
    const replacement = { id: 'other-owner' }; arena.waterZoneSource = replacement;
    runtime.dispose(); assert.equal(arena.waterZoneSource, replacement);
});
