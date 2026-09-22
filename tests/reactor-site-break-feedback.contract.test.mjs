import assert from 'node:assert/strict';
import test from 'node:test';

import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { emitMapDestructibleBreakFeedback } from '../src/entities/effects/MapDestructibleBreakFeedback.js';
import { REACTOR_SITE_METRE } from '../src/core/config/maps/presets/reactor_site/ReactorSiteModels.js';

function createFixture({ mapKey = 'reactor_site', reduceMotion = false } = {}) {
    const calls = { particles: [], waves: [], audio: [], shakes: [], impacts: [] };
    const owner = {
        arena: { currentMapKey: mapKey },
        _mapDestructibleSystem: {
            anchorScale: 3,
            getDefinition: () => ({
                segments: [{ id: 'reactor_dome', anchor: [0, 28, 0] }],
            }),
        },
        particles: {
            spawn: (...args) => calls.particles.push(args),
            rocketBlastEffect: { spawn: (...args) => calls.waves.push(args) },
        },
        audio: { play: (...args) => calls.audio.push(args) },
        renderer: {
            cameras: [
                { position: { x: 0, y: 84, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
                { position: { x: 1000, y: 84, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
            ],
            getCameraPerspectiveSettings: () => ({ reduceMotion }),
            triggerCameraShake: (...args) => calls.shakes.push(args),
            reportImpact: (...args) => calls.impacts.push(args),
        },
        players: [],
    };
    const system = new MapDestructibleSystem(owner);
    system.anchorScale = 3;
    system.definition = owner._mapDestructibleSystem.getDefinition();
    owner._mapDestructibleSystem = system;
    owner.arena.glbAnimationElapsedSeconds = 0;
    return { calls, owner, system };
}

test('the reactor breach emits one large presentation without changing gameplay state', () => {
    const { calls, owner } = createFixture();
    const scoreBefore = owner.score;

    assert.equal(emitMapDestructibleBreakFeedback(owner, { segmentId: 'reactor_dome' }), true);
    assert.equal(calls.particles.length, 1);
    assert.deepEqual(calls.particles[0][0], { x: 0, y: 84, z: 0 });
    assert.equal(calls.particles[0][6].type, 'reactor-breach');
    assert.deepEqual(calls.waves[0].slice(1), ['REACTOR_BREACH', 0xffe6bb, 3]);
    assert.equal(calls.audio.length, 0, 'flash precedes sound');
    assert.equal(calls.shakes.length, 0, 'flash precedes pressure');
    owner.arena.glbAnimationElapsedSeconds = .27;
    owner._mapDestructibleSystem.updateFeedback();
    assert.equal(calls.audio.length, 0);
    owner.arena.glbAnimationElapsedSeconds = .28;
    owner._mapDestructibleSystem.updateFeedback();
    owner._mapDestructibleSystem.updateFeedback();
    assert.equal(calls.audio.length, 1);
    assert.equal(calls.waves[1][1], 'REACTOR_PRESSURE');
    assert.equal(calls.audio[0][0], 'REACTOR_BREACH');
    assert.equal(calls.shakes.length, 1, 'only the local camera inside the breach range shakes');
    assert.equal(calls.shakes[0][0], 0);
    assert.equal(calls.impacts.length, 0);
    assert.equal(owner.score, scoreBefore, 'feedback does not award score or end the match');
});

test('sound and pressure travel at the speed of sound to each camera', () => {
    assert.equal(REACTOR_SITE_METRE, 0.6, 'the feedback converts metres with the preset scale');
    const { calls, owner, system } = createFixture();
    // One metre is 0.6 authored units times the map scale of 3: 343 m/s are 617.4 world units/s.
    owner.renderer.cameras[0].position = { x: 600, y: 84, z: 0 };
    owner.renderer.cameras[1].position = { x: 100, y: 84, z: 0 };
    emitMapDestructibleBreakFeedback(owner, { segmentId: 'reactor_dome', atSeconds: 0 });

    owner.arena.glbAnimationElapsedSeconds = .28;
    system.updateFeedback();
    assert.equal(calls.waves[1][1], 'REACTOR_PRESSURE', 'the visible shock still leaves with the flash');
    assert.deepEqual(calls.shakes.map(([index]) => index), [1], 'the near camera is shaken at once');
    assert.equal(calls.audio.length, 0, 'the far listener has not heard it yet');

    owner.arena.glbAnimationElapsedSeconds = .96;
    system.updateFeedback();
    assert.equal(calls.audio.length, 0, '600 units take 0.972 s');
    owner.arena.glbAnimationElapsedSeconds = .98;
    system.updateFeedback();
    system.updateFeedback();
    assert.equal(calls.audio.length, 1, 'heard once, on arrival');
    assert.deepEqual(calls.shakes.map(([index]) => index), [1, 0], 'the far camera shakes on arrival');
    assert.ok(calls.shakes[1][1] < calls.shakes[0][1], 'the far camera shakes less');
    assert.equal(calls.waves.filter((wave) => wave[1] === 'REACTOR_PRESSURE').length, 1);
});

test('a close listener goes briefly deaf on arrival; a distant one does not', () => {
    const near = createFixture();
    const muffles = [];
    near.owner.audio.muffle = (...args) => muffles.push(args);
    near.owner.renderer.cameras[0].position = { x: 200, y: 84, z: 0 };
    emitMapDestructibleBreakFeedback(near.owner, { segmentId: 'reactor_dome', atSeconds: 0 });
    near.owner.arena.glbAnimationElapsedSeconds = .28;
    near.system.updateFeedback();
    assert.equal(muffles.length, 0, 'not before the sound arrives');
    near.owner.arena.glbAnimationElapsedSeconds = .4;
    near.system.updateFeedback();
    assert.equal(muffles.length, 1);
    assert.ok(muffles[0][0] > .6 && muffles[0][0] <= 1, 'close means strong');
    assert.ok(muffles[0][1] >= 1.5 && muffles[0][1] <= 3);

    const far = createFixture();
    const farMuffles = [];
    far.owner.audio.muffle = (...args) => farMuffles.push(args);
    far.owner.renderer.cameras[0].position = { x: 900, y: 84, z: 0 };
    emitMapDestructibleBreakFeedback(far.owner, { segmentId: 'reactor_dome', atSeconds: 0 });
    far.owner.arena.glbAnimationElapsedSeconds = 3;
    far.system.updateFeedback();
    assert.equal(far.calls.audio.length, 1);
    assert.equal(farMuffles.length, 0, 'beyond the pressure range the ears stay clear');
});

test('a listener beyond the travel limit never waits forever', () => {
    const { calls, owner, system } = createFixture();
    owner.renderer.cameras[0].position = { x: 90000, y: 84, z: 0 };
    emitMapDestructibleBreakFeedback(owner, { segmentId: 'reactor_dome', atSeconds: 0 });
    owner.arena.glbAnimationElapsedSeconds = 9;
    system.updateFeedback();
    assert.equal(system._pendingPressureFeedback, null);
    assert.equal(calls.audio.length, 0, 'too far away to hear the breach');
});

test('reduced motion keeps impact feedback but leaves the picture still', () => {
    const { calls, owner } = createFixture({ reduceMotion: true });
    assert.equal(emitMapDestructibleBreakFeedback(owner, { segmentId: 'reactor_dome' }), true);
    owner.arena.glbAnimationElapsedSeconds = .28;
    owner._mapDestructibleSystem.updateFeedback();
    assert.equal(calls.shakes.length, 0);
    assert.equal(calls.impacts.length, 1);
    assert.equal(calls.waves[0][3], 3 * 0.65, 'reduced motion dims and narrows the flash');
});

test('other maps and other reactor segments stay quiet', () => {
    const otherMap = createFixture({ mapKey: 'standard' });
    assert.equal(emitMapDestructibleBreakFeedback(otherMap.owner, { segmentId: 'reactor_dome' }), false);
    assert.equal(otherMap.calls.particles.length, 0);

    const otherSegment = createFixture();
    assert.equal(emitMapDestructibleBreakFeedback(otherSegment.owner, { segmentId: 'vent_stack' }), false);
    assert.equal(otherSegment.calls.audio.length, 0);
});


test('round reset and clear cancel pending pressure; late snapshots do not replay it', () => {
    for (const reset of ['startRound', 'clear']) {
        const { calls, owner, system } = createFixture();
        emitMapDestructibleBreakFeedback(owner, { segmentId: 'reactor_dome', atSeconds: 0 });
        system[reset]();
        owner.arena.glbAnimationElapsedSeconds = 2;
        system.updateFeedback();
        assert.equal(calls.audio.length, 0);
    }
    const { calls, owner, system } = createFixture();
    owner.arena.glbAnimationElapsedSeconds = 10;
    emitMapDestructibleBreakFeedback(owner, { segmentId: 'reactor_dome', atSeconds: 0 });
    system.updateFeedback();
    assert.equal(calls.audio.length, 0);
});
