import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { resolveMapLighting } from '../src/shared/contracts/MapLightingContract.js';
import { MAP_PICKER_META } from '../src/shared/maps/MapPickerMeta.js';

const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;

// Public maps that deliberately keep the default night look (dark blue fog, stars). Every entry
// needs a reason; a map that gains a profile has to leave this list (checked below).
const DEFAULT_LOOK_BY_DESIGN = Object.freeze({
    custom: 'Slot fuer die im Editor gespeicherte Karte; hat kein festes Thema.',
    expert_gauntlet: 'Kein erkennbares Thema; Alias-Partner die_festung ist ausgenommen.',
    parcours_rift: 'Die Rift-Familie behaelt die Standard-Nacht als Wiedererkennung; Sprint bekommt eine eigene Tageszeit.',
    parcours_rift_precision: 'Gehoert zur Rift-Familie, siehe parcours_rift.',
    micro_maw: 'Kein klares Thema; die Parcours-Strecken folgen in Paket K9b.',
    glass_serpent: 'Kein klares Thema; die Parcours-Strecken folgen in Paket K9b.',
    chrono_spillway: 'Kein klares Thema; die Parcours-Strecken folgen in Paket K9b.',
    aether_relay: 'Kein klares Thema; die Parcours-Strecken folgen in Paket K9b.',
    sky_ladder_abyss: 'Himmelsleiter-Stufen sind Sonderwelten der Portalkette und nicht Teil von K8a.',
    sky_ladder_foundry: 'Himmelsleiter-Stufen sind Sonderwelten der Portalkette und nicht Teil von K8a.',
    sky_ladder_storm: 'Himmelsleiter-Stufen sind Sonderwelten der Portalkette und nicht Teil von K8a.',
    sky_ladder_star: 'Himmelsleiter-Stufen sind Sonderwelten der Portalkette und nicht Teil von K8a.',
});

// The maps that got their profile in K8a. The fog rule below is checked for these; profiles that
// predate K8a (wind_cathedral, neon_carnival, the Notre-Dame and Eiffel maps, ...) were tuned for
// their own sight lines and are not measured against it.
const K8A_LIT_MAPS = Object.freeze([
    'abyssal_descent',
    'aetherion_orrery',
    'crystal_ruins',
    'eclipse_foundry',
    'kinetic_tide',
    'neon_circuit',
    'sky_islands',
    'verdant_aperture',
    'vulkan_odyssey',
    'foam_forest',
    'crossfire',
    'checkerboard',
    'the_pit',
    'core_fusion',
    'pillar_hall',
    'spiral_tower',
    'portal_madness',
    'the_loop',
    'mega_maze',
    'parcours_rift_sprint',
    'parcours_assault',
    'mirror_docks',
    'storm_switchyard',
    'chrono_forge_nexus',
    'rift_bazaar',
    'mega_maze_xl',
]);

// Older profiles that were tuned for their own sight lines before K8a. Only the course side of the
// rule is measured here (the next ring has to stay visible), the half-arena reach is not: the
// moods stay as they are. The arena variants without a route are not part of it.
const K17_ROUTE_FOG_MAPS = Object.freeze([
    'wind_cathedral',
    'neon_carnival',
]);
// Notre-Dame and Falkenwacht fly a few very long legs (533 and 947 units: nave to apse, wall walk
// to keep). Fogging only those in would push the fog out to the edge of the lighting contract and
// make the camera draw 700-1000 units on every ring, so for these two the rule counts the typical
// leg (the median); the guidance arrow at the screen edge carries the long legs.
const K17_MEDIAN_LEG_FOG_MAPS = Object.freeze(['notre_dame', 'burg_falkenwacht']);
const MAX_FOG_SHARE_AT_NEXT_RING = 0.75;

function isPublicLitCandidate(mapKey, map) {
    return MAP_PICKER_META[mapKey]?.tier === 'public' && map?.hiddenFromMapPicker !== true;
}

function publicMaps() {
    return Object.entries(MAP_PRESET_CATALOG).filter(([mapKey, map]) => isPublicLitCandidate(mapKey, map));
}

// World-unit distance between each checkpoint and the ones that can follow it. Branching routes
// list their successors in nextIds; otherwise the next array entry follows.
function ringLegs(map) {
    const checkpoints = map.parcours?.checkpoints;
    if (!Array.isArray(checkpoints)) return [];
    const byId = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
    const scale = map.scaleAuthoredAnchors === true ? MAP_SCALE : 1;
    const legs = [];
    checkpoints.forEach((checkpoint, index) => {
        const successors = Array.isArray(checkpoint.nextIds)
            ? checkpoint.nextIds.map((id) => byId.get(id)).filter(Boolean)
            : [checkpoints[index + 1]].filter(Boolean);
        for (const next of successors) {
            const leg = Math.hypot(...checkpoint.pos.map((value, axis) => (value - next.pos[axis]) * scale));
            legs.push(leg);
        }
    });
    return legs;
}

function longestRingLeg(map) {
    return Math.max(0, ...ringLegs(map));
}

function medianRingLeg(map) {
    const legs = ringLegs(map).sort((a, b) => a - b);
    if (legs.length === 0) return 0;
    return (legs[Math.floor((legs.length - 1) / 2)] + legs[Math.ceil((legs.length - 1) / 2)]) / 2;
}

// Share of the fog that has eaten the ring colour at the longest leg, same formula as the shader.
function fogShareAtLongestLeg(map, pickLeg = longestRingLeg) {
    const { fog } = resolveMapLighting(map.lighting);
    const leg = pickLeg(map);
    return { leg, fog, share: Math.max(0, (leg - fog.near) / (fog.far - fog.near)) };
}

test('every public map states its own lighting unless it keeps the default look by design', () => {
    const missing = publicMaps()
        .filter(([mapKey, map]) => !map.lighting && !Object.hasOwn(DEFAULT_LOOK_BY_DESIGN, mapKey))
        .map(([mapKey]) => mapKey);
    assert.deepEqual(missing, [], `maps without lighting and without a reason: ${missing.join(', ')}`);
});

test('the default-look list names only public maps that really have no lighting', () => {
    for (const mapKey of Object.keys(DEFAULT_LOOK_BY_DESIGN)) {
        const map = MAP_PRESET_CATALOG[mapKey];
        assert.ok(map, `${mapKey} is not in the catalog`);
        assert.ok(!map.lighting, `${mapKey} has lighting now, remove it from DEFAULT_LOOK_BY_DESIGN`);
    }
});

test('fog reaches at least half the shorter arena side, and past the longest ring leg', () => {
    // From a wall the player has to see the middle of the arena: half of the shorter side, in world
    // units (every map is built at MAP_SCALE). On a course the next ring must also stay visible:
    // it sits one leg away, so the fog may not be over (far) before that distance and may not have
    // eaten three quarters of the ring's colour by then.
    const failures = [];
    for (const [mapKey, map] of publicMaps()) {
        if (!K8A_LIT_MAPS.includes(mapKey)) continue;
        assert.ok(map.lighting, mapKey + ' has no lighting');
        const { fog } = resolveMapLighting(map.lighting);
        const [sizeX, , sizeZ] = map.size;
        const reach = (Math.min(sizeX, sizeZ) * MAP_SCALE) / 2;
        if (fog.far < reach) failures.push(`${mapKey}: far ${fog.far} < half arena ${reach}`);
        const leg = longestRingLeg(map);
        if (leg > 0) {
            if (fog.far < leg) failures.push(`${mapKey}: far ${fog.far} < ring leg ${Math.round(leg)}`);
            const { share } = fogShareAtLongestLeg(map);
            if (share > MAX_FOG_SHARE_AT_NEXT_RING) {
                failures.push(`${mapKey}: ${Math.round(share * 100)}% fog at the next ring (leg ${Math.round(leg)})`);
            }
        }
    }
    assert.deepEqual(failures, []);
});

test('the older course maps keep their next ring visible in the fog', () => {
    const failures = [];
    for (const mapKey of K17_ROUTE_FOG_MAPS) {
        const map = MAP_PRESET_CATALOG[mapKey];
        assert.ok(map?.lighting && map.parcours?.enabled, `${mapKey} needs lighting and a route`);
        const { leg, fog, share } = fogShareAtLongestLeg(map);
        if (fog.far < leg) failures.push(`${mapKey}: far ${fog.far} < ring leg ${Math.round(leg)}`);
        if (share > MAX_FOG_SHARE_AT_NEXT_RING) {
            failures.push(`${mapKey}: ${Math.round(share * 100)}% fog at the next ring (leg ${Math.round(leg)})`);
        }
    }
    assert.deepEqual(failures, []);
});

test('the long-leg course maps keep the next ring of a typical leg visible in the fog', () => {
    const failures = [];
    for (const mapKey of K17_MEDIAN_LEG_FOG_MAPS) {
        const map = MAP_PRESET_CATALOG[mapKey];
        assert.ok(map?.lighting && map.parcours?.enabled, `${mapKey} needs lighting and a route`);
        const { leg, fog, share } = fogShareAtLongestLeg(map, medianRingLeg);
        if (fog.far < leg) failures.push(`${mapKey}: far ${fog.far} < median ring leg ${Math.round(leg)}`);
        if (share > MAX_FOG_SHARE_AT_NEXT_RING) {
            failures.push(`${mapKey}: ${Math.round(share * 100)}% fog at the median ring leg (${Math.round(leg)})`);
        }
    }
    assert.deepEqual(failures, []);
});

test('the arena variants without a route keep their own fog', () => {
    const fogOf = (mapKey) => MAP_PRESET_CATALOG[mapKey].lighting.fog;
    assert.deepEqual([fogOf('notre_dame_arena').near, fogOf('notre_dame_arena').far], [78, 190]);
    assert.deepEqual([fogOf('burg_falkenwacht_arena').near, fogOf('burg_falkenwacht_arena').far], [450, 600]);
    // The route maps share the original fog of their arena variants.
    assert.deepEqual(MAP_PRESET_CATALOG.burg_falkenwacht.lighting.fog, fogOf('burg_falkenwacht_arena'));
});

test('maps of one theme family are told apart by their sky and fog colour', () => {
    // Sprint is the same landscape as Rift but needs its own time of day; Eclipse Foundry shares its
    // models with Chrono Forge Nexus and must not read as the same hall.
    const horizon = (mapKey) => resolveMapLighting(MAP_PRESET_CATALOG[mapKey].lighting).skyDome.horizonColor;
    assert.notEqual(horizon('eclipse_foundry'), horizon('chrono_forge_nexus'));
    assert.ok(MAP_PRESET_CATALOG.parcours_rift_sprint.lighting, 'sprint has no own time of day');
});
