import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { getPlayerVehicleIds, getVehicleDefinition } from '../src/entities/vehicle-registry.js';
import { ARCADE_LAB_MAX_SWEEP_RADIUS, createArcadeLabStarterConfig, validateArcadeLabShip } from '../src/shared/contracts/ArcadeLabContract.js';
import { buildArcadeHitboxShape } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { ARCADE_PART_SIZE_GROUPS, ARCADE_PART_SIZE_MAX_PCT } from '../src/shared/contracts/ArcadeVehicleSizeContract.js';
import { isArcadeSelectableVehicleId, resolveArcadeWallHitboxScale } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { listRegisteredArcadeLabShips, registerArcadeLabShips } from '../src/shared/contracts/ArcadeLabRegistryContract.js';
import { listCompiledBoxObstacles } from '../scripts/parcours-ring-clearance.mjs';
import { analyzeMapAnchors, CHECKS, MAX_SELECTABLE_PLAYER_RADIUS, violationKey } from './helpers/map-anchor-guard.mjs';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

// Every catalog map, every placed point: spawns, items, portals, gates and lights must lie inside
// the arena, outside solid boxes, with room to fly, and make sense (known pickup type, no stacked
// items, lights that reach something). The geometry rules live in helpers/map-anchor-guard.mjs.
//
// The known list is a ratchet and the work list for the map packages: a new violation fails, and so
// does an entry that no longer applies ("stale entry - remove"), so the list can only shrink.
// MAP_ANCHOR_GUARD_IGNORE_KNOWN=1 lists every violation without the list (the red proof);
// MAP_ANCHOR_GUARD_PRINT=1 prints them as JSON.

const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
const KNOWN_PATH = new URL('./fixtures/map-anchor-guard-known.json', import.meta.url);

function analyzeCatalog() {
    return Object.entries(MAP_PRESET_CATALOG)
        .flatMap(([mapKey, map]) => analyzeMapAnchors(mapKey, map, MAP_SCALE));
}

test('known list is well formed and its count matches its entries', () => {
    const known = JSON.parse(readFileSync(KNOWN_PATH, 'utf8'));
    assert.ok(Array.isArray(known.entries), 'entries is a list');
    assert.equal(known.count, known.entries.length, 'count equals the number of entries');
    const seen = new Set();
    for (const entry of known.entries) {
        assert.ok(MAP_PRESET_CATALOG[entry.map], `${entry.map} is a catalog map`);
        assert.ok(CHECKS.includes(entry.check), `${entry.check} is a known check`);
        assert.ok(entry.point && entry.reason, `${violationKey(entry)} states a point and a reason`);
        assert.ok(!seen.has(violationKey(entry)), `${violationKey(entry)} is listed once`);
        seen.add(violationKey(entry));
    }
});

test('every catalog map keeps its placed points sane, apart from the known list', () => {
    const found = analyzeCatalog();
    if (process.env.MAP_ANCHOR_GUARD_PRINT === '1') console.log(JSON.stringify(found));
    const known = process.env.MAP_ANCHOR_GUARD_IGNORE_KNOWN === '1'
        ? []
        : JSON.parse(readFileSync(KNOWN_PATH, 'utf8')).entries;
    const knownKeys = new Set(known.map(violationKey));
    const foundKeys = new Set(found.map(violationKey));

    const added = found.filter((violation) => !knownKeys.has(violationKey(violation)));
    const stale = known.filter((entry) => !foundKeys.has(violationKey(entry)));
    assert.deepEqual(
        added.map((violation) => `${violationKey(violation)}: ${violation.reason}`),
        [],
        'new violation not in tests/fixtures/map-anchor-guard-known.json: fix the map instead of listing it',
    );
    assert.deepEqual(
        stale.map((entry) => `${violationKey(entry)}: stale entry - remove (and lower count)`),
        [],
        'known entry is no longer violated',
    );
});

// The guard is new, so its only proof of being able to fail is to make it fail: a catalog preset
// moved into trouble on purpose, plus hand-built maps for the cases the catalog may never hit.
test('a displaced copy of a real preset is caught on every check', () => {
    const base = MAP_PRESET_CATALOG.wind_cathedral;
    const before = new Set(analyzeMapAnchors('wind_cathedral', base, MAP_SCALE).map(violationKey));
    const copy = structuredClone(base);
    const box = listCompiledBoxObstacles(copy)[0];
    assert.ok(box, 'the base preset has a compiled box to push things into');

    // Anchors of this map are authored in scaled units; boxes and portals are authored in map units.
    const inAnchorUnits = (mapUnits) => mapUnits.map((value) => (copy.scaleAuthoredAnchors ? value : value * MAP_SCALE));
    const [x, y, z] = inAnchorUnits(box.pos);
    copy.playerSpawn = { ...copy.playerSpawn, x, y, z };
    const twin = copy.items[0];
    copy.items.push({ ...twin, id: 'moved_twin' });
    copy.items.push({ ...copy.items[1], id: 'moved_out', x: copy.size[0] * 40 });
    copy.items.push({ id: 'moved_badtype', type: 'NOT_A_PICKUP', x: twin.x + 9, y: twin.y, z: twin.z });
    copy.items.push({ id: 'moved_no_coords', pos: [0, 10] });
    copy.portals = [{ a: [...box.pos], b: [0, copy.size[1] * 5, 0] }];
    copy.lights = [{ id: 'moved_light', x: 0, y: copy.size[1] * 20, z: 0, distance: 10 }];

    const added = analyzeMapAnchors('wind_cathedral', copy, MAP_SCALE)
        .filter((violation) => !before.has(violationKey(violation)));
    const byCheck = (check) => added.filter((violation) => violation.check === check).map((violation) => violation.point);
    assert.deepEqual(byCheck('in-solid').sort(), ['playerSpawn', 'portals[0].a'].sort());
    assert.deepEqual(byCheck('bounds').sort(), ['items[moved_out]', 'lights[moved_light]', 'portals[0].b'].sort());
    assert.deepEqual(byCheck('item-duplicate'), ['items[moved_twin]']);
    assert.deepEqual(byCheck('item-type'), ['items[moved_badtype]']);
    assert.deepEqual(byCheck('anchor-format'), ['items[moved_no_coords]']);
    assert.deepEqual(byCheck('light-reach'), ['lights[moved_light]']);
    assert.ok(byCheck('free-directions').length <= 1, 'a spawn inside a box is reported once as in-solid');
});

test('free directions: three closed sides still leave three, four closed sides do not', () => {
    const room = (obstacles) => ({
        size: [60, 40, 60], scaleAuthoredAnchors: true, obstacles, playerSpawn: { x: 0, y: 20, z: 0 },
    });
    // Walls 1.5 map units (4.5 world units) from the spawn, well inside the 8 unit reach.
    const wall = {
        posX: { pos: [1.5, 20, 0], size: [1, 10, 10] },
        negX: { pos: [-1.5, 20, 0], size: [1, 10, 10] },
        posZ: { pos: [0, 20, 1.5], size: [10, 10, 1] },
        negZ: { pos: [0, 20, -1.5], size: [10, 10, 1] },
    };
    const checksOf = (map) => analyzeMapAnchors('probe', map, MAP_SCALE).map((violation) => violation.check);
    assert.deepEqual(checksOf(room([wall.posX, wall.negX, wall.posZ, wall.negZ])), ['free-directions']);
    assert.deepEqual(checksOf(room([wall.posX, wall.negX, wall.posZ])), []);
    assert.deepEqual(checksOf(room([])), []);
});

test('tunnel walls are solid outside their bore and rotated boxes are rotated', () => {
    const wallWithBore = {
        size: [60, 40, 60],
        obstacles: [{ pos: [0, 10, 0], size: [20, 20, 2], tunnel: { radius: 3, axis: 'z' } }],
        portals: [{ a: [0, 10, 0], b: [8, 10, 0] }],
    };
    const keys = analyzeMapAnchors('probe', wallWithBore, MAP_SCALE).map(violationKey);
    assert.deepEqual(keys, ['probe | in-solid | portals[0].b'], 'the bore is open, the wall beside it is not');

    // A 40 x 2 map-unit slab turned a quarter turn covers z, not x.
    const turned = {
        size: [100, 40, 100],
        obstacles: [{ pos: [0, 10, 0], size: [40, 20, 2], rotateY: Math.PI / 2 }],
        portals: [{ a: [0, 10, 10], b: [10, 10, 0] }],
    };
    assert.deepEqual(
        analyzeMapAnchors('probe', turned, MAP_SCALE).map(violationKey),
        ['probe | in-solid | portals[0].a'],
    );
});

test('the map scale applies to anchors only when the map says so', () => {
    const base = { size: [20, 20, 20], obstacles: [], playerSpawn: { x: 12, y: 10, z: 0 } };
    // 12 map units half-width is 10: scaled to 36 world units it is outside a 60-unit arena,
    // unscaled it is still inside.
    assert.deepEqual(analyzeMapAnchors('probe', { ...base, scaleAuthoredAnchors: true }, MAP_SCALE).map((v) => v.check), ['bounds']);
    assert.deepEqual(analyzeMapAnchors('probe', base, MAP_SCALE).map((v) => v.check), []);
});

test('obstacle bounds: boxes (rotated), tubes and tall boxes must stay inside the arena, a sunk base may not', () => {
    const room = (obstacles) => ({ size: [60, 40, 60], obstacles });
    const pointsOf = (obstacles) => analyzeMapAnchors('probe', room(obstacles), MAP_SCALE)
        .filter((violation) => violation.check === 'obstacle-bounds').map((violation) => violation.point);
    assert.deepEqual(pointsOf([
        { id: 'flush', pos: [20, 10, 0], size: [20, 4, 10] },
        { id: 'sunk', pos: [0, 0, 0], size: [10, 6, 10] },
        { id: 'through_x', pos: [26, 10, 0], size: [10, 4, 10] },
        { id: 'through_z_rotated', pos: [0, 10, -22], size: [30, 4, 4], rotateY: Math.PI / 2 },
        { id: 'beam', shape: 'tube', start: [0, 10, 0], end: [0, 10, 31], radius: 1 },
        { id: 'too_tall', pos: [0, 38, 0], size: [4, 8, 4] },
    ]), ['obstacles[through_x]', 'obstacles[through_z_rotated]', 'obstacles[beam]', 'obstacles[too_tall]']);
});

test('static turrets follow the anchor rule: inside the arena, outside solid boxes, readable', () => {
    const map = {
        size: [60, 40, 60],
        scaleAuthoredAnchors: true,
        obstacles: [{ pos: [10, 10, 0], size: [6, 6, 6] }],
        staticTurrets: [
            { id: 'ok_turret', pos: [-10, 10, 0] },
            { id: 'walled_turret', pos: [10, 10, 0] },
            { id: 'outside_turret', pos: [0, 10, 40] },
            { id: 'broken_turret', pos: [0, 10] },
        ],
    };
    const found = analyzeMapAnchors('probe', map, MAP_SCALE).map(violationKey).sort();
    assert.deepEqual(found, [
        'probe | anchor-format | staticTurrets[broken_turret]',
        'probe | bounds | staticTurrets[outside_turret]',
        'probe | in-solid | staticTurrets[walled_turret]',
    ]);
    // Without the flag the same numbers are world units: 40 is then inside the 90-unit half-width.
    const unscaled = analyzeMapAnchors('probe', { ...map, scaleAuthoredAnchors: false, obstacles: [] }, MAP_SCALE)
        .map(violationKey);
    assert.ok(!unscaled.includes('probe | bounds | staticTurrets[outside_turret]'));
});

test('a placed point inside a playable volume below the floor is inside the arena', () => {
    const map = {
        size: [60, 40, 60],
        scaleAuthoredAnchors: true,
        obstacles: [],
        playableVolumes: [{ shape: 'cylinder', center: [0, 0], radius: 5, minY: -20, maxY: 2 }],
        lights: [
            { id: 'shaft_light', x: 0, y: -10, z: 0, distance: 30 },
            { id: 'rock_light', x: 30, y: -10, z: 0, distance: 30 },
        ],
    };
    const bounds = analyzeMapAnchors('probe', map, MAP_SCALE).filter((violation) => violation.check === 'bounds');
    assert.deepEqual(bounds.map((violation) => violation.point), ['lights[rock_light]']);
});

test('enabled parcours checkpoint IDs are unique while distinct lane aliases remain valid', () => {
    const map = {
        size: [100, 60, 100],
        obstacles: [],
        parcours: {
            enabled: true,
            rules: { allowLaneAliases: true },
            checkpoints: [
                { id: 'CP01', pos: [0, 20, 0], radius: 5 },
                { id: 'CP_DUP', pos: [12, 20, 0], radius: 5 },
                { id: 'CP_DUP', pos: [24, 20, 0], radius: 5 },
            ],
        },
    };
    const duplicates = analyzeMapAnchors('checkpoint_probe', map, MAP_SCALE)
        .filter((violation) => violation.check === 'checkpoint-duplicate-id');
    assert.deepEqual(duplicates.map((violation) => violation.point), ['parcours.checkpoints[2]']);

    const malformedEntryMap = {
        ...map,
        parcours: { enabled: true, checkpoints: [null, { id: 'CP01', pos: [12, 20, 0] }] },
    };
    assert.deepEqual(
        analyzeMapAnchors('checkpoint_probe', malformedEntryMap, MAP_SCALE)
            .filter((violation) => violation.check === 'checkpoint-duplicate-id'),
        [],
        'the runtime skips non-object checkpoint entries before assigning fallback IDs',
    );

    const fallbackCollisionMap = {
        ...map,
        parcours: { enabled: true, checkpoints: [null, { pos: [12, 20, 0] }, { id: 'CP02', pos: [24, 20, 0] }] },
    };
    assert.deepEqual(
        analyzeMapAnchors('checkpoint_probe', fallbackCollisionMap, MAP_SCALE)
            .filter((violation) => violation.check === 'checkpoint-duplicate-id')
            .map((violation) => violation.point),
        ['parcours.checkpoints[2]'],
        'duplicate detection includes the runtime-generated fallback IDs at original array indices',
    );

    const laneMap = {
        ...map,
        parcours: {
            enabled: true,
            rules: { allowLaneAliases: true },
            checkpoints: [
                { id: 'CP01', pos: [0, 20, 0], nextIds: ['CP02_SAFE', 'CP02_FAST'] },
                { id: 'CP02_SAFE', pos: [12, 20, 0], nextIds: ['CP03'] },
                { id: 'CP02_FAST', pos: [12, 20, 12], nextIds: ['CP03'] },
                { id: 'CP03', pos: [24, 20, 0] },
                { id: 'CP04', pos: [36, 20, 0] },
                { id: 'CP04_R', aliasOf: 'CP04', pos: [36, 20, 12] },
            ],
        },
    };
    assert.ok(buildRouteFromParcours(laneMap.parcours)?.branches.length > 0, 'the synthetic route has an active branch');
    assert.deepEqual(
        analyzeMapAnchors('checkpoint_probe', laneMap, MAP_SCALE)
            .filter((violation) => violation.check === 'checkpoint-duplicate-id'),
        [],
        'different authored IDs for canonical checkpoints and lane aliases are valid',
    );

    for (const parcours of [undefined, { enabled: false, checkpoints: map.parcours.checkpoints }]) {
        assert.equal(buildRouteFromParcours(parcours), null, 'the runtime has no route when parcours is absent or disabled');
        const inactive = { ...map, parcours };
        assert.deepEqual(
            analyzeMapAnchors('checkpoint_probe', inactive, MAP_SCALE)
                .filter((violation) => violation.check === 'checkpoint-duplicate-id'),
            [],
            'inactive or absent parcours does not produce runtime checkpoints',
        );
    }
});

test('portal and Parcours trigger volumes stay separated in scaled 3D space for the largest selectable vehicle', () => {
    const selectableFactoryIds = getPlayerVehicleIds().filter((vehicleId) => isArcadeSelectableVehicleId(vehicleId));
    assert.ok(selectableFactoryIds.length > 0);
    assert.ok(getPlayerVehicleIds().every((vehicleId) => (
        !isArcadeSelectableVehicleId(vehicleId) || selectableFactoryIds.includes(vehicleId)
    )), 'trigger guard selection explicitly follows the Arcade-selectable factory rule');
    const factoryRadius = Math.max(...selectableFactoryIds.map((vehicleId) => (
        Number(getVehicleDefinition(vehicleId)?.hitbox?.radius) || CONFIG.PLAYER.HITBOX_RADIUS || 0.8
    )));
    const labTriggerHitboxRadius = 1.2;
    const maxPlayerRadius = Math.max(factoryRadius, labTriggerHitboxRadius) * SETTINGS_LIMITS.gameplay.planeScale.max;
    assert.equal(MAX_SELECTABLE_PLAYER_RADIUS, maxPlayerRadius,
        'anchor trigger guard uses actual Player hitbox radii, including the Lab definition radius, at maximum plane scale');
    const maxPartSizes = Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map((group) => [group, ARCADE_PART_SIZE_MAX_PCT]));
    const previousLabShips = listRegisteredArcadeLabShips();
    const fixtureShips = ['fighter', 'allrounder', 'tank'].map((role, index) => ({
        id: `arcade_lab_${990 + index}`,
        label: `Lab ${role}`,
        role,
        config: createArcadeLabStarterConfig(role),
    }));
    registerArcadeLabShips([...previousLabShips, ...fixtureShips]);
    for (const [index, role] of ['fighter', 'allrounder', 'tank'].entries()) {
        const id = `arcade_lab_${990 + index}`;
        const config = createArcadeLabStarterConfig(role);
        assert.equal(validateArcadeLabShip({ id, config }).ok, true, `${role} is a valid Lab archetype`);
        const shape = buildArcadeHitboxShape(config.parts, maxPartSizes, { originScale: resolveArcadeWallHitboxScale(id) });
        assert.ok(shape.boundRadius <= ARCADE_LAB_MAX_SWEEP_RADIUS,
            `${role} max-size wall hitbox remains inside the separate Lab sweep ceiling`);
        assert.equal(isArcadeSelectableVehicleId(id), true, `${role} Lab archetype is accepted by Arcade selection`);
        assert.equal(getVehicleDefinition(id)?.hitbox?.radius, labTriggerHitboxRadius,
            `${role} runtime Player trigger radius comes from getVehicleDefinition`);
        assert.ok(MAX_SELECTABLE_PLAYER_RADIUS >= labTriggerHitboxRadius * SETTINGS_LIMITS.gameplay.planeScale.max,
            `${role} runtime trigger radius is dominated by the anchor guard independent of its larger wall shape`);
    }
    registerArcadeLabShips(previousLabShips);
    const portalRadius = CONFIG.PORTAL.RADIUS;
    const map = {
        size: [200, 200, 200],
        obstacles: [],
        portals: [{ a: [0, 0, 0], b: [60, 0, 0] }],
        parcours: {
            enabled: true,
            checkpoints: [{ id: 'CP01', pos: [0, 0, 4], radius: 2 }],
        },
    };

    // Portal centers scale as map coordinates; the live Parcours route scales both its center
    // and radius by MAP_SCALE. The Y offset makes this a true 3D sphere check, not an XZ test.
    const scaledCheckpointRadius = 2 * 2;
    const combinedTriggerRadius = portalRadius + scaledCheckpointRadius + 2 * maxPlayerRadius;
    const overlapMap = structuredClone(map);
    overlapMap.parcours.checkpoints[0].pos = [0, 6.25, 0];
    const overlap = analyzeMapAnchors('trigger_overlap', overlapMap, 2, { checkPortalCheckpointOverlaps: true })
        .filter((violation) => violation.check === 'portal-checkpoint-trigger-overlap');
    assert.deepEqual(overlap.map((violation) => violation.point), ['portals[0].a ↔ parcours.checkpoints[0]']);
    assert.ok(Math.hypot(6.25 * 2, 0) < combinedTriggerRadius, 'the scaled 3D centers overlap only after both trigger radii and maximum selectable hulls are included');

    const verticallyClearMap = structuredClone(map);
    verticallyClearMap.parcours.checkpoints[0].pos = [0, combinedTriggerRadius / 2 + 1, 0];
    assert.deepEqual(
        analyzeMapAnchors('trigger_clear', verticallyClearMap, 2, { checkPortalCheckpointOverlaps: true })
            .filter((violation) => violation.check === 'portal-checkpoint-trigger-overlap'),
        [],
        'a vertical gap beyond the combined 3D trigger radius is clear even when the XZ centers coincide',
    );
});

test('item and light IDs are unique within their own runtime namespaces', () => {
    const map = {
        size: [100, 60, 100],
        obstacles: [],
        items: [
            { id: ' shared-anchor ', type: 'item_crystal', x: -20, y: 20, z: 0 },
            { id: 'shared-anchor', type: 'item_crystal', x: 20, y: 20, z: 0 },
        ],
        lights: [
            { id: 'shared-anchor', x: -20, y: 20, z: -20, distance: 100 },
            { id: ' shared-anchor ', x: 20, y: 20, z: -20, distance: 100 },
        ],
    };
    const duplicates = analyzeMapAnchors('id_probe', map, MAP_SCALE)
        .filter((violation) => violation.check.endsWith('-duplicate-id'));
    assert.deepEqual(
        duplicates.map((violation) => `${violation.check}:${violation.point}`),
        ['item-duplicate-id:items[shared-anchor]', 'light-duplicate-id:lights[shared-anchor]'],
    );

    const sameIdInSeparateNamespaces = {
        ...map,
        items: [{ id: 'shared', type: 'item_crystal', x: -20, y: 20, z: 0 }],
        lights: [{ id: 'shared', x: 20, y: 20, z: -20, distance: 100 }],
        portals: [{ id: 'shared', a: [0, 20, 0], b: [0, 20, 20] }],
    };
    assert.deepEqual(
        analyzeMapAnchors('id_namespaces', sameIdInSeparateNamespaces)
            .filter((violation) => violation.check.endsWith('-duplicate-id')),
        [],
        'item anchor keys and light object IDs are separate namespaces; authored portal pair IDs are not a runtime identity',
    );
});
