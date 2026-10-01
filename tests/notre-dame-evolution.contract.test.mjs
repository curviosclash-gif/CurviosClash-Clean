import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { NOTRE_DAME_EVOLUTION_MAPS as maps } from '../src/core/config/maps/presets/notre_dame/NotreDameEvolution.js';
import { Renderer } from '../src/core/Renderer.js';
import { MapFireEvolutionController } from '../src/entities/arena/MapFireEvolutionController.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { createMapFireProgression, advanceMapFireProgression, damageMapFireSegment, resolveMapFireProgress } from '../src/shared/contracts/MapFireProgressionContract.js';
import { resolveMapLighting } from '../src/shared/contracts/MapLightingContract.js';

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
test('paused time is inert; restart restores damage, warnings and the intact lighting', () => {
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
test('aliases remain resolvable, visible maps keep their own dusk profiles, and only two choices are visible', () => {
    assert.equal(maps.notre_dame_fire.hiddenFromMapPicker, true);
    assert.equal(maps.notre_dame_fire_arena.hiddenFromMapPicker, true);
    assert.equal(maps.notre_dame_fire.parcours.routeId, 'notre_dame_evolution_v1');
    assert.equal(maps.notre_dame_arena.parcours?.enabled, undefined);
    for (const key of ['notre_dame', 'notre_dame_arena']) {
        assert.deepEqual(maps[key].lighting, NOTRE_DAME_MAPS[key].lighting);
    }
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

test('fire sky relighting is stepped, reaches the authored endpoint and resets for the next round', () => {
    const applied = [];
    const renderer = Object.create(Renderer.prototype);
    renderer._applySceneAppearance = (refreshEnvironment) => {
        applied.push({ refreshEnvironment, lighting: structuredClone(renderer._mapLighting) });
    };
    const arena = {
        renderer,
        currentMapDefinition: { destructibles: { breakScenes: [] } },
        _builder: {
            fireFxController: { setIntensity() {} },
            mapHazardVisualController: { group: null, update() {} },
        },
    };
    const controller = new MapFireEvolutionController(arena);
    controller.build(maps.notre_dame);
    const state = { skyProgress: 0, segments: [] };
    controller.setState(state);
    controller.update(0);

    for (let tick = 1; tick <= 60; tick += 1) {
        state.skyProgress = tick * 0.0003;
        controller.update(tick / 60);
    }
    assert.equal(applied.length, 1, 'raw progress ticks within one lighting step do not reapply full scene appearance');

    const dayLighting = resolveMapLighting(maps.notre_dame.lighting);
    const fireLighting = resolveMapLighting(definition.lighting);
    state.skyProgress = 0.0249;
    controller.update(1.01);
    assert.equal(applied.length, 1, 'progress below the first half-step leaves the profile unchanged');
    state.skyProgress = 0.025;
    controller.update(1.02);
    assert.equal(applied.length, 2, 'crossing the first half-step applies exactly one new profile');
    assert.equal(renderer._mapLighting.key.intensity, dayLighting.key.intensity
        + (fireLighting.key.intensity - dayLighting.key.intensity) * 0.05);
    assert.equal(renderer._mapLighting.fog.far, dayLighting.fog.far
        + (fireLighting.fog.far - dayLighting.fog.far) * 0.05);
    assert.equal(renderer._mapLighting.skyDome.horizonColor, new THREE.Color(dayLighting.skyDome.horizonColor)
        .lerp(new THREE.Color(fireLighting.skyDome.horizonColor), 0.05).getHex());

    state.skyProgress = 0.25;
    controller.update(1.03);
    assert.equal(applied.length, 3, 'each changed five-percent lighting step applies once');
    assert.equal(renderer._mapLighting.key.intensity, dayLighting.key.intensity
        + (fireLighting.key.intensity - dayLighting.key.intensity) * 0.25);
    assert.equal(renderer._mapLighting.fog.far, dayLighting.fog.far
        + (fireLighting.fog.far - dayLighting.fog.far) * 0.25);
    assert.equal(renderer._mapLighting.skyDome.horizonColor, new THREE.Color(dayLighting.skyDome.horizonColor)
        .lerp(new THREE.Color(fireLighting.skyDome.horizonColor), 0.25).getHex());

    state.skyProgress = 1;
    controller.update(2);
    assert.equal(applied.length, 4, 'the final step applies the complete fire profile once');
    assert.deepEqual(renderer._mapLighting, fireLighting);
    assert.deepEqual(renderer._mapLighting.fog, fireLighting.fog, 'fog ends at the authored fire profile');
    assert.deepEqual(renderer._mapLighting.skyDome, fireLighting.skyDome, 'sky ends at the authored fire profile');
    assert.equal(applied.at(-1).refreshEnvironment, false);

    controller.clear();
    controller.build(maps.notre_dame);
    controller.setState({ skyProgress: 0, segments: [] });
    controller.update(0);
    assert.equal(applied.length, 5, 'clear/build resets the lighting step for the next round');
    assert.deepEqual(renderer._mapLighting, resolveMapLighting(maps.notre_dame.lighting));
});
