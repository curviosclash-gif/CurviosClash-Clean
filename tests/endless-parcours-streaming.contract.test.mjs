import test from 'node:test';
import assert from 'node:assert/strict';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';

function harness() {
    const events = [];
    const bot = { index: 1, position: { x: 0, y: 0, z: 20 }, isEndlessElite: true };
    const runtime = new EndlessParcoursRuntime({
        baseSeed: 4242,
        renderer: { addToScene() {}, removeFromScene() { events.push('scene'); } },
        arena: { enterStaticStreamingMode() {}, exitStaticStreamingMode() { events.push('stream-exit'); },
            registerStaticColliderBatch() {}, unregisterStaticColliderBatch() { events.push('collider'); } },
        powerupManager: { spawnAtAnchor() {}, removeByOwnerId() { events.push('pickups'); } },
        entityManager: {
            humanPlayers: [], bots: [{ player: bot }],
            deactivateBotSlot(slot, reason) { events.push(`bot:${slot}:${reason}`); },
            _projectileSystem: { clearInBounds(...bounds) { events.push(['projectiles', ...bounds]); } },
            _lockOnCache: { clear() { events.push('lock-on'); } },
        },
        wallClockIso: () => '2026-10-17T00:00:00.000Z',
    });
    return { runtime, bot, events };
}

test('streaming removal preserves bot, pickup, projectile, lock-on, collider and scene order', () => {
    const { runtime, bot, events } = harness();
    runtime._botSlots[0].state = 'active';
    runtime._removeModule(runtime.activeModules.get(0));
    assert.deepEqual(events, [
        'bot:0:module_unloaded', 'pickups', ['projectiles', -1000, 1000, 0, 120],
        'lock-on', 'collider', 'scene',
    ]);
    assert.equal(bot.isEndlessElite, false);
    assert.equal(runtime._botSlots[0].state, 'idle');
    assert.equal(runtime.shakeoffs, 0, 'ordinary removal does not award shakeoff');
    runtime.dispose();
});

test('only active bots in unloaded bounds award shakeoffs behind progress during combat', () => {
    const { runtime, bot } = harness();
    const instance = runtime.activeModules.get(0), slot = runtime._botSlots[0];
    runtime.combatStarted = true;
    runtime.maxProgressMeters = 121;
    bot.position.z = 121; slot.state = 'active';
    runtime._removeModule(instance, { awardShakeoff: true });
    assert.equal(slot.state, 'active', 'outside module bot remains active');
    assert.equal(runtime.shakeoffs, 0);
    bot.position.z = 120;
    runtime._removeModule(instance, { awardShakeoff: true });
    assert.equal(slot.state, 'active', 'the canonical seam belongs to the following module');
    bot.position.z = 119.5;
    runtime._removeModule(instance, { awardShakeoff: true });
    assert.equal(slot.state, 'idle');
    assert.equal(runtime.shakeoffs, 1, 'only a bot in the removed station range is awarded');
    runtime._removeModule(instance, { awardShakeoff: true });
    assert.equal(runtime.shakeoffs, 1, 'removing again cannot award inactive bots');
    runtime.dispose();
});

test('dispose releases metric after existing resources and remains idempotent', () => {
    const { runtime, events } = harness();
    const metric = runtime.getPathMetric();
    assert.ok(metric.totalLength > 0);
    runtime._sharedGeometry.addEventListener('dispose', () => events.push('geometry'));
    for (const material of Object.values(runtime._materials)) {
        material.addEventListener('dispose', () => events.push('material'));
    }
    const pathDispose = runtime._path.dispose.bind(runtime._path);
    runtime._path.dispose = () => { events.push('path'); pathDispose(); };
    runtime.dispose();
    assert.equal(events[0], 'bot:0:runtime_dispose');
    const exit = events.indexOf('stream-exit'), geometry = events.indexOf('geometry');
    assert.ok(exit > events.lastIndexOf('scene'));
    assert.ok(geometry > exit);
    assert.ok(events.indexOf('material') > geometry);
    assert.equal(events.at(-1), 'path');
    assert.equal(metric.getModuleCount(), 0);
    assert.equal(metric.totalLength, 0);
    assert.equal(runtime.activeModules.size, 0);
    const count = events.length;
    runtime.dispose();
    assert.equal(events.length, count);
});
