// Guard for animated GLB setpieces: moving parts must keep clear of the points the game places
// ships and pickups at, loops must stay on the map beat and return to their first frame, the
// chosen clip must move something, static parts of 'dynamic' setpieces must sit inside an
// obstacle box, and break scenes must come to rest inside the arena and above the floor.
//
// What is scanned and how (tests/helpers/animated-setpiece-scan.mjs):
// - every catalog map whose glbModels contain a file with animation clips; placement through
//   the loader's own computeCollectionPlacement at MAP_SCALE, poses through a real
//   AnimationMixer every 0.1 s (loops over their full length, one-shot clips up to their end);
// - colliding moving meshes (no _nocol, not skinned, driven by the chosen clip) against spawns,
//   pickups, turrets, portal ends, gates and the drawn disc of every parcours ring, with one ship
//   radius (PLAYER.HITBOX_RADIUS) as clearance; a ring counts when its centre is blocked at any
//   sample or at least half of its disc at one sample;
// - break scenes (hiddenUntilTriggered) only in their end pose, turned by their authored rotation;
//   the event yaw the runtime adds is not known here.
//
// KNOWN_FINDINGS is a ratchet: it may only shrink. A new finding fails with its detail; a listed
// finding that no longer occurs fails with "Eintrag entfernen". A fix removes its entry first
// (the test turns red) and then repairs the map (green again). The findings are the audit of
// 28.09.2026, tmp/animkartenplan-2026-09-28/PLAN.md.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_SCALE, SHIP_RADIUS, scanAnimatedSetpieces } from './helpers/animated-setpiece-scan.mjs';

const KNOWN_FINDINGS = [
    // aetherion_orrery (plan G): astrolabe bars rise through FINISH, an item and both turrets;
    // the iris blades sweep FINISH and the eclipse turret; the crown bridge parks on CP08; every
    // loop of GLB 05-09 jumps at its end (countdown lamps).
    'aetherion_orrery|aetherion-orrery-astrolabe-foundry|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-astrolabe-foundry|turret:orrery_meridian_turret|clearance',
    'aetherion_orrery|aetherion-orrery-astrolabe-gallery|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-astrolabe-gallery|item:orrery_thick_core|clearance',
    'aetherion_orrery|aetherion-orrery-astrolabe-gallery|ring:FINISH|clearance',
    'aetherion_orrery|aetherion-orrery-astrolabe-gallery|turret:orrery_eclipse_turret|clearance',
    'aetherion_orrery|aetherion-orrery-astrolabe-gallery|turret:orrery_meridian_turret|clearance',
    'aetherion_orrery|aetherion-orrery-bridge-crown|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-bridge-crown|ring:CP08|clearance',
    'aetherion_orrery|aetherion-orrery-bridge-lower|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-bridge-middle|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-comet-crown|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-comet-foundry|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-comet-gallery|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-eclipse-iris|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-eclipse-iris|ring:FINISH|clearance',
    'aetherion_orrery|aetherion-orrery-eclipse-iris|turret:orrery_eclipse_turret|clearance',
    'aetherion_orrery|aetherion-orrery-zodiac-crown|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-zodiac-foundry|-|loop-seam',
    'aetherion_orrery|aetherion-orrery-zodiac-gallery|-|loop-seam',
    // Chrono Forge and Eclipse (plan I): their fixed setpiece parts now have obstacle boxes.
    'eiffel_tower_siege|eiffel-topple-lower|-|end-below-ground',
    // glb_gallery: the gallery has no map beat, so its library clips run against the 4 s default.
    'glb_gallery|pm-chromatic-chaos/Building_Corner_01|-|beat',
    'glb_gallery|pm-chromatic-chaos/ComputerScreen_Retro|-|beat',
    // kinetic_tide (plan H): the iris and flange now frame CP06. The static signal ring remains
    // unboxed because a fixed obstacle there would close the timed opening.
    'kinetic_tide|kinetic-tide-iris-shutter|-|static-uncovered',
    // Storm sieges (plan K1/K2): loops one frame short of the beat, the train jumps back across
    // the bridge at every loop end, wrecks outside the arena or below the floor.
    'storm_bridge_siege|storm-bridge-collapse|-|end-below-ground',
    'storm_bridge_siege|storm-bridge-train|-|beat',
    'storm_bridge_siege|storm-bridge-train|-|loop-seam',
    'storm_dam_siege|storm-dam-collapse|-|end-outside-arena',
    'storm_dam_siege|storm-dam-gate|-|beat',
    'storm_lighthouse_siege|storm-lighthouse-beacon|-|beat',
    'storm_lighthouse_siege|storm-lighthouse-collapse|-|end-below-ground',
    'storm_lighthouse_siege|storm-lighthouse-collapse|-|end-outside-arena',
    'storm_lighthouse_siege|storm-lighthouse-lift|-|beat',
    'storm_lighthouse_siege|storm-lighthouse-lift|item:lighthouse_speed_lift|clearance',
    // verdant_aperture (plan D): static parts that stay without a box on purpose, because the box
    // would sit in the opening the setpiece gates or in the path of its moving parts - the hub
    // signals in the middle of the shutter and iris holes, the louvre ridge across its hole, the
    // mill hubs inside the rotor and the slender buttresses right beside the heart seed's petals.
    'verdant_aperture|verdant-aperture-bloom-east|-|static-uncovered',
    'verdant_aperture|verdant-aperture-bloom-west|-|static-uncovered',
    'verdant_aperture|verdant-aperture-heart-seed|-|static-uncovered',
    'verdant_aperture|verdant-aperture-louvre-centre|-|static-uncovered',
    'verdant_aperture|verdant-aperture-mill-north|-|static-uncovered',
    'verdant_aperture|verdant-aperture-mill-south|-|static-uncovered',
];

// Deliberate exceptions, decided 28.09.2026 (PLAN.md section 3, decision 3). They stay out of
// the ratchet but must still occur, so a fixed setpiece does not keep an exemption it no longer
// needs.
const DELIBERATE_EXCEPTIONS = [
    // Neon Carnival: the marquee's 16-ray sunburst and five-point stars, and the big top's
    // eightfold crown lights, rotate by one symmetry step. Their nodes reset at the loop seam,
    // but their visible non-colliding geometry is in the same pose.
    'neon_carnival|neon-carnival-marquee|-|loop-seam',
    'neon_carnival|neon-carnival-big-top|-|loop-seam',
    // Eiffel: IlluminationRingLoop 9 s and LegElevatorLoop 14 s run against the 4 s beat on
    // purpose, so the ring and the two lifts drift through every combination of openings.
    ...['eiffel_tower', 'eiffel_tower_arena', 'eiffel_tower_siege'].flatMap((mapKey) => [
        `${mapKey}|eiffel-illumination-iris|-|beat`,
        `${mapKey}|eiffel-lift-north-east|-|beat`,
        `${mapKey}|eiffel-lift-south-west|-|beat`,
    ]),
    // Chrono Forge: no shared beat; its five loops (6, 10, 14, 9 and 7 s) run free.
    'chrono_forge_nexus|chrono-forge-rift-shards|-|beat',
    'chrono_forge_nexus|chrono-forge-sky-airship|-|beat',
    'chrono_forge_nexus|chrono-forge-sky-drones|-|beat',
    'chrono_forge_nexus|chrono-forge-temple-gates|-|beat',
    'chrono_forge_nexus|chrono-forge-time-core|-|beat',
    // Eclipse Foundry: the same Chrono Forge loops, exempt for the same reason (decided 28.09.2026).
    'eclipse_foundry|eclipse-foundry-arrival-drones|-|beat',
    'eclipse_foundry|eclipse-foundry-crown-shards|-|beat',
    'eclipse_foundry|eclipse-foundry-eclipse-heart|-|beat',
    'eclipse_foundry|eclipse-foundry-furnace-gates|-|beat',
    'eclipse_foundry|eclipse-foundry-lens-shards|-|beat',
    'eclipse_foundry|eclipse-foundry-orbit-core|-|beat',
    'eclipse_foundry|eclipse-foundry-shipyard-airship|-|beat',
    'eclipse_foundry|eclipse-foundry-shipyard-drones|-|beat',
    'eclipse_foundry|eclipse-foundry-temple-gates|-|beat',
    // Kinetic Tide: timing is the level design (decided 29.09.2026, plan H). CP02 sits in the
    // opening of the third lock gate, CP06 in the iris, CP14 in the tide wall, and the pendulum
    // speed item under the bob it rewards passing.
    'kinetic_tide|kinetic-tide-gate-three|ring:CP02|clearance',
    'kinetic_tide|kinetic-tide-iris-shutter|ring:CP06|clearance',
    'kinetic_tide|kinetic-tide-pendulums|item:tide_speed_pendulum|clearance',
    'kinetic_tide|kinetic-tide-tide-wall|ring:CP14|clearance',
];

// Every map with animated setpieces the 28.09. audit named; the scan must reach all of them.
const AUDITED_MAPS = [
    'aetherion_orrery', 'chrono_forge_nexus', 'eclipse_foundry', 'kinetic_tide', 'verdant_aperture', 'burg_falkenwacht',
    'eiffel_tower', 'eiffel_tower_arena', 'eiffel_tower_siege', 'reactor_site', 'skyline_siege', 'storm_bridge_siege',
    'storm_dam_siege', 'storm_lighthouse_siege', 'notre_dame', 'glb_gallery',
];

let scan = null;
let scanSeconds = 0;

before(async () => {
    const started = performance.now();
    scan = await scanAnimatedSetpieces();
    scanSeconds = (performance.now() - started) / 1000;
});

test('the scan reaches every animated map of the audit', () => {
    for (const mapKey of AUDITED_MAPS) {
        assert.ok(scan.scannedMaps.includes(mapKey), `${mapKey} has no animated setpiece in the scan`);
    }
    assert.ok(scan.stats.movingMeshes > 500, `only ${scan.stats.movingMeshes} moving meshes scanned`);
    console.log(`[animated-setpiece-clearance] ${scan.stats.maps} maps, ${scan.stats.models} setpieces, `
        + `${scan.stats.movingMeshes} moving meshes, ${scan.stats.points} points, ${scanSeconds.toFixed(1)} s`);
});

test('animated setpiece findings only shrink', () => {
    const listed = new Set(KNOWN_FINDINGS);
    const exceptions = new Set(DELIBERATE_EXCEPTIONS);
    assert.equal(listed.size, KNOWN_FINDINGS.length, 'duplicate entry');
    const fresh = [...scan.findings].filter(([key]) => !listed.has(key) && !exceptions.has(key));
    const stale = [...listed].filter((key) => !scan.findings.has(key));
    assert.deepEqual(
        [...fresh.map(([key, detail]) => `neu: ${key} (${detail})`), ...stale.map((key) => `Eintrag entfernen: ${key}`)],
        [],
    );
});

test('deliberate exceptions still apply', () => {
    const unused = DELIBERATE_EXCEPTIONS.filter((key) => !scan.findings.has(key));
    assert.deepEqual(unused.map((key) => `Ausnahme entfernen: ${key}`), []);
});

test('the scan sees a point inside a moving part and ignores one far away', async () => {
    // Self-check of the detector, so a broken pose or placement cannot turn every map green:
    // put a probe in the Kinetic Tide reactor core (authored centre [0,63,0]) and one far above
    // the arena.
    const map = MAP_PRESET_CATALOG.kinetic_tide;
    const result = await scanAnimatedSetpieces({
        catalog: { kinetic_tide: map },
        pointsOverride: () => [
            { id: 'probe:core', samples: [[0, 63 * MAP_SCALE, 0]] },
            { id: 'probe:sky', samples: [[0, 5000, 0]] },
        ],
    });
    assert.ok(result.findings.has('kinetic_tide|kinetic-tide-reactor-heart|probe:core|clearance'));
    assert.ok(![...result.findings.keys()].some((key) => key.includes('probe:sky')));
});

test('the Eclipse crown pedestal clears the full CP15 ring disc and ship radius', () => {
    const map = MAP_PRESET_CATALOG.eclipse_foundry;
    const checkpoint = map.parcours.checkpoints.find((entry) => entry.id === 'CP15');
    const pedestal = map.obstacles.find((obstacle) => obstacle.tunnel?.axis === 'y'
        && obstacle.pos?.[0] === -60 && obstacle.pos?.[2] === 4);
    assert.ok(checkpoint);
    assert.ok(pedestal);

    const discRadius = Math.max(3.2, checkpoint.radius * 0.75) * MAP_SCALE;
    // Use the full radius as an orientation-independent upper bound on its horizontal projection.
    const horizontalDiscRadius = discRadius;
    const centerOffset = Math.hypot(
        (checkpoint.pos[0] - pedestal.pos[0]) * MAP_SCALE,
        (checkpoint.pos[2] - pedestal.pos[2]) * MAP_SCALE,
    );
    const furthestDiscPoint = centerOffset + horizontalDiscRadius;
    const availableRadius = pedestal.tunnel.radius * MAP_SCALE - SHIP_RADIUS;

    assert.ok(
        availableRadius > furthestDiscPoint,
        `CP15 needs ${furthestDiscPoint.toFixed(2)} units; tunnel leaves ${availableRadius.toFixed(2)}`,
    );
});
