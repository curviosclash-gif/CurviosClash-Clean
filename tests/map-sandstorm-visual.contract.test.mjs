import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { resolveSandstormLighting } from '../src/core/renderer/SandstormLightingOps.js';
import { MapSandstormVisualController } from '../src/entities/effects/MapSandstormVisualController.js';

// The pyramid arena at MAP_SCALE 3: 780 x 480 x 780 world units, a 12 unit outdoor storm view.
const MAP_SIZE = [260, 160, 260];
const SCALE = 3;
const OPTIONS = { warningSeconds: 20, outdoorFar: 12 };

function createController(cameraPositions) {
    const cameras = cameraPositions.map((position) => {
        const camera = new THREE.PerspectiveCamera();
        camera.position.set(...position);
        camera.userData.sandstormVisibilityRange = 12;
        return camera;
    });
    const renderer = { cameras, addToScene() {}, removeFromScene() {} };
    const controller = new MapSandstormVisualController(renderer);
    controller.build(MAP_SIZE, SCALE, OPTIONS);
    return { controller, cameras };
}

const active = (intensity) => ({ enabled: true, phase: 'ACTIVE', remainingSeconds: 40, intensity });
const warning = (remainingSeconds) => ({ enabled: true, phase: 'WARNING', remainingSeconds, intensity: 0 });

function dustPositions(mesh) {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const out = [];
    for (let index = 0; index < mesh.count; index += 1) {
        mesh.getMatrixAt(index, matrix);
        out.push(position.setFromMatrixPosition(matrix).clone());
    }
    return out;
}

test('dust flies around every player camera, where the storm view can see it', () => {
    // Spread over the whole 780 m arena, a 12 m fog showed statistically no streak at all.
    const { controller, cameras } = createController([[300, 400, -200], [-150, 20, 250]]);
    controller.update(1 / 60, active(1), [1, 0]);
    const views = controller.getDustMeshes();
    assert.equal(views.length, 2, 'one dust cloud per camera');
    views.forEach((mesh, index) => {
        assert.ok(mesh.visible && mesh.count > 0);
        for (const point of dustPositions(mesh)) {
            assert.ok(point.distanceTo(cameras[index].position) < 30,
                `streak ${point.toArray()} stays near camera ${index}, even near the ceiling`);
        }
    });
    cameras[0].position.set(0, 50, 0);
    controller.update(1 / 60, active(1), [1, 0]);
    assert.ok(dustPositions(views[0]).every((point) => point.distanceTo(cameras[0].position) < 30),
        'the cloud follows its camera');
});

test('streaks point along the wind for every direction', () => {
    const { controller } = createController([[0, 20, 0]]);
    const matrix = new THREE.Matrix4();
    const axis = new THREE.Vector3();
    for (const direction of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        controller.update(1 / 60, active(1), direction);
        const mesh = controller.getDustMeshes()[0];
        mesh.getMatrixAt(0, matrix);
        axis.setFromMatrixColumn(matrix, 0).normalize();
        assert.ok(Math.abs(axis.x * direction[0] + axis.z * direction[1]) > 0.99,
            `streak axis ${axis.toArray()} follows wind ${direction}`);
    }
});

test('the storm front reaches the ceiling and fades out without a jump when the storm arrives', () => {
    const { controller } = createController([[0, 20, 0]]);
    const opacities = [];
    for (let remaining = 20; remaining >= 0; remaining -= 0.5) {
        controller.update(0.5, warning(remaining), [1, 0]);
        opacities.push(controller.getFrontOpacity());
    }
    for (let intensity = 0; intensity <= 1.0001; intensity += 0.025) {
        controller.update(0.5, active(intensity), [1, 0]);
        opacities.push(controller.getFrontOpacity());
    }
    for (let index = 1; index < opacities.length; index += 1) {
        assert.ok(Math.abs(opacities[index] - opacities[index - 1]) < 0.06,
            `front opacity jumps from ${opacities[index - 1]} to ${opacities[index]}`);
    }
    assert.equal(opacities.at(-1), 0, 'at the peak the front has dissolved into the storm');
    const front = controller.getFrontLayers()[0];
    front.geometry.computeBoundingBox();
    const top = front.position.y + front.geometry.boundingBox.max.y;
    assert.ok(top >= MAP_SIZE[1] * SCALE, `front top ${top} reaches the ${MAP_SIZE[1] * SCALE} ceiling`);
    assert.ok(controller.getFrontLayers().length >= 2, 'the front has depth');
});

test('dust thins out inside a shelter and the warning length is not hard-coded', () => {
    const { controller, cameras } = createController([[0, 20, 0], [100, 20, 0]]);
    cameras[1].userData.sandstormVisibilityRange = 85;
    controller.update(1 / 60, active(1), [1, 0]);
    const [outside, inside] = controller.getDustMeshes();
    assert.ok(inside.material.opacity < outside.material.opacity * 0.5, 'shelter keeps the dust out');

    const short = new MapSandstormVisualController({ cameras: [], addToScene() {}, removeFromScene() {} });
    short.build(MAP_SIZE, SCALE, { warningSeconds: 10, outdoorFar: 12 });
    short.update(0, warning(0.01), [1, 0]);
    const nearlyArrived = short.getFrontOpacity();
    short.update(0, warning(9.99), [1, 0]);
    assert.ok(nearlyArrived > short.getFrontOpacity() + 0.2, 'a 10 s warning ramps over its own 10 s');
});

test('at its peak the storm sky and upper fog read as sand, not as a dark lid', () => {
    const clear = {
        key: { color: 0xffffff, intensity: 2 }, fill: { color: 0xffffff, intensity: 1 },
        rim: { color: 0xffffff, intensity: 1 }, hemisphere: { skyColor: 0xffffff, groundColor: 0xffffff },
        fog: { color: 0xffffff, colorHigh: 0xffffff, colorLow: 0xffffff },
        skyDome: { zenithColor: 0x356d99, horizonColor: 0xd6ad73, nadirColor: 0x6b432a },
    };
    const storm = resolveSandstormLighting(clear, 1);
    const distance = (a, b) => Math.max(...[16, 8, 0].map((shift) => Math.abs(((a >> shift) & 255) - ((b >> shift) & 255))));
    assert.ok(distance(storm.skyDome.zenithColor, storm.fog.color) <= 0x30, 'zenith close to the storm colour');
    assert.ok(distance(storm.fog.colorHigh, storm.fog.color) <= 0x30, 'upper fog close to the storm colour');
});
