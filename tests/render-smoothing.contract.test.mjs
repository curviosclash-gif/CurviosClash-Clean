import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { RenderQualityController } from '../src/core/renderer/RenderQualityController.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { Trail } from '../src/entities/Trail.js';
import { PlayerView } from '../src/entities/player/PlayerView.js';

test('render-only trail head follows the visible pose without registering collision data', () => {
    const added = [];
    const removed = [];
    let collisionRegistrations = 0;
    let collisionData = null;
    const renderer = {
        addToScene(object) { added.push(object); },
        removeFromScene(object) { removed.push(object); },
    };
    const entityManager = {
        entityRuntimeConfig: {
            TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: 4, UPDATE_INTERVAL: 0.07, GAP_CHANCE: 0, GAP_DURATION: 0.5 },
            HUNT: { TRAIL_SEGMENT_HP: 3 },
        },
        getTrailSpatialIndex() {
            return {
                registerTrailSegment(_playerIndex, _segmentIndex, data) {
                    collisionRegistrations += 1;
                    collisionData = data;
                    return { key: 'segment', entry: data };
                },
                unregisterTrailSegment() {},
            };
        },
    };
    const trail = new Trail(renderer, 0x33aaff, 0, entityManager);
    assert.equal(trail.mesh.count, 0);
    assert.equal(trail.glowMesh.count, 0);
    trail.setVisualRearOffset(1);
    trail._setLastPosition(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));

    assert.equal(trail.updateVisualHead(
        new THREE.Vector3(2, 0, 0),
        new THREE.Vector3(1, 0, 0)
    ), true);
    assert.equal(trail.headMesh.visible, true);
    assert.equal(trail.glowHeadMesh.visible, true);
    assert.ok(trail.glowHeadMesh.scale.x > trail.headMesh.scale.x);
    assert.equal(trail.headMesh.scale.y, 2);
    assert.equal(trail.headMesh.geometry.parameters.radiusTop, 1);
    assert.equal(trail.headMesh.geometry.parameters.radiusBottom, 1);
    assert.equal(trail.headMesh.geometry.parameters.openEnded, true);
    assert.equal(trail.mesh.geometry.parameters.openEnded, true);
    assert.equal(trail.lastVisualX, -1);
    assert.equal(trail.segmentCount, 0);
    assert.equal(collisionRegistrations, 0);

    trail._addSegment(0, 0, 0, 2, 0, 0);
    assert.deepEqual(trail.mesh.instanceMatrix.updateRanges, [{ start: 0, count: 16 }]);
    assert.deepEqual(trail.glowMesh.instanceMatrix.updateRanges, [{ start: 0, count: 16 }]);
    const visualMatrix = new THREE.Matrix4();
    const visualMidpoint = new THREE.Vector3();
    trail.mesh.getMatrixAt(0, visualMatrix);
    visualMidpoint.setFromMatrixPosition(visualMatrix);
    assert.equal(visualMidpoint.x, 0);
    assert.equal(collisionData.midX, 1);
    assert.equal(collisionData.fromX, 0);
    assert.equal(collisionData.toX, 2);

    trail.forceGap(0.5);
    assert.equal(trail.headMesh.visible, false);
    trail.clear();
    assert.equal(trail.mesh.count, 0);
    assert.deepEqual(trail.mesh.instanceMatrix.updateRanges, []);
    assert.deepEqual(trail.glowMesh.instanceMatrix.updateRanges, []);
    trail.dispose();
    assert.equal(added.length, 4);
    assert.equal(removed.length, 4);
});

test('cinematic replay trail rebuilds visible segments without collision or gameplay side effects', () => {
    let collisionRegistrations = 0;
    let gameplayEvents = 0;
    const trail = new Trail({
        addToScene() {},
        removeFromScene() {},
    }, 0x33aaff, 0, {
        entityRuntimeConfig: {
            TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: 4, UPDATE_INTERVAL: 0.07, GAP_CHANCE: 0, GAP_DURATION: 0.5 },
            HUNT: { TRAIL_SEGMENT_HP: 3 },
        },
        onArcadeGameplayEvent() {},
        _emitArcadeGameplayEvent() {
            gameplayEvents += 1;
        },
        getTrailSpatialIndex() {
            return {
                registerTrailSegment() {
                    collisionRegistrations += 1;
                    return { key: 'segment', entry: {} };
                },
                unregisterTrailSegment() {},
            };
        },
    });
    const forward = new THREE.Vector3(1, 0, 0);

    trail.updateReplayVisual(
        0.07,
        new THREE.Vector3(0, 0, 0),
        forward,
        { discontinuity: true }
    );
    trail.updateReplayVisual(0.07, new THREE.Vector3(2, 0, 0), forward);

    assert.equal(trail.segmentCount, 1);
    assert.equal(trail.mesh.count, 1);
    assert.equal(trail.headMesh.visible, true);
    assert.equal(collisionRegistrations, 0);
    assert.equal(gameplayEvents, 0);

    trail.dispose();
});

test('render-only trail head stays continuous across a sharp visual direction change', () => {
    const trail = new Trail({
        addToScene() {},
        removeFromScene() {},
    }, 0x33aaff, 0, {
        entityRuntimeConfig: {
            TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: 4, UPDATE_INTERVAL: 0.07, GAP_CHANCE: 0, GAP_DURATION: 0.5 },
            HUNT: { TRAIL_SEGMENT_HP: 3 },
        },
    });
    trail._setLastPosition(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));

    assert.equal(trail.updateVisualHead(
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(1, 0, 0)
    ), true);
    assert.equal(trail.headMesh.visible, true);

    trail.dispose();
});

test('committing a trail segment keeps the visual head in front of the interpolated pose', () => {
    let collisionData = null;
    const trail = new Trail({
        addToScene() {},
        removeFromScene() {},
    }, 0x33aaff, 0, {
        entityRuntimeConfig: {
            TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: 4, UPDATE_INTERVAL: 0.07, GAP_CHANCE: 0, GAP_DURATION: 0.5 },
            HUNT: { TRAIL_SEGMENT_HP: 3 },
        },
        getTrailSpatialIndex() {
            return {
                registerTrailSegment(_playerIndex, _segmentIndex, data) {
                    collisionData = data;
                    return { key: 'segment', entry: data };
                },
                unregisterTrailSegment() {},
            };
        },
    });
    const forward = new THREE.Vector3(1, 0, 0);

    trail.update(0.07, new THREE.Vector3(0, 0, 0), forward);
    trail.update(1 / 60, new THREE.Vector3(1, 0, 0), forward);
    trail.update(0.06, new THREE.Vector3(2, 0, 0), forward);

    assert.equal(trail.lastVisualX, 1);
    assert.equal(collisionData.toX, 2);
    assert.equal(trail.updateVisualHead(new THREE.Vector3(1.25, 0, 0), forward), true);
    assert.equal(trail.headMesh.visible, true);

    const visualMatrix = new THREE.Matrix4();
    const visualMidpoint = new THREE.Vector3();
    trail.mesh.getMatrixAt(0, visualMatrix);
    visualMidpoint.setFromMatrixPosition(visualMatrix);
    assert.equal(visualMidpoint.x, 0.5);

    trail.dispose();
});

test('entity render phase forwards display delta only to living vehicle visuals', () => {
    const calls = [];
    const createPlayer = (alive) => ({
        alive,
        view: {
            applyRenderTransform(alpha) { calls.push(['transform', alive, alpha]); },
            updateVisuals(dt) { calls.push(['visual', alive, dt]); },
        },
    });
    const manager = Object.assign(Object.create(EntityManager.prototype), {
        players: [createPlayer(true), createPlayer(false)],
    });

    manager.renderInterpolatedTransforms(0.4, 1 / 120);

    assert.deepEqual(calls, [
        ['transform', true, 0.4],
        ['visual', true, 1 / 120],
        ['transform', false, 0.4],
        ['visual', false, 0],
    ]);
});

test('async vehicle readiness refreshes loaded flame references before match use', async () => {
    let releaseVehicle;
    const ready = new Promise((resolve) => { releaseVehicle = resolve; });
    const mesh = new THREE.Group();
    mesh.localBox = new THREE.Box3(
        new THREE.Vector3(-1, -0.5, -2),
        new THREE.Vector3(1, 0.5, 2)
    );
    mesh._loaded = false;
    mesh.whenReady = () => ready;

    const player = {
        modelScale: 1,
        hitboxRadius: 1,
        hitboxBox: new THREE.Box3(),
        hitboxSize: new THREE.Vector3(),
        hitboxCenter: new THREE.Vector3(),
        _shieldBaseScale: new THREE.Vector3(1, 1, 1),
    };
    const view = new PlayerView(player, {
        removeFromScene() {},
    });
    view.group = new THREE.Group();
    view.vehicleMesh = mesh;
    view.group.add(mesh);
    view.shieldMesh = new THREE.Object3D();
    view._attachVehicleLoadedHandler(mesh);

    assert.equal(view.isReady(), false);
    assert.equal(view.flames.length, 0);

    const flame = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, 0.3),
        new THREE.MeshBasicMaterial()
    );
    flame.name = 'flame';
    mesh.add(flame);
    mesh._loaded = true;
    mesh.dispatchEvent({ type: 'loaded' });
    releaseVehicle(true);
    await view.whenReady();

    assert.equal(view.isReady(), true);
    assert.deepEqual(view.flames, [flame]);
    assert.deepEqual(player.flames, [flame]);
    view.dispose();
});

test('desktop high quality enables the high shadow preset and higher pixel density', () => {
    let configuredShadowSize = null;
    const renderer = {
        shadowMap: { enabled: false, needsUpdate: false },
    };
    const scene = {
        traverse(callback) {
            callback({
                isDirectionalLight: true,
                castShadow: true,
                shadow: {
                    map: null,
                    mapSize: {
                        width: 512,
                        height: 512,
                        set(width, height) { configuredShadowSize = [width, height]; },
                    },
                },
            });
        },
    };

    new RenderQualityController(renderer, scene);

    assert.equal(renderer.shadowMap.enabled, true);
    assert.deepEqual(configuredShadowSize, [1024, 1024]);
    assert.equal(renderer.shadowMap.needsUpdate, true);
    assert.equal(CONFIG.RENDER.MAX_PIXEL_RATIO, 1.5);
});
