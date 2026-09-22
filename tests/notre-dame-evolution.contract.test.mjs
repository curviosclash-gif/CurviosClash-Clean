import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { NOTRE_DAME_EVOLUTION_MAPS as maps } from '../src/core/config/maps/presets/notre_dame/NotreDameEvolution.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { createMapFireProgression, advanceMapFireProgression, damageMapFireSegment, resolveMapFireProgress } from '../src/shared/contracts/MapFireProgressionContract.js';

const definition = maps.notre_dame.fireProgression;
function system() {
    const owner = { arena: { currentMapDefinition: maps.notre_dame, glbAnimationElapsedSeconds: 0,
        applyMapDestructibleEvents() {}, resetMapDestructibleScenes() {}, setMapFireState(state) { this.fire = state; } } };
    const instance = new MapDestructibleSystem(owner);
    instance.startRound();
    return { owner, instance };
}
test('Notre-Dame burns in order at five minutes and becomes a ruin at ten minutes', () => {
    const state = createMapFireProgression(definition);
    const events = [];
    advanceMapFireProgression(definition, state, 610, (id, at) => events.push([id, at]));
    assert.deepEqual(events.map(([id]) => id), ['roof', 'nave', 'transept', 'north', 'south', 'crown']);
    for (let i = 0; i < events.length; i++) assert.ok(Math.abs(events[i][1] - definition.segments[i].breakAt) < 0.11);
    assert.equal(resolveMapFireProgress(definition, state), 1);
    for (const entry of state.segments) assert.ok(entry.brokenAt - entry.warningAt >= 3 - 1e-8);
});
test('local hits accelerate collapse but cannot skip warnings or the fire phase', () => {
    const state = createMapFireProgression(definition);
    assert.equal(damageMapFireSegment(definition, state, 'north', 100000), false);
    assert.equal(damageMapFireSegment(definition, state, 'roof', 700), true);
    assert.equal(state.segments[1].heat, 0);
    const events = [];
    advanceMapFireProgression(definition, state, 2.99, (...args) => events.push(args));
    assert.equal(events.length, 0);
    advanceMapFireProgression(definition, state, 10, (...args) => events.push(args));
    assert.equal(events[0][0], 'roof');
    assert.ok(events[0][1] < 120);
    assert.ok(state.segments[1].heat > 0, 'burning roof spreads to adjacent nave');
});
test('paused time is inert; restart restores damage, warnings and the sunny start', () => {
    const { owner, instance } = system();
    owner.arena.glbAnimationElapsedSeconds = 150;
    instance.updateFeedback();
    const snapshot = instance.serializeNetworkState();
    instance.updateFeedback();
    assert.deepEqual(instance.serializeNetworkState(), snapshot);
    instance.startRound();
    assert.equal(instance.getFireProgress(), 0);
    assert.equal(instance.state.events.length, 0);
    assert.ok(instance.state.segments.every((segment) => segment.hp === segment.maxHp));
});
test('late-joining replicas receive heat, warnings and collapse events without simulating damage', () => {
    const host = system();
    host.owner.arena.glbAnimationElapsedSeconds = 299;
    host.instance.updateFeedback();
    const client = system();
    client.instance.setNetworkReplica(true);
    client.instance.applyNetworkState(host.instance.serializeNetworkState());
    client.owner.arena.glbAnimationElapsedSeconds = 310;
    client.instance.updateFeedback();
    assert.deepEqual(client.instance.serializeNetworkState(), host.instance.serializeNetworkState());
    assert.equal(client.instance.applySegmentHit('transept', 10000), null);
    host.owner.arena.glbAnimationElapsedSeconds = 310;
    host.instance.updateFeedback();
    client.instance.applyNetworkState(host.instance.serializeNetworkState());
    client.instance.applyNetworkState(host.instance.serializeNetworkState());
    assert.equal(client.instance.state.events.length, 3);
});
test('aliases remain resolvable but only two Notre-Dame choices are visible', () => {
    assert.equal(maps.notre_dame_fire.hiddenFromMapPicker, true);
    assert.equal(maps.notre_dame_fire_arena.hiddenFromMapPicker, true);
    assert.equal(maps.notre_dame_fire.parcours.routeId, 'notre_dame_evolution_v1');
    assert.equal(maps.notre_dame_arena.parcours?.enabled, undefined);
    assert.equal(maps.notre_dame.lighting.skyDome.zenithColor, 0x2586df);
});
test('each transition has a nonempty exported six-second animation and a source blend', () => {
    for (const model of maps.notre_dame.glbModels.filter((entry) => entry.hiddenUntilTriggered)) {
        const buffer = readFileSync(model.url);
        const document = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
        assert.ok(document.meshes.length > 0);
        assert.equal(document.animations.length, 1);
        assert.equal(document.animations[0].name, 'NotreDameCollapse');
        assert.ok(document.animations[0].channels.length > 0);
        assert.ok(document.materials.some((entry) => entry.pbrMetallicRoughness?.baseColorFactor?.some((v, i) => i < 3 && v < 0.9)));
        assert.ok(readFileSync(model.url.replace('/glb/', '/blender/').replace('.glb', '.blend')).length > 0);
    }
});

test('partial damage keeps its acceleration and carries it into neighbouring phases', () => {
    const regular = createMapFireProgression(definition);
    const damaged = createMapFireProgression(definition);
    damageMapFireSegment(definition, damaged, 'roof', 70);
    const first = [], second = [];
    advanceMapFireProgression(definition, regular, 610, (id, at) => first.push(at));
    advanceMapFireProgression(definition, damaged, 610, (id, at) => second.push(at));
    for (let i = 0; i < first.length; i++) assert.ok(second[i] < first[i] - 5);
});

test('even a lethal hit changes the sky gradually, using paused and replicated simulation time', () => {
    const state = createMapFireProgression(definition);
    damageMapFireSegment(definition, state, 'roof', 100000);
    assert.equal(state.skyProgress, 0, 'damage cannot jump the sky');
    for (let i = 1; i <= 300; i++) {
        const before = state.skyProgress;
        advanceMapFireProgression(definition, state, i / 60, () => {});
        assert.ok(state.skyProgress >= before);
        assert.ok(state.skyProgress - before <= .02 / 60 + 1e-9);
    }
    const paused = state.skyProgress;
    advanceMapFireProgression(definition, state, 5, () => {});
    assert.equal(state.skyProgress, paused);
    assert.ok(paused > 0 && paused < .11);
    assert.equal(createMapFireProgression(definition, state).skyProgress, paused);
});
