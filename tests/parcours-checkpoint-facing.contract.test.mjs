import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

// A route with bidirectionalCheckpoints false only counts a ring when the player crosses its
// plane along `forward` -- see ParcoursProgressSystem._hasPassedCheckpoint. So on those maps
// `forward` is not decoration: point it back down the line the ring is flown at and the ring is
// drawn, lit and animated, and simply never fires. A player sees a ring, flies through it, and
// the route does not advance.
//
// check-parcours-routes.mjs already warns about this, but it accepts a stage when any one of its
// incoming lanes approaches correctly. That is exactly one lane too few: a merge ring takes two
// lanes from opposite sides, and the lane it turns its back on is stuck for good. This checks
// every lane into every ring.

// How square a ring has to stand to the line it is flown at. 1 is dead-on, 0 is edge-on and
// arbitrary, below 0 fires backwards. The worst honest ring in the pack sits at 0.22 (77
// degrees), so anything under 0.2 is a mistake rather than a tight corner.
const MIN_APPROACH_ALIGNMENT = 0.2;

// The maps that had this bug when the check was written, kept here so a catalogue that stops
// reporting directional routes fails loudly instead of passing on an empty set.
const KNOWN_DIRECTIONAL_MAPS = [
    'aether_relay',
    'aetherion_orrery',
    'chrono_forge_nexus',
    'eclipse_foundry',
    'kinetic_tide',
    'notre_dame',
];

function unit(vector) {
    const length = Math.hypot(...vector) || 1;
    return vector.map((value) => value / length);
}

function alignment(entryPos, entryForward, sourcePos) {
    const approach = unit([
        entryPos[0] - sourcePos[0],
        entryPos[1] - sourcePos[1],
        entryPos[2] - sourcePos[2],
    ]);
    const forward = unit(entryForward);
    return (approach[0] * forward[0]) + (approach[1] * forward[1]) + (approach[2] * forward[2]);
}

/** Every directional route in the catalogue, grouped into the stages the runtime builds. */
function directionalRoutes() {
    const routes = [];
    for (const [mapKey, map] of Object.entries(MAP_PRESET_CATALOG)) {
        const route = buildRouteFromParcours(map?.parcours, {});
        if (!route || route.rules.bidirectionalCheckpoints !== false) continue;
        const stages = Array.from({ length: route.totalCheckpoints }, () => []);
        for (const entry of route.checkpoints) {
            if (!Number.isInteger(entry?.routeIndex)) continue;
            if (entry.routeIndex < 0 || entry.routeIndex >= stages.length) continue;
            stages[entry.routeIndex].push(entry);
        }
        const spawn = map.playerSpawn;
        routes.push({
            mapKey,
            route,
            stages,
            spawn: [spawn.x, spawn.y, spawn.z],
        });
    }
    return routes;
}

test('the catalogue still has the directional routes this check exists for', () => {
    const found = directionalRoutes().map((entry) => entry.mapKey).sort();
    for (const mapKey of KNOWN_DIRECTIONAL_MAPS) {
        assert.ok(found.includes(mapKey), `${mapKey} still runs on directional checkpoints`);
    }
});

test('every lane into a directional checkpoint approaches it from behind its plane', () => {
    for (const { mapKey, stages, spawn } of directionalRoutes()) {
        for (let stage = 0; stage < stages.length; stage += 1) {
            // Stage 0 is flown at from the spawn; every later stage from whichever lanes feed it.
            const sources = stage === 0 ? [spawn] : stages[stage - 1].map((entry) => entry.pos);
            for (const entry of stages[stage]) {
                if (!Array.isArray(entry.forward)) continue;
                for (const source of sources) {
                    const value = alignment(entry.pos, entry.forward, source);
                    assert.ok(
                        value >= MIN_APPROACH_ALIGNMENT,
                        `${mapKey}/${entry.id} faces the lane from ${source.join(',')} (got ${value.toFixed(3)})`,
                    );
                }
            }
        }
    }
});

test('the finish line faces the last stage that feeds it', () => {
    for (const { mapKey, route, stages } of directionalRoutes()) {
        const finish = route.finish;
        if (!finish || !Array.isArray(finish.forward)) continue;
        for (const entry of stages[stages.length - 1] || []) {
            const value = alignment(finish.pos, finish.forward, entry.pos);
            assert.ok(
                value >= MIN_APPROACH_ALIGNMENT,
                `${mapKey}/finish faces the lane from ${entry.id} (got ${value.toFixed(3)})`,
            );
        }
    }
});
