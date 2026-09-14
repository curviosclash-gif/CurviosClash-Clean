import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import {
    createDynamicMeshCollider,
    createStaticMeshCollider,
    raycastStaticMeshCollider,
    refreshDynamicMeshCollider,
} from '../src/entities/arena/StaticMeshCollider.js';

const OPEN_BOUNDS = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000, minZ: -1000, maxZ: 1000 };

function createHit() {
    return { distance: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
}

function boxMesh(sizeX, sizeY, sizeZ, position = [0, 0, 0], options = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sizeX, sizeY, sizeZ));
    mesh.name = String(options.name || 'box');
    mesh.position.set(position[0], position[1], position[2]);
    if (options.rotationY) mesh.rotation.y = options.rotationY;
    if (options.scale) mesh.scale.set(options.scale[0], options.scale[1], options.scale[2]);
    mesh.updateMatrixWorld(true);
    return mesh;
}

function meshObstacle(mesh, collider, sourceName, kind = 'hard') {
    return {
        box: new THREE.Box3().setFromObject(mesh),
        isWall: false,
        kind,
        meshCollider: collider,
        dynamic: !!collider?.dynamic,
        sourceName,
    };
}

test('mesh raycast reports the near face distance and its outward normal', () => {
    const mesh = boxMesh(4, 4, 4, [0, 0, 0]);
    const collider = createStaticMeshCollider(mesh);
    const hit = createHit();

    const forward = new THREE.Vector3(1, 0, 0);
    assert.equal(raycastStaticMeshCollider(collider, new THREE.Vector3(-10, 0, 0), forward, 50, hit), true);
    assert.ok(Math.abs(hit.distance - 8) < 1e-6, `distance ${hit.distance}`);
    assert.ok(Math.abs(hit.x + 2) < 1e-6, `x ${hit.x}`);
    assert.ok(Math.abs(hit.nx + 1) < 1e-6, `nx ${hit.nx}`);
    assert.ok(Math.abs(hit.ny) < 1e-6 && Math.abs(hit.nz) < 1e-6);
});

test('mesh raycast misses when pointing away or stopping short', () => {
    const collider = createStaticMeshCollider(boxMesh(4, 4, 4));
    const hit = createHit();
    const origin = new THREE.Vector3(-10, 0, 0);

    assert.equal(raycastStaticMeshCollider(collider, origin, new THREE.Vector3(-1, 0, 0), 50, hit), false);
    assert.equal(raycastStaticMeshCollider(collider, origin, new THREE.Vector3(0, 1, 0), 50, hit), false);
    assert.equal(raycastStaticMeshCollider(collider, origin, new THREE.Vector3(1, 0, 0), 7.9, hit), false);
    assert.equal(raycastStaticMeshCollider(collider, origin, new THREE.Vector3(1, 0, 0), 0, hit), false);
    assert.equal(raycastStaticMeshCollider(null, origin, new THREE.Vector3(1, 0, 0), 50, hit), false);
});

test('mesh raycast survives the bvh threshold on a dense mesh', () => {
    // A sphere carries far more triangles than the bvh threshold, so this exercises traversal.
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 16));
    mesh.position.set(20, 0, 0);
    mesh.updateMatrixWorld(true);
    const collider = createStaticMeshCollider(mesh);
    assert.ok(collider.bvh, 'expected a bvh for a dense mesh');

    const hit = createHit();
    assert.equal(
        raycastStaticMeshCollider(collider, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 100, hit),
        true,
    );
    assert.ok(Math.abs(hit.distance - 17) < 0.2, `distance ${hit.distance}`);
    assert.ok(hit.nx < -0.9, `nx ${hit.nx}`);
});

test('dynamic mesh raycast maps a rotated and scaled hit back into world space', () => {
    // The dynamic collider keeps its triangles in local space and moves the ray instead. The
    // reference is the same mesh baked into world space, which must land on the same hit.
    const mesh = boxMesh(2, 2, 2, [10, 1, 0], { rotationY: Math.PI / 3, scale: [3, 1, 2] });
    const dynamic = createDynamicMeshCollider(mesh);
    const reference = createStaticMeshCollider(mesh);
    assert.equal(dynamic.dynamic, true);

    const origin = new THREE.Vector3(0, 0.4, -0.7);
    const direction = new THREE.Vector3(1, 0.02, 0.03).normalize();
    const dynamicHit = createHit();
    const referenceHit = createHit();
    assert.equal(raycastStaticMeshCollider(dynamic, origin, direction, 60, dynamicHit), true);
    assert.equal(raycastStaticMeshCollider(reference, origin, direction, 60, referenceHit), true);

    assert.ok(Math.abs(dynamicHit.distance - referenceHit.distance) < 1e-6, `distance ${dynamicHit.distance} vs ${referenceHit.distance}`);
    assert.ok(Math.abs(dynamicHit.x - referenceHit.x) < 1e-6);
    assert.ok(Math.abs(dynamicHit.y - referenceHit.y) < 1e-6);
    assert.ok(Math.abs(dynamicHit.z - referenceHit.z) < 1e-6);
    assert.ok(Math.abs(dynamicHit.nx - referenceHit.nx) < 1e-6, `nx ${dynamicHit.nx} vs ${referenceHit.nx}`);
    assert.ok(Math.abs(dynamicHit.ny - referenceHit.ny) < 1e-6);
    assert.ok(Math.abs(dynamicHit.nz - referenceHit.nz) < 1e-6);

    // The collider follows its mesh without a rebuild: moving it moves the hit.
    mesh.position.set(30, 1, 0);
    mesh.updateMatrixWorld(true);
    refreshDynamicMeshCollider(dynamic);
    const movedHit = createHit();
    const movedReference = createHit();
    assert.equal(raycastStaticMeshCollider(dynamic, origin, direction, 60, movedHit), true);
    assert.equal(raycastStaticMeshCollider(createStaticMeshCollider(mesh), origin, direction, 60, movedReference), true);
    assert.ok(movedHit.distance > dynamicHit.distance + 10, `moved to ${movedHit.distance}`);
    assert.ok(Math.abs(movedHit.distance - movedReference.distance) < 1e-6);
});

test('arena raycast returns the nearest obstacle with its source mesh name', () => {
    const nearMesh = boxMesh(4, 4, 4, [10, 0, 0]);
    const farMesh = boxMesh(4, 4, 4, [30, 0, 0]);
    const obstacles = [
        meshObstacle(farMesh, createStaticMeshCollider(farMesh), 'Tower_Leg_B_Lower'),
        meshObstacle(nearMesh, createStaticMeshCollider(nearMesh), 'Tower_Leg_A_Lower'),
    ];
    const collision = new ArenaCollision({ bounds: OPEN_BOUNDS, obstacles });

    const result = collision.raycast(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 100);
    assert.equal(result.hit, true);
    assert.equal(result.sourceName, 'Tower_Leg_A_Lower');
    assert.ok(Math.abs(result.distance - 8) < 1e-6, `distance ${result.distance}`);
    assert.equal(result.obstacle, obstacles[1]);
    assert.equal(result.kind, 'hard');

    // Shortening the ray leaves only the far obstacle out of reach as well.
    const short = collision.raycast(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 5);
    assert.equal(short.hit, false);
    assert.equal(short.sourceName, '');
    assert.equal(short.obstacle, null);
});

test('arena raycast answers box-only obstacles at the aabb entry and ignores junk input', () => {
    const obstacles = [
        {
            box: new THREE.Box3(new THREE.Vector3(4, -2, -2), new THREE.Vector3(6, 2, 2)),
            isWall: true,
            sourceName: 'plain_wall',
        },
        { box: null },
        null,
    ];
    const collision = new ArenaCollision({ bounds: OPEN_BOUNDS, obstacles });

    const result = collision.raycast(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 50);
    assert.equal(result.hit, true);
    assert.equal(result.kind, 'wall');
    assert.equal(result.isWall, true);
    assert.equal(result.sourceName, 'plain_wall');
    assert.ok(Math.abs(result.distance - 4) < 1e-9);
    assert.ok(Math.abs(result.normal.x + 1) < 1e-9, `normal.x ${result.normal.x}`);
    assert.ok(Math.abs(result.point.x - 4) < 1e-9);

    assert.equal(collision.raycast(null, new THREE.Vector3(1, 0, 0), 50).hit, false);
    assert.equal(collision.raycast(new THREE.Vector3(), null, 50).hit, false);
    assert.equal(collision.raycast(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0).hit, false);
    assert.equal(new ArenaCollision({ bounds: OPEN_BOUNDS }).raycast(
        new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 50,
    ).hit, false);
});

test('tunnel and tube obstacles let the ray pass instead of blocking it by their box', () => {
    // The muzzle stands inside the tunnel's box. Answering that box would report a hit at
    // distance 0 and swallow every shot fired from inside the tunnel.
    const tunnel = {
        box: new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10)),
        kind: 'hard',
        tunnel: { radius: 8, axis: 'x', cx: 0, cy: 0, cz: 0 },
        sourceName: 'tunnel_ring',
    };
    const wall = {
        box: new THREE.Box3(new THREE.Vector3(40, -10, -10), new THREE.Vector3(44, 10, 10)),
        kind: 'hard',
        sourceName: 'Tower_Leg_A_Lower',
    };
    const collision = new ArenaCollision({ bounds: OPEN_BOUNDS, obstacles: [tunnel, wall] });

    const result = collision.raycast(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 100);
    assert.equal(result.hit, true);
    assert.equal(result.sourceName, 'Tower_Leg_A_Lower', 'the tunnel must not swallow the shot');
    assert.ok(Math.abs(result.distance - 40) < 1e-9, `distance ${result.distance}`);

    // A tube - the ring wall of a standalone tunnel - is passed through the same way.
    const tube = {
        box: new THREE.Box3(new THREE.Vector3(10, -6, -6), new THREE.Vector3(30, 6, 6)),
        kind: 'hard',
        tube: { ax: 10, ay: 0, az: 0, bx: 30, by: 0, bz: 0, innerRadius: 4, outerRadius: 6, lengthSq: 400 },
        sourceName: 'ring_tube',
    };
    const throughTube = new ArenaCollision({ bounds: OPEN_BOUNDS, obstacles: [tube, wall] })
        .raycast(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 100);
    assert.equal(throughTube.sourceName, 'Tower_Leg_A_Lower');
    assert.ok(Math.abs(throughTube.distance - 40) < 1e-9);

    // With nothing but the hollow shapes in the way the ray reports no hit at all.
    assert.equal(
        new ArenaCollision({ bounds: OPEN_BOUNDS, obstacles: [tunnel, tube] })
            .raycast(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 100).hit,
        false,
    );
});

test('foam still blocks the ray, because soft cover is cover', () => {
    const foam = {
        box: new THREE.Box3(new THREE.Vector3(12, -6, -6), new THREE.Vector3(16, 6, 6)),
        kind: 'foam',
        sourceName: 'foam_block',
    };
    const wall = {
        box: new THREE.Box3(new THREE.Vector3(40, -10, -10), new THREE.Vector3(44, 10, 10)),
        kind: 'hard',
        sourceName: 'stone_wall',
    };
    const collision = new ArenaCollision({ bounds: OPEN_BOUNDS, obstacles: [wall, foam] });

    const result = collision.raycast(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 100);
    assert.equal(result.hit, true);
    assert.equal(result.kind, 'foam');
    assert.equal(result.sourceName, 'foam_block');
    assert.ok(Math.abs(result.distance - 12) < 1e-9, `distance ${result.distance}`);
});

test('a dynamic obstacle answers through the arena raycast with its source name', () => {
    const mesh = boxMesh(2, 2, 2, [12, 0, 0], { rotationY: Math.PI / 6, scale: [2, 2, 2] });
    const collider = createDynamicMeshCollider(mesh);
    const obstacle = meshObstacle(mesh, collider, 'Tower_Leg_C_Mid');
    const far = boxMesh(4, 4, 4, [40, 0, 0]);
    const obstacles = [meshObstacle(far, createStaticMeshCollider(far), 'Tower_Shaft_01'), obstacle];
    const collision = new ArenaCollision({ bounds: OPEN_BOUNDS, obstacles });

    const origin = new THREE.Vector3(0, 0, 0);
    const direction = new THREE.Vector3(1, 0, 0);
    const first = collision.raycast(origin, direction, 100);
    assert.equal(first.hit, true);
    assert.equal(first.sourceName, 'Tower_Leg_C_Mid');
    assert.equal(first.obstacle, obstacle);
    assert.ok(first.distance > 8 && first.distance < 12, `distance ${first.distance}`);

    // Once the animated part has moved away, the static obstacle behind it answers.
    mesh.position.set(-40, 0, 0);
    mesh.updateMatrixWorld(true);
    refreshDynamicMeshCollider(collider, obstacle.box);
    const second = collision.raycast(origin, direction, 100);
    assert.equal(second.sourceName, 'Tower_Shaft_01');
    assert.ok(Math.abs(second.distance - 38) < 1e-6, `distance ${second.distance}`);
});

test('a ray parallel to a slab does not produce a phantom hit', () => {
    const obstacles = [{
        box: new THREE.Box3(new THREE.Vector3(-5, 20, -5), new THREE.Vector3(5, 24, 5)),
        sourceName: 'ceiling',
    }];
    const collision = new ArenaCollision({ bounds: OPEN_BOUNDS, obstacles });

    // Travelling along +X at y = 0 never enters a box that starts at y = 20.
    assert.equal(collision.raycast(new THREE.Vector3(-50, 0, 0), new THREE.Vector3(1, 0, 0), 200).hit, false);
    // Straight up through it does.
    const up = collision.raycast(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 200);
    assert.equal(up.hit, true);
    assert.ok(Math.abs(up.distance - 20) < 1e-9);
});

test('getCollisionInfo reports the source mesh name and clears it for arena walls', () => {
    const mesh = boxMesh(4, 4, 4, [0, 0, 0]);
    const obstacles = [meshObstacle(mesh, createStaticMeshCollider(mesh), 'Tower_Shaft_01')];
    const arena = {
        bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50, minZ: -50, maxZ: 50 },
        obstacles,
        openFaces: null,
    };
    const collision = new ArenaCollision(arena);

    const meshHit = collision.getCollisionInfo(new THREE.Vector3(0, 0, 0), 0.5);
    assert.equal(meshHit?.hit, true);
    assert.equal(meshHit?.sourceName, 'Tower_Shaft_01');
    assert.equal(meshHit?.obstacle, obstacles[0]);

    const wallHit = collision.getCollisionInfo(new THREE.Vector3(49.9, 0, 0), 0.5);
    assert.equal(wallHit?.kind, 'wall');
    assert.equal(wallHit?.sourceName, '');
    assert.equal(wallHit?.obstacle, null);
});

test('box obstacles without a mesh collider still carry their source name', () => {
    const obstacles = [{
        box: new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
        kind: 'hard',
        isWall: false,
        sourceName: 'authored_block',
    }];
    const collision = new ArenaCollision({ bounds: OPEN_BOUNDS, obstacles });
    const hit = collision.getCollisionInfo(new THREE.Vector3(0.5, 0, 0), 0.2);
    assert.equal(hit?.sourceName, 'authored_block');
});
