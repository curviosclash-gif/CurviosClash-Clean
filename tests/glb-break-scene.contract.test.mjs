import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Arena } from '../src/entities/Arena.js';
import { createMapBreakSceneController } from '../src/entities/arena/MapBreakSceneController.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

// The map: an intact tower and an intact summit, one baked fall for the whole tower and one for
// the summit alone. 'piece_shaft' inside the toppling model is deliberately not moved by the clip
// and carries no '_dyn' marker: a break scene is turned into the direction of the hit, so even a
// mesh that never moves within the clip needs a collider that follows its model.
const DESTRUCTIBLES = {
    segments: [
        { id: 'summit', kind: 'summit', hp: 10, meshPrefixes: ['piece_summit'] },
        { id: 'leg_a', kind: 'leg_lower', hp: 40, meshPrefixes: ['tower_intact'], anchor: [10, 0, 10] },
    ],
    pieces: ['summit', 'shaft'],
    breakScenes: [
        {
            id: 'summit_fall',
            trigger: { segmentId: 'summit' },
            modelId: 'summit-fall',
            pieces: ['summit'],
            hideModelIds: ['summit-intact'],
        },
        {
            id: 'tower_topple',
            trigger: { kind: 'leg_lower' },
            modelId: 'tower-fall',
            pieces: ['summit', 'shaft'],
            hideModelIds: ['tower-intact'],
        },
    ],
};

const MODELS = [
    { id: 'tower-intact', url: '/tower-intact.glb', position: [0, 0, 0], scale: 1 },
    { id: 'summit-intact', url: '/summit-intact.glb', position: [0, 40, 0], scale: 1 },
    {
        id: 'tower-fall',
        url: '/tower-fall.glb',
        position: [30, 0, 0],
        scale: 1,
        hiddenUntilTriggered: true,
        animationClock: { mode: 'once', clipName: 'TowerFall' },
    },
    { id: 'summit-fall', url: '/summit-fall.glb', position: [60, 0, 0], scale: 1, hiddenUntilTriggered: true },
];

const BOUNDS = { minX: -500, maxX: 500, minY: -500, maxY: 500, minZ: -500, maxZ: 500 };
const TOPPLE_EVENT = { segmentId: 'leg_a', kind: 'leg_lower', atSeconds: 10, yaw: Math.PI / 2 };
const SUMMIT_EVENT = { segmentId: 'summit', kind: 'summit', atSeconds: 6, yaw: 0 };

function box(name, size, position = [0, 0, 0]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    return mesh;
}

// The fall clip slides 'piece_summit' eight units along X over four seconds, so the pose alone
// says how far into the collapse the map stands.
function createBreakSceneLoader() {
    return {
        async loadAsync(url) {
            const scene = new THREE.Group();
            if (url.includes('tower-intact')) {
                scene.add(box('tower_intact_box', 4));
                return { scene, animations: [] };
            }
            if (url.includes('summit-intact')) {
                scene.add(box('summit_intact_box', 2));
                return { scene, animations: [] };
            }
            if (url.includes('summit-fall')) {
                scene.add(box('piece_summit_debris', 2));
                return { scene, animations: [] };
            }
            scene.add(box('piece_summit', 2));
            scene.add(box('piece_shaft', 4, [0, 0, 12]));
            return {
                scene,
                animations: [
                    new THREE.AnimationClip('TowerFall', 4, [
                        new THREE.NumberKeyframeTrack('piece_summit.position[x]', [0, 4], [0, 8]),
                    ]),
                ],
            };
        },
    };
}

/** Enough obstacles that the collision grid is used, far outside everything the test probes. */
function paddingObstacles() {
    return Array.from({ length: 14 }, (_value, index) => ({
        box: new THREE.Box3(
            new THREE.Vector3(400 + index * 4, 400, 400),
            new THREE.Vector3(401 + index * 4, 401, 401),
        ),
        isWall: false,
        kind: 'hard',
    }));
}

/**
 * Wires a loaded collection onto a fresh arena exactly the way Arena.build does once the GLB
 * load resolves, including the events that arrived while it was still loading.
 */
function attachCollection(arena, result) {
    arena._glbScene = result.scene;
    arena._glbAnimation.setTracks(result.animationTracks);
    arena.obstacles.push(...paddingObstacles(), ...result.colliders);
    arena._glbDynamicObstacles = result.colliders.filter((obstacle) => obstacle.dynamic);
    arena._mapBreakScenes = createMapBreakSceneController(
        arena,
        result.colliders,
        arena._glbAnimation,
        arena._pendingMapBreakEvents,
    );
    arena.update(0);
    return arena;
}

async function createBrokenTowerArena({ eventsBeforeLoad = null } = {}) {
    const result = await loadGLBMapCollection(MODELS, { loader: createBreakSceneLoader() });
    const arena = new Arena({ addToScene() {}, removeFromScene() {} });
    arena._portalGateSystem.update = () => {};
    arena.currentMapDefinition = { destructibles: DESTRUCTIBLES };
    arena.bounds = { ...BOUNDS };
    arena.openFaces = [];
    if (eventsBeforeLoad) arena.applyMapDestructibleEvents(eventsBeforeLoad);
    attachCollection(arena, result);
    return { arena, result };
}

function slot(arena, modelId) {
    return arena._glbScene.getObjectByName(`glb-slot-${modelId}`);
}

function meshCentre(arena, name) {
    const mesh = arena._glbScene.getObjectByName(name);
    arena._glbScene.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
}

function hitName(arena, position) {
    return arena.getCollisionInfo(position, 0.4)?.sourceName ?? null;
}

test('a break scene model is loaded but neither drawn nor solid before its event', async () => {
    const { arena, result } = await createBrokenTowerArena();

    assert.equal(slot(arena, 'tower-intact').visible, true);
    assert.equal(slot(arena, 'tower-fall').visible, false);
    assert.equal(slot(arena, 'summit-fall').visible, false);
    // Every collider knows which model it came from; that is what makes switching possible.
    assert.deepEqual(
        [...new Set(result.colliders.map((collider) => collider.modelId))].sort(),
        ['summit-fall', 'summit-intact', 'tower-fall', 'tower-intact'],
    );
    // Every collider of a break scene follows its model, including the meshes the clip never
    // moves - the intact models keep the cheaper baked colliders.
    const dynamicByModel = new Map(result.colliders.map(
        (collider) => [`${collider.modelId}/${collider.sourceName}`, !!collider.dynamic],
    ));
    assert.equal(dynamicByModel.get('tower-fall/piece_shaft'), true);
    assert.equal(dynamicByModel.get('summit-fall/piece_summit_debris'), true);
    assert.equal(dynamicByModel.get('tower-intact/tower_intact_box'), false);

    assert.equal(hitName(arena, meshCentre(arena, 'tower_intact_box')), 'tower_intact_box');
    assert.equal(hitName(arena, meshCentre(arena, 'piece_shaft')), null);
    assert.equal(hitName(arena, meshCentre(arena, 'piece_summit_debris')), null);

    disposeObject3DResources(result.scene);
});

test('a break event swaps the intact tower for its baked fall, turned into the hit', async () => {
    const { arena, result } = await createBrokenTowerArena();
    const intactCentre = meshCentre(arena, 'tower_intact_box');
    // Where the unmoved shaft sat before the scene was turned - nothing may be left there.
    const uprightShaftCentre = meshCentre(arena, 'piece_shaft');

    arena.applyMapDestructibleEvents([TOPPLE_EVENT]);
    arena.update(0);

    assert.equal(slot(arena, 'tower-intact').visible, false);
    assert.equal(hitName(arena, intactCentre), null, 'the intact tower must not keep blocking');
    assert.equal(slot(arena, 'tower-fall').visible, true);
    assert.equal(slot(arena, 'tower-fall').rotation.y, Math.PI / 2);

    const toppledShaftCentre = meshCentre(arena, 'piece_shaft');
    assert.ok(
        toppledShaftCentre.distanceTo(uprightShaftCentre) > 1,
        'the quarter turn must actually move the shaft',
    );
    assert.equal(hitName(arena, toppledShaftCentre), 'piece_shaft');
    assert.equal(hitName(arena, uprightShaftCentre), null, 'no ghost wall at the upright place');

    disposeObject3DResources(result.scene);
});

test('a corrected event list is replayed instead of being appended to', async () => {
    const { arena, result } = await createBrokenTowerArena();
    const summit = () => arena._glbScene.getObjectByName('piece_summit');

    arena.applyMapDestructibleEvents([{ segmentId: 'leg_a', kind: 'leg_lower', atSeconds: 5, yaw: 0 }]);
    arena.update(0);
    assert.equal(slot(arena, 'tower-fall').rotation.y, 0);

    // A list of the same length, but a different break: the old scene has to be undone first.
    arena.applyMapDestructibleEvents([{ segmentId: 'leg_b', kind: 'leg_lower', atSeconds: 9, yaw: Math.PI }]);
    arena.setGlbAnimationElapsedSeconds(11);
    arena.update(0);

    assert.equal(arena._mapBreakScenes.appliedSceneCount, 1);
    assert.equal(slot(arena, 'tower-fall').rotation.y, Math.PI);
    assert.equal(summit().position.x, 4, 'the clip restarts at the corrected break time');

    // The same correction the other way round: a scene whose hidden models must come back.
    arena.applyMapDestructibleEvents([SUMMIT_EVENT]);
    arena.update(0);
    assert.equal(slot(arena, 'tower-intact').visible, true, 'the tower stands again');
    assert.equal(slot(arena, 'tower-fall').visible, false);
    assert.equal(slot(arena, 'summit-intact').visible, false);
    assert.equal(slot(arena, 'summit-fall').visible, true);

    disposeObject3DResources(result.scene);
});

test('the fall starts at the break, runs once and stays down', async () => {
    const { arena, result } = await createBrokenTowerArena();
    const summit = () => arena._glbScene.getObjectByName('piece_summit');

    arena.setGlbAnimationElapsedSeconds(10);
    arena.update(0);
    // Ten seconds into the round and nothing has happened yet: the intact tower stands and the
    // break scene is out of the world, whatever pose its untriggered clip happens to hold.
    assert.equal(slot(arena, 'tower-intact').visible, true);
    assert.equal(slot(arena, 'tower-fall').visible, false);

    arena.applyMapDestructibleEvents([TOPPLE_EVENT]);
    arena.update(0);
    assert.equal(summit().position.x, 0, 'the clip starts at the break, not at the round start');

    arena.setGlbAnimationElapsedSeconds(12);
    arena.update(0);
    assert.equal(summit().position.x, 4, 'two of four seconds into the fall');

    arena.setGlbAnimationElapsedSeconds(30);
    arena.update(0);
    assert.equal(summit().position.x, 8, 'a one-shot clip holds its last frame instead of looping');

    disposeObject3DResources(result.scene);
});

test('a piece that fell on its own earlier is missing from the later collapse', async () => {
    const { arena, result } = await createBrokenTowerArena();

    arena.applyMapDestructibleEvents([SUMMIT_EVENT, TOPPLE_EVENT]);
    arena.update(0);

    assert.equal(slot(arena, 'summit-fall').visible, true);
    assert.equal(slot(arena, 'tower-fall').visible, true);
    // The summit is already lying next to the tower, so the toppling tower carries none.
    assert.equal(arena._glbScene.getObjectByName('piece_summit').visible, false);
    assert.equal(hitName(arena, meshCentre(arena, 'piece_summit')), null);
    assert.equal(hitName(arena, meshCentre(arena, 'piece_shaft')), 'piece_shaft');
    assert.equal(hitName(arena, meshCentre(arena, 'piece_summit_debris')), 'piece_summit_debris');

    disposeObject3DResources(result.scene);
});

test('applying the same events again changes nothing', async () => {
    const { arena, result } = await createBrokenTowerArena();

    arena.applyMapDestructibleEvents([SUMMIT_EVENT, TOPPLE_EVENT]);
    arena.update(0);
    const obstacleCount = arena.obstacles.length;
    const revision = arena.staticCollisionRevision;

    arena.applyMapDestructibleEvents([SUMMIT_EVENT, TOPPLE_EVENT]);
    arena.applyMapDestructibleEvents([SUMMIT_EVENT, TOPPLE_EVENT]);
    arena.update(0);

    assert.equal(arena._mapBreakScenes.appliedSceneCount, 2);
    assert.equal(arena.obstacles.length, obstacleCount);
    assert.equal(arena.staticCollisionRevision, revision);
    assert.equal(slot(arena, 'tower-fall').rotation.y, Math.PI / 2);

    disposeObject3DResources(result.scene);
});

test('the round start puts an arena that was reused back together', async () => {
    const { arena, result } = await createBrokenTowerArena();
    const intactCentre = meshCentre(arena, 'tower_intact_box');
    const intactObstacleCount = arena.obstacles.length;

    arena.applyMapDestructibleEvents([SUMMIT_EVENT, TOPPLE_EVENT]);
    arena.setGlbAnimationElapsedSeconds(14);
    arena.update(0);

    arena.resetMapDestructibleScenes();
    arena.setGlbAnimationElapsedSeconds(0);
    arena.update(0);

    assert.equal(arena._mapBreakScenes.appliedSceneCount, 0);
    assert.equal(slot(arena, 'tower-intact').visible, true);
    assert.equal(slot(arena, 'tower-fall').visible, false);
    assert.equal(slot(arena, 'tower-fall').rotation.y, 0);
    assert.equal(arena._glbScene.getObjectByName('piece_summit').visible, true);
    assert.equal(arena._glbScene.getObjectByName('piece_summit').position.x, 0);
    assert.equal(arena.obstacles.length, intactObstacleCount);
    assert.equal(hitName(arena, intactCentre), 'tower_intact_box');
    assert.equal(hitName(arena, meshCentre(arena, 'piece_shaft')), null);

    disposeObject3DResources(result.scene);
});

test('events that arrive while the models are still loading are not lost', async () => {
    const { arena, result } = await createBrokenTowerArena({ eventsBeforeLoad: [TOPPLE_EVENT] });

    assert.equal(arena._mapBreakScenes.appliedSceneCount, 1);
    assert.equal(slot(arena, 'tower-intact').visible, false);
    assert.equal(slot(arena, 'tower-fall').visible, true);
    assert.equal(slot(arena, 'tower-fall').rotation.y, Math.PI / 2);
    assert.equal(hitName(arena, meshCentre(arena, 'piece_shaft')), 'piece_shaft');

    disposeObject3DResources(result.scene);
});
