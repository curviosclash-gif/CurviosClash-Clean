import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { DANDELION_SKY_MAP } from '../src/core/config/maps/presets/dandelion_sky.js';
import { SUNFLOWER_MEADOW_MAP } from '../src/core/config/maps/presets/sunflower_meadow.js';
import { getMapFloorMaterial } from '../src/entities/arena/ArenaBuildResourceCache.js';
import { SUNFLOWER_MEADOW_HONEY_CHAMBER_MODELS } from '../src/core/config/maps/presets/sunflower_meadow/SunflowerMeadowHoneyChamber.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { SunflowerKernelController } from '../src/entities/arena/SunflowerKernelController.js';
import { isPointInSecretRoom, normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';
import { normalizeStaticTurretDefinition } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const MAP = SUNFLOWER_MEADOW_MAP.sunflower_meadow;
const ROOM = normalizeSecretRooms(MAP.secretRooms)[0];
const beams = MAP.obstacles.filter((entry) => entry.shape === 'beam');

function distanceToSegment(point, start, end) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    return new THREE.Line3(a, b).closestPointToPoint(point, true, new THREE.Vector3()).distanceTo(point);
}

// A beam collides as a finite cylinder without caps (ArenaCollision getTubeCollisionInfo).
function isNearBeam(point, beam, margin) {
    const line = new THREE.Line3(new THREE.Vector3(...beam.start), new THREE.Vector3(...beam.end));
    const length = line.distance();
    const t = line.closestPointToPointParameter(point, false);
    if (t < -margin / length || t > 1 + margin / length) return false;
    const axisPoint = line.at(Math.min(1, Math.max(0, t)), new THREE.Vector3());
    const along = line.delta(new THREE.Vector3()).normalize();
    const offset = point.clone().sub(axisPoint);
    const radial = offset.addScaledVector(along, -offset.dot(along)).length();
    return radial < beam.radius + margin;
}

async function loadKernels() {
    const result = await loadGLBMapCollection([MAP.glbModels[0]], {
        loader: geometryOnlyGlbLoader,
        placementScale: 1,
        colliderMode: MAP.glbColliderMode,
    });
    result.scene.updateWorldMatrix(true, true);
    return { result, controller: new SunflowerKernelController(result.scene) };
}

test('the sunflower meadow is a listed adventure map with a kernel-locked honey chamber', () => {
    assert.equal(MAP_PRESET_CATALOG.sunflower_meadow, MAP);
    assert.equal(MAP_PRESETS_BASE.sunflower_meadow, MAP);
    assert.equal(resolveMapPickerCollection('sunflower_meadow').id, 'adventure');
    assert.equal(ROOM.id, 'honey_chamber');
    assert.deepEqual(ROOM.unlock, { source: 'sunflowerKernels', when: 'allReleased', delaySeconds: 0 });
    assert.deepEqual(ROOM.modes, ['HUNT', 'ARCADE']);
    assert.equal(MAP.singlePlayerScenario.gameMode, 'HUNT');
});

test('both flower maps stand on a meadow instead of the checker floor', () => {
    for (const map of [DANDELION_SKY_MAP.dandelion_sky, MAP]) {
        assert.ok(getMapFloorMaterial(map.floorAppearance), `${map.name} has no meadow floor`);
    }
});

test('the GLB brings no colliders, so stalk and head collide only through their beams', async () => {
    const { result, controller } = await loadKernels();
    assert.equal(result.colliders.length, 0, 'every plant mesh is _nocol and kernels never collide');
    assert.equal(controller.count, 220);
    assert.equal(beams.length, 2);
});

test('every kernel sits in front of the head body, so shots reach it first', async () => {
    const { controller } = await loadKernels();
    const head = beams.find((entry) => entry.id === 'sunflower_meadow_head');
    let tightest = Infinity;
    for (const kernel of controller.kernels) {
        const centre = kernel.node.getWorldPosition(new THREE.Vector3());
        tightest = Math.min(tightest, distanceToSegment(centre, head.start, head.end) - head.radius);
    }
    // Only the kernels in front of the disc can be closer to its axis than the radius, and those
    // are measured to the front cap: a kernel inside the body could never be shot out.
    const inside = controller.kernels.filter((kernel) => {
        const centre = kernel.node.getWorldPosition(new THREE.Vector3());
        return distanceToSegment(centre, head.start, head.end) < head.radius
            && new THREE.Line3(new THREE.Vector3(...head.start), new THREE.Vector3(...head.end))
                .closestPointToPointParameter(centre, false) < 1;
    });
    assert.equal(inside.length, 0, `${inside.length} kernels are buried in the head body (${tightest})`);
});

test('starts, pickups, portals and gates stay clear of the plant and of each other', async () => {
    const { controller } = await loadKernels();
    const kernels = controller.kernels.map((kernel) => kernel.node.getWorldPosition(new THREE.Vector3()));
    const starts = [MAP.playerSpawn, ...MAP.botSpawns].map((spawn) => [spawn.x, spawn.y, spawn.z]);
    const probes = [
        ...starts,
        ...MAP.items.map((item) => [item.x, item.y, item.z]),
        ...MAP.portals.flatMap((portal) => [portal.a, portal.b]),
        ...MAP.gates.map((gate) => gate.pos),
        ...MAP.staticTurrets.map((turret) => turret.pos),
        ROOM.entryPortal.pos,
        ROOM.ejectPoint.pos,
    ];
    const [halfX, height, halfZ] = [MAP.size[0] / 2, MAP.size[1], MAP.size[2] / 2];
    for (const probe of probes) {
        const point = new THREE.Vector3(...probe);
        assert.ok(Math.abs(point.x) < halfX - 4 && Math.abs(point.z) < halfZ - 4
            && point.y > 4 && point.y < height - 4, `probe ${probe} leaves the arena`);
        for (const beam of beams) {
            assert.equal(isNearBeam(point, beam, 4), false, `probe ${probe} sits in ${beam.id}`);
        }
        const nearestKernel = Math.min(...kernels.map((kernel) => kernel.distanceTo(point)));
        assert.ok(nearestKernel > 6, `probe ${probe} sits in the kernel disc`);
    }

    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const items = MAP.items.map((item) => [item.x, item.y, item.z]);
    for (const start of starts) {
        const nearestStart = Math.min(...starts.filter((other) => other !== start).map((other) => distance(start, other)));
        assert.ok(nearestStart > 45, `start ${start} crowds another (${nearestStart.toFixed(0)})`);
        const nearestItem = Math.min(...items.map((item) => distance(start, item)));
        assert.ok(nearestItem < 50, `start ${start} has no pickup nearby (${nearestItem.toFixed(0)})`);
    }
    assert.ok(MAP.botSpawns.length >= 7);
});

test('the honey chamber is safe inside and guarded all around its entry portal', () => {
    for (const item of ROOM.items) assert.equal(isPointInSecretRoom(ROOM, item.pos), true);
    assert.equal(isPointInSecretRoom(ROOM, ROOM.roomPortal.pos), true);
    const turrets = MAP.staticTurrets.map((entry) => normalizeStaticTurretDefinition(
        entry, 0, { preserveSpatialRange: true },
    ));
    for (const turret of turrets) {
        assert.equal(isPointInSecretRoom(ROOM, turret.pos), false);
        const roomGap = Math.hypot(
            Math.max(ROOM.bounds.min[0] - turret.pos[0], 0, turret.pos[0] - ROOM.bounds.max[0]),
            Math.max(ROOM.bounds.min[1] - turret.pos[1], 0, turret.pos[1] - ROOM.bounds.max[1]),
            Math.max(ROOM.bounds.min[2] - turret.pos[2], 0, turret.pos[2] - ROOM.bounds.max[2]),
        );
        assert.ok(roomGap > turret.range, `${turret.id} can fire into the room`);
    }
    const portal = ROOM.entryPortal.pos;
    for (let step = 0; step < 16; step += 1) {
        const angle = (step / 16) * Math.PI * 2;
        const point = [portal[0] + Math.cos(angle) * 40, portal[1], portal[2] + Math.sin(angle) * 40];
        const covering = turrets.filter((turret) => Math.hypot(
            ...point.map((value, axis) => value - turret.pos[axis]),
        ) < turret.range).length;
        assert.ok(covering >= 2, `approach ${point.map(Math.round)} is covered by ${covering} guard(s)`);
    }
    for (const model of SUNFLOWER_MEADOW_HONEY_CHAMBER_MODELS) {
        const [x, y, z] = model.position;
        const reach = model.targetSize / 2;
        assert.ok(x - reach >= ROOM.bounds.min[0] && x + reach <= ROOM.bounds.max[0], `${model.id} x`);
        assert.ok(z - reach >= ROOM.bounds.min[2] && z + reach <= ROOM.bounds.max[2], `${model.id} z`);
        assert.ok(y >= ROOM.bounds.min[1] && y + model.targetSize <= ROOM.bounds.max[1], `${model.id} y`);
    }
});
