import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { KINETIC_TIDE_MAP } from '../src/core/config/maps/presets/kinetic_tide.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import {
    isBeatAlignedClipDuration,
    normalizeMapAnimationClock,
    resolveMapAnimationClipPhase,
} from '../src/shared/contracts/MapAnimationClockContract.js';

const map = KINETIC_TIDE_MAP.kinetic_tide;
const SETPIECE_PREFIX = 'assets/maps/kinetic_tide/glb/';
const BEAT_SECONDS = 4;

function setpieces() {
    return map.glbModels.filter((model) => model.url.startsWith(SETPIECE_PREFIX));
}

test('Kinetic Tide is registered everywhere a map has to appear', () => {
    assert.equal(MAP_PRESET_CATALOG.kinetic_tide, map);
    assert.equal(MAP_PRESETS_BASE.kinetic_tide, map);
    assert.deepEqual(map.size, [460, 150, 320]);
    assert.equal(map.parcours.enabled, true);

    // Without a collection the picker drops the map into the unsorted fallback bucket.
    assert.equal(resolveMapPickerCollection('kinetic_tide').id, 'adventure');
});

test('Kinetic Tide runs three branches over a longer route than Eclipse Foundry', () => {
    const route = buildRouteFromParcours(map.parcours);

    assert.ok(route);
    assert.equal(route.routeId, 'kinetic_tide_v1');
    assert.equal(route.totalCheckpoints, 16);
    assert.equal(route.branches.length, 3);
    assert.ok(route.branches.every((branch) => branch.validMerge));
    assert.ok(route.branches.every((branch) => branch.nextCheckpointIds.length === 2));
    assert.equal(map.portals.length, 4);
    assert.equal(map.gates.filter((gate) => gate.type === 'boost').length, 7);
    assert.equal(map.gates.filter((gate) => gate.type === 'slingshot').length, 3);
    assert.equal(map.items.length, 12);
    assert.equal(map.aircraft.length, 4);
    assert.ok(map.obstacles.length >= 60);
});

test('Kinetic Tide brings its own animated setpieces instead of reusing Chrono-Forge', () => {
    const animated = setpieces();

    assert.equal(map.glbModels.length, 43);
    assert.equal(animated.length, 10);
    assert.equal(new Set(map.glbModels.map((model) => model.id)).size, map.glbModels.length);
    assert.equal(map.glbColliderMode, 'dynamic');
    // Every earlier map placed the same eight Chrono-Forge files; this one must not.
    assert.equal(map.glbModels.filter((model) => model.url.includes('chrono_forge')).length, 0);
    for (const model of map.glbModels) {
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} references a local GLB`);
    }
});

test('Kinetic Tide curates static cladding around every moving mechanism', () => {
    const cladding = map.glbModels.filter((model) => model.url.includes('/kinetic_tide/props/'));
    assert.equal(cladding.length, 16);
    assert.equal(new Set(cladding.map((model) => model.url)).size, cladding.length,
        'the integrated selection uses sixteen distinct variants');
    for (const mechanism of [
        'breath-gate',
        'piston-tunnel',
        'iris-shutter',
        'carousel-ring',
        'pendulum-field',
        'lift-rings',
        'tide-wall',
        'reactor-heart',
    ]) {
        assert.ok(cladding.some((model) => model.id.includes(mechanism)), `${mechanism} receives cladding`);
    }
    assert.ok(cladding.some((model) => model.url.includes('machine-frame')));
    assert.ok(cladding.some((model) => model.url.includes('bearing-flange')));
    assert.ok(cladding.some((model) => model.url.includes('warning-beacon')));
    assert.ok(cladding.some((model) => model.url.includes('maintenance-panel')));
    assert.ok(cladding.every((model) => !model.animationClock), 'cladding slots remain static');
});

test('every setpiece states a clip name and a phase on the shared map beat', () => {
    assert.deepEqual(map.glbAnimationClock, { beatSeconds: BEAT_SECONDS });

    for (const model of setpieces()) {
        const clock = normalizeMapAnimationClock(model.animationClock, map.glbAnimationClock);
        assert.equal(clock.beatSeconds, BEAT_SECONDS, `${model.id} inherits the map beat`);
        assert.ok(clock.clipName, `${model.id} names the clip it plays`);
        assert.ok(
            clock.phaseOffsetBeats >= 0 && clock.phaseOffsetBeats < 1,
            `${model.id} offsets within a single beat (got ${clock.phaseOffsetBeats})`,
        );
    }
});

test('the three lock gates open one after another rather than together', () => {
    const gates = setpieces().filter((model) => model.url.endsWith('01_breath_gate.glb'));
    assert.equal(gates.length, 3);

    // The gate loop is one beat long. Reading all three at the same match time has to
    // yield three different clip positions, otherwise the chain is a single wall.
    const phases = gates.map((gate) => resolveMapAnimationClipPhase(
        0,
        normalizeMapAnimationClock(gate.animationClock, map.glbAnimationClock),
        BEAT_SECONDS,
    ));
    assert.equal(new Set(phases.map((phase) => phase.toFixed(4))).size, 3);
    for (const phase of phases) {
        assert.ok(isBeatAlignedClipDuration(BEAT_SECONDS, { beatSeconds: BEAT_SECONDS }));
        assert.ok(phase >= 0 && phase < BEAT_SECONDS);
    }
});

test('the lock chain stays flyable at the base speed', () => {
    const gates = setpieces()
        .filter((model) => model.url.endsWith('01_breath_gate.glb'))
        .map((model) => ({
            x: model.position[0],
            clock: normalizeMapAnimationClock(model.animationClock, map.glbAnimationClock),
        }))
        .sort((left, right) => left.x - right.x);

    const speed = CONFIG_SECTIONS.PLAYER.SPEED;
    const mapScale = CONFIG_SECTIONS.ARENA.MAP_SCALE;
    const entryX = gates[0].x;

    // Where each gate stands in its loop at the moment a player flying the base speed
    // actually arrives. All three have to agree: otherwise one entry timing opens the
    // first gate and shuts the next, and the chain cannot be flown as a chain.
    const phasesOnArrival = (startTime) => gates.map((gate) => {
        const travelSeconds = ((gate.x - entryX) * mapScale) / speed;
        return Number(resolveMapAnimationClipPhase(
            startTime + travelSeconds,
            gate.clock,
            BEAT_SECONDS,
        ).toFixed(6));
    });

    for (const startTime of [0, 0.7, 2, 3.9]) {
        const phases = phasesOnArrival(startTime);
        assert.equal(
            new Set(phases).size,
            1,
            `entering at ${startTime}s should meet the same opening at every gate, got ${phases.join(', ')}`,
        );
    }
});

test('Kinetic Tide route triggers stay within the arena', () => {
    const [width, height, depth] = map.size;
    const entries = [...map.parcours.checkpoints, map.parcours.finish];

    for (const entry of entries) {
        const [x, y, z] = entry.pos;
        assert.ok(Math.abs(x) + entry.radius <= width / 2, `${entry.id} fits in X`);
        assert.ok(y - entry.radius >= 0 && y + entry.radius <= height, `${entry.id} fits in Y`);
        assert.ok(Math.abs(z) + entry.radius <= depth / 2, `${entry.id} fits in Z`);
    }
});
