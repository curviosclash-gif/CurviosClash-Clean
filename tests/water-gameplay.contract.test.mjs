import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyWaterGameplayState,
    resolveWaterAdjustedDelta,
    resolveWaterWeaponCooldown,
} from '../src/entities/systems/WaterGameplayOps.js';
import { FlamethrowerSystem } from '../src/hunt/FlamethrowerSystem.js';
import { RenderViewportSystem } from '../src/core/renderer/RenderViewportSystem.js';

function createWaterSystem(underwater = true) {
    return {
        isPositionUnderwater: () => underwater,
        getEffects: () => ({
            speedMultiplier: 0.64,
            turnMultiplier: 0.7,
            visibilityMultiplier: 0.42,
            buoyancy: 7.5,
            damagePerSecond: 0,
            createTrails: false,
            extinguishesFire: true,
            flamethrowerEnabled: false,
            projectileSpeedMultiplier: 0.58,
            groundUnitsEnabled: true,
        }),
    };
}

test('submerged players receive flight effects, extinguish fire and keep existing trails', () => {
    const existingSegments = [{ id: 'old-trail' }];
    let gaps = 0;
    const player = {
        position: { x: 0, y: 3, z: 0 },
        activeEffects: [{ type: 'BURNING', remaining: 2 }],
        flameActive: true,
        trail: {
            segments: existingSegments,
            forceGap() { gaps += 1; },
            resetWidth() {},
        },
    };

    assert.equal(applyWaterGameplayState(player, createWaterSystem(), 1 / 60), true);
    assert.equal(player.waterSubmerged, true);
    assert.equal(player.waterSpeedMultiplier, 0.64);
    assert.equal(player.waterTurnMultiplier, 0.7);
    assert.equal(player.waterBuoyancy, 7.5);
    assert.equal(player.waterVisibilityMultiplier, 0.42);
    assert.equal(player.flameActive, false);
    assert.deepEqual(player.activeEffects, []);
    assert.equal(gaps, 1);
    assert.equal(player.trail.segments, existingSegments);
});

test('leaving water restores neutral player multipliers without touching ground-unit policy', () => {
    const player = { position: { x: 0, y: 50, z: 0 } };
    assert.equal(applyWaterGameplayState(player, createWaterSystem(false), 1 / 60), false);
    assert.equal(player.waterSubmerged, false);
    assert.equal(player.waterSpeedMultiplier, 1);
    assert.equal(player.waterTurnMultiplier, 1);
    assert.equal(player.waterBuoyancy, 0);
    assert.equal(player.waterVisibilityMultiplier, 1);
    assert.equal(createWaterSystem().getEffects().groundUnitsEnabled, true);
});

test('rockets and machine-gun cadence use the authored underwater projectile multiplier', () => {
    const water = createWaterSystem();
    const position = { x: 0, y: 3, z: 0 };
    assert.equal(resolveWaterAdjustedDelta(water, position, 0.5), 0.29);
    assert.equal(resolveWaterWeaponCooldown({ waterSubmerged: true, waterProjectileSpeedMultiplier: 0.58 }, 0.1), 0.1 / 0.58);
    assert.equal(resolveWaterWeaponCooldown({ waterSubmerged: false }, 0.1), 0.1);
});

test('an armed flamethrower is extinguished underwater and still owns the fire key', () => {
    const player = {
        alive: true,
        hasFlamethrower: true,
        waterSubmerged: true,
        flameActive: true,
    };
    const system = new FlamethrowerSystem({ isFightOutcomeAuthority: true });
    assert.equal(system.fire(player, 0.25, true), true);
    assert.equal(player.flameActive, false);
});

test('viewport hooks can apply and restore underwater visibility per camera', () => {
    const events = [];
    const renderer = {
        setSize() {},
        setScissorTest() {},
        setViewport() {},
        setScissor() {},
        render(_scene, camera) { events.push(`render:${camera.id}`); },
    };
    const viewport = new RenderViewportSystem(renderer, {
        width: 800,
        height: 600,
        beforeCameraRender: (_scene, camera) => events.push(`before:${camera.id}`),
        afterCameraRender: (_scene, camera) => events.push(`after:${camera.id}`),
    });
    viewport.render({}, [{ id: 'p1' }]);
    assert.deepEqual(events, ['before:p1', 'render:p1', 'after:p1']);
});
