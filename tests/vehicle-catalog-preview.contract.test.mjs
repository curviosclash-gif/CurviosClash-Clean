import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import {
    createVehicleCatalogPreview3d,
    disposeVehicleCatalogPreviewObject,
    fitVehicleCatalogPreviewObject,
    resolveHangarPartPreviewRadius,
} from '../src/ui/arcade/vehicle-manager/VehicleCatalogPreview3d.js';

test('part preview keeps tier size differences within safe framing', () => {
    const radii = [0.78, 1.04, 1.34].map((sizeScale) => (
        resolveHangarPartPreviewRadius({ appearance: { sizeScale } })
    ));
    assert.ok(radii[0] < radii[1] && radii[1] < radii[2]);
    assert.ok(radii.every((radius) => radius >= 0.84 && radius <= 1.14));
});

test('vehicle catalog preview centers and uniformly fits irregular vehicle meshes', () => {
    const root = new THREE.Group();
    root.rotation.y = 0.73;
    const vehicle = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshBasicMaterial());
    mesh.position.set(5, -2, 3);
    vehicle.add(mesh);
    root.add(vehicle);

    assert.equal(fitVehicleCatalogPreviewObject(vehicle, root, 1.15), true);
    assert.equal(root.rotation.y, 0.73);
    root.rotation.y = 0;
    const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
    assert.ok(sphere.center.length() < 1e-6);
    assert.ok(Math.abs(sphere.radius - 1.15) < 1e-6);
    assert.equal(root.scale.x, root.scale.y);
    assert.equal(root.scale.y, root.scale.z);

    mesh.geometry.dispose();
    mesh.material.dispose();
});

test('vehicle catalog preview renders visible cards with one renderer and releases lifecycle resources', () => {
    const frameCallbacks = new Map();
    const cancelledFrames = [];
    let nextFrameId = 1;
    let observerCallback = null;
    let observerDisconnected = false;
    const observed = [];
    const unobserved = [];
    const documentListeners = new Map();
    const motionListeners = new Map();
    const renderAngles = [];
    let rendererDisposed = false;
    let contextLost = false;
    let vehicleDisposed = false;
    let partAssemblyDisposed = false;
    let requestedPartId = '';
    let vehicleColor = 0;
    let tickCount = 0;
    let drawCount = 0;

    const renderer = {
        domElement: {},
        setPixelRatio() {},
        setSize() {},
        render(scene) {
            const root = scene.children.find((child) => child.name === 'VehicleCatalogPreview:aircraft' && child.visible);
            if (root) renderAngles.push(root.rotation.y);
        },
        dispose() { rendererDisposed = true; },
        forceContextLoss() { contextLost = true; },
    };
    const documentRef = {
        visibilityState: 'visible',
        createElement() { return partCanvas; },
        addEventListener(type, listener) { documentListeners.set(type, listener); },
        removeEventListener(type, listener) {
            if (documentListeners.get(type) === listener) documentListeners.delete(type);
        },
    };
    const motionQuery = {
        matches: false,
        addEventListener(type, listener) { motionListeners.set(type, listener); },
        removeEventListener(type, listener) {
            if (motionListeners.get(type) === listener) motionListeners.delete(type);
        },
    };
    const canvas = {
        dataset: {},
        getContext() {
            return {
                clearRect() {},
                drawImage() { drawCount += 1; },
            };
        },
    };
    const partCanvas = {
        dataset: {},
        setAttribute() {},
        getContext() {
            return {
                clearRect() {},
                drawImage() { drawCount += 1; },
            };
        },
    };
    const partCard = {
        appended: null,
        classList: { add() {} },
        appendChild(node) { this.appended = node; },
    };
    const vehicle = new THREE.Group();
    vehicle.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3), new THREE.MeshBasicMaterial()));
    vehicle.tick = () => { tickCount += 1; };
    vehicle.dispose = () => { vehicleDisposed = true; };
    const partNode = new THREE.Group();
    partNode.add(new THREE.Mesh(new THREE.OctahedronGeometry(), new THREE.MeshBasicMaterial()));
    const partAssembly = {
        createPreviewPartNode(part) {
            requestedPartId = part.id;
            return partNode;
        },
        dispose() {
            partAssemblyDisposed = true;
            partNode.children[0].geometry.dispose();
            partNode.children[0].material.dispose();
        },
    };

    const preview = createVehicleCatalogPreview3d({
        rendererFactory: () => renderer,
        createVehicle: (_vehicleId, color) => {
            vehicleColor = color;
            return vehicle;
        },
        color: '#123abc',
        partAssembly,
        documentRef,
        motionQuery,
        requestAnimationFrame(callback) {
            const id = nextFrameId;
            nextFrameId += 1;
            frameCallbacks.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) {
            cancelledFrames.push(id);
            frameCallbacks.delete(id);
        },
        intersectionObserverFactory(callback) {
            observerCallback = callback;
            return {
                observe(target) { observed.push(target); },
                unobserve(target) { unobserved.push(target); },
                disconnect() { observerDisconnected = true; },
            };
        },
    });

    preview.attach(canvas, 'aircraft');
    preview.attachPartCard(partCard, { id: 'stone_blue_t1', appearance: { sizeScale: 0.78 } });
    assert.equal(preview.available, true);
    assert.equal(vehicleColor, 0);
    assert.deepEqual(observed, [canvas, partCanvas]);
    assert.equal(partCard.appended, partCanvas);
    assert.equal(frameCallbacks.size, 0);

    observerCallback([
        { target: canvas, isIntersecting: true },
        { target: partCanvas, isIntersecting: true },
    ]);
    assert.equal(vehicleColor, 0x123abc);
    assert.equal(requestedPartId, 'stone_blue_t1');
    const firstFrame = frameCallbacks.entries().next().value;
    frameCallbacks.delete(firstFrame[0]);
    firstFrame[1](100);
    const secondFrame = frameCallbacks.entries().next().value;
    frameCallbacks.delete(secondFrame[0]);
    secondFrame[1](160);

    assert.equal(drawCount, 4);
    assert.equal(tickCount, 2);
    assert.equal(canvas.dataset.previewStatus, 'ready');
    assert.equal(partCanvas.dataset.previewStatus, 'ready');
    assert.equal(renderAngles.length, 2);
    assert.ok(renderAngles[1] > renderAngles[0]);

    preview.dispose();
    assert.deepEqual(unobserved, [canvas, partCanvas]);
    assert.equal(observerDisconnected, true);
    assert.equal(vehicleDisposed, true);
    assert.equal(partAssemblyDisposed, true);
    assert.equal(rendererDisposed, true);
    assert.equal(contextLost, true);
    assert.ok(cancelledFrames.length > 0);
    assert.equal(documentListeners.size, 0);
    assert.equal(motionListeners.size, 0);
});

test('vehicle catalog preview disposes pending generic mesh resources', () => {
    const vehicle = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    let cancelled = false;
    let geometryDisposed = false;
    let materialDisposed = false;
    geometry.addEventListener('dispose', () => { geometryDisposed = true; });
    material.addEventListener('dispose', () => { materialDisposed = true; });
    vehicle.cancelPendingLoad = () => { cancelled = true; };
    vehicle.add(new THREE.Mesh(geometry, material));

    disposeVehicleCatalogPreviewObject(vehicle);

    assert.equal(cancelled, true);
    assert.equal(geometryDisposed, true);
    assert.equal(materialDisposed, true);
});
