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
import { collectGameplayPoints, scanAnimatedSetpieces } from './helpers/animated-setpiece-scan.mjs';

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
    // chrono_forge_nexus (plan I): static parts without the obstacle boxes the preset promises.
    'chrono_forge_nexus|chrono-forge-dock-crane|-|static-uncovered',
    'chrono_forge_nexus|chrono-forge-machine-core|-|static-uncovered',
    'chrono_forge_nexus|chrono-forge-rift-shards|-|static-uncovered',
    'chrono_forge_nexus|chrono-forge-temple-chronometer|-|static-uncovered',
    'chrono_forge_nexus|chrono-forge-temple-gates|-|static-uncovered',
    // eclipse_foundry: reuses the Chrono Forge setpieces and inherits both of its findings. Not
    // part of the 28.09. audit and not covered by the Chrono beat decision.
    'eclipse_foundry|eclipse-foundry-arrival-crane|-|static-uncovered',
    'eclipse_foundry|eclipse-foundry-arrival-drones|-|beat',
    'eclipse_foundry|eclipse-foundry-crown-shards|-|beat',
    'eclipse_foundry|eclipse-foundry-crown-shards|-|static-uncovered',
    'eclipse_foundry|eclipse-foundry-descent-clock|-|static-uncovered',
    'eclipse_foundry|eclipse-foundry-eclipse-heart|-|beat',
    'eclipse_foundry|eclipse-foundry-furnace-core|-|static-uncovered',
    'eclipse_foundry|eclipse-foundry-furnace-gates|-|beat',
    'eclipse_foundry|eclipse-foundry-furnace-gates|-|static-uncovered',
    'eclipse_foundry|eclipse-foundry-lens-shards|-|beat',
    'eclipse_foundry|eclipse-foundry-lens-shards|-|static-uncovered',
    'eclipse_foundry|eclipse-foundry-orbit-clock|-|static-uncovered',
    'eclipse_foundry|eclipse-foundry-orbit-core|-|beat',
    'eclipse_foundry|eclipse-foundry-shipyard-airship|-|beat',
    'eclipse_foundry|eclipse-foundry-shipyard-drones|-|beat',
    'eclipse_foundry|eclipse-foundry-temple-gates|-|beat',
    'eclipse_foundry|eclipse-foundry-temple-gates|-|static-uncovered',
    // eiffel_tower* (plan F): summit lift axis crosses portal, bot spawn, ghost item and sling;
    // the arena bot spawn TOP_DECK+8 sits in the beacon.
    'eiffel_tower_arena|eiffel-beacon|spawn:bot5|clearance',
    'eiffel_tower_arena|eiffel-summit-lift|gate:et_arena_second_sling|clearance',
    'eiffel_tower_arena|eiffel-summit-lift|item:et_arena_ghost_second|clearance',
    'eiffel_tower_arena|eiffel-summit-lift|portal:P1b|clearance',
    'eiffel_tower_arena|eiffel-summit-lift|spawn:bot4|clearance',
    'eiffel_tower_siege|eiffel-summit-lift|gate:et_arena_second_sling|clearance',
    'eiffel_tower_siege|eiffel-summit-lift|item:et_arena_ghost_second|clearance',
    'eiffel_tower_siege|eiffel-topple-lower|-|end-below-ground',
    'eiffel_tower|eiffel-lift-north-east|gate:et_leg_sling|clearance',
    'eiffel_tower|eiffel-summit-lift|portal:P1b|clearance',
    'eiffel_tower|eiffel-summit-lift|ring:CP09|clearance',
    // glb_gallery (plan L): Building_Corner_01 plays its first clip, which moves nothing; the
    // gallery has no map beat, so its library clips run against the 4 s default.
    'glb_gallery|pm-chromatic-chaos/Building_Corner_01|-|beat',
    'glb_gallery|pm-chromatic-chaos/Building_Corner_01|-|clip-static',
    'glb_gallery|pm-chromatic-chaos/ComputerScreen_Retro|-|beat',
    // kinetic_tide (plan H): rare lens inside the reactor core, CP07/CP11/P3a/lift sling in the
    // stroke of their mechanism, static frames without obstacle boxes. CP02, CP14 and the
    // pendulum item were not in the plan: the gate leaves, tide panels and bob close them briefly.
    'kinetic_tide|kinetic-tide-carousel|-|static-uncovered',
    'kinetic_tide|kinetic-tide-gate-one|-|static-uncovered',
    'kinetic_tide|kinetic-tide-gate-three|-|static-uncovered',
    'kinetic_tide|kinetic-tide-gate-three|ring:CP02|clearance',
    'kinetic_tide|kinetic-tide-gate-two|-|static-uncovered',
    'kinetic_tide|kinetic-tide-iris-shutter|-|static-uncovered',
    'kinetic_tide|kinetic-tide-lift-rings|-|static-uncovered',
    'kinetic_tide|kinetic-tide-lift-rings|gate:tide_lift_sling|clearance',
    'kinetic_tide|kinetic-tide-lift-rings|ring:CP11|clearance',
    'kinetic_tide|kinetic-tide-pendulums|-|static-uncovered',
    'kinetic_tide|kinetic-tide-pendulums|item:tide_speed_pendulum|clearance',
    'kinetic_tide|kinetic-tide-piston-tunnel|-|static-uncovered',
    'kinetic_tide|kinetic-tide-reactor-heart|-|static-uncovered',
    'kinetic_tide|kinetic-tide-reactor-heart|item:tide_rare_lens|clearance',
    'kinetic_tide|kinetic-tide-reactor-heart|ring:CP07|clearance',
    'kinetic_tide|kinetic-tide-tide-wall|-|static-uncovered',
    'kinetic_tide|kinetic-tide-tide-wall|portal:P3a|clearance',
    'kinetic_tide|kinetic-tide-tide-wall|ring:CP14|clearance',
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
    // verdant_aperture (plan D): rocket heart item on the seed core; static hubs, rails, posts and
    // plinths without obstacle boxes (not in the plan, which only lists the placement offsets).
    'verdant_aperture|verdant-aperture-bloom-east|-|static-uncovered',
    'verdant_aperture|verdant-aperture-bloom-west|-|static-uncovered',
    'verdant_aperture|verdant-aperture-canopy-east|-|static-uncovered',
    'verdant_aperture|verdant-aperture-canopy-west|-|static-uncovered',
    'verdant_aperture|verdant-aperture-heart-seed|-|static-uncovered',
    'verdant_aperture|verdant-aperture-heart-seed|item:verdant_rocket_heart|clearance',
    'verdant_aperture|verdant-aperture-leaf-shutter-east|-|static-uncovered',
    'verdant_aperture|verdant-aperture-leaf-shutter-west|-|static-uncovered',
    'verdant_aperture|verdant-aperture-louvre-centre|-|static-uncovered',
    'verdant_aperture|verdant-aperture-mill-north|-|static-uncovered',
    'verdant_aperture|verdant-aperture-mill-south|-|static-uncovered',
    'verdant_aperture|verdant-aperture-vine-gate|-|static-uncovered',
];

// notre_dame site (wird entfernt): the construction site GLBs 10-17 leave with plan J. Their
// entries go with them; the route and points that hang on them are rebuilt there.
const NOTRE_DAME_SITE_FINDINGS = [
    'notre_dame_arena|notre-dame-hoarding|portal:P3b|clearance',
    'notre_dame_arena|notre-dame-rose-scaffold|portal:P0a|clearance',
    'notre_dame_fire_arena|notre-dame-hoarding|portal:P3b|clearance',
    'notre_dame_fire_arena|notre-dame-rose-scaffold|portal:P0a|clearance',
    'notre_dame_fire|notre-dame-fleche-hoist|item:nd_shield_spire|clearance',
    'notre_dame_fire|notre-dame-fleche-hoist|ring:FINISH|clearance',
    'notre_dame_fire|notre-dame-hoarding|portal:P3b|clearance',
    'notre_dame_fire|notre-dame-rose-scaffold|item:nd_rare_rose|clearance',
    'notre_dame_fire|notre-dame-rose-scaffold|portal:P0a|clearance',
    'notre_dame_fire|notre-dame-rose-scaffold|ring:CP05_ROSE|clearance',
    'notre_dame_fire|notre-dame-vault-gantry|ring:CP06|clearance',
    'notre_dame|notre-dame-fleche-hoist|item:nd_shield_spire|clearance',
    'notre_dame|notre-dame-fleche-hoist|ring:FINISH|clearance',
    'notre_dame|notre-dame-hoarding|portal:P3b|clearance',
    'notre_dame|notre-dame-rose-scaffold|item:nd_rare_rose|clearance',
    'notre_dame|notre-dame-rose-scaffold|portal:P0a|clearance',
    'notre_dame|notre-dame-rose-scaffold|ring:CP05_ROSE|clearance',
    'notre_dame|notre-dame-vault-gantry|ring:CP06|clearance',
];

// Deliberate exceptions, decided 28.09.2026 (PLAN.md section 3, decision 3). They stay out of
// the ratchet but must still occur, so a fixed setpiece does not keep an exemption it no longer
// needs.
const DELIBERATE_EXCEPTIONS = [
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
];

// Every map with animated setpieces the 28.09. audit named; the scan must reach all of them.
const AUDITED_MAPS = [
    'aetherion_orrery', 'chrono_forge_nexus', 'kinetic_tide', 'verdant_aperture', 'burg_falkenwacht',
    'eiffel_tower', 'eiffel_tower_siege', 'reactor_site', 'skyline_siege', 'storm_bridge_siege',
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
    const listed = new Set([...KNOWN_FINDINGS, ...NOTRE_DAME_SITE_FINDINGS]);
    const exceptions = new Set(DELIBERATE_EXCEPTIONS);
    assert.equal(listed.size, KNOWN_FINDINGS.length + NOTRE_DAME_SITE_FINDINGS.length, 'duplicate entry');
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
    // put a probe on the Kinetic Tide reactor core and one far above the arena.
    const map = MAP_PRESET_CATALOG.kinetic_tide;
    const lens = collectGameplayPoints(map).find((point) => point.id === 'item:tide_rare_lens');
    const result = await scanAnimatedSetpieces({
        catalog: { kinetic_tide: map },
        pointsOverride: () => [
            { id: 'probe:core', samples: lens.samples },
            { id: 'probe:sky', samples: [[0, 5000, 0]] },
        ],
    });
    assert.ok(result.findings.has('kinetic_tide|kinetic-tide-reactor-heart|probe:core|clearance'));
    assert.ok(![...result.findings.keys()].some((key) => key.includes('probe:sky')));
});
