import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
    createEditorBuildPreviewRenderer,
    createEditorPreviewObject,
    disposeEditorPreviewObject,
    fitEditorPreviewObject,
} from '../editor/js/ui/EditorPreviewRenderer.js';

function createPrimitiveManager() {
    let registered = 0;
    let outlined = 0;
    return {
        blockGeo: new THREE.BoxGeometry(1, 1, 1),
        mats: {
            hard: new THREE.MeshLambertMaterial({ color: 0xf97373 }),
        },
        assetLoader: {
            getLoadStatus() { return { state: 'loaded' }; },
        },
        attachSelectionOutlines() { outlined += 1; },
        registerObject(object) { registered += 1; return object; },
        shouldDisposeGeometry(node) { return node.geometry?.userData?.editorOwnedResource === true; },
        shouldDisposeMaterial(node, material) { return material?.userData?.editorOwnedResource === true; },
        get mutations() { return { registered, outlined }; },
    };
}

test('preview objects use the placement mesh without registering editor state', () => {
    const manager = createPrimitiveManager();
    const object = createEditorPreviewObject(manager, {
        id: 'build-hard',
        tool: 'hard',
        subType: '',
    });

    assert.equal(object.geometry, manager.blockGeo);
    assert.equal(object.material, manager.mats.hard);
    assert.equal(object.userData.type, 'hard');
    assert.deepEqual(manager.mutations, { registered: 0, outlined: 0 });
});

test('preview fitting centers every shape and leaves rotation-safe framing space', () => {
    const object = new THREE.Mesh(
        new THREE.BoxGeometry(8, 1, 2).translate(3, 4, -2),
        new THREE.MeshBasicMaterial(),
    );
    object.rotation.set(0.35, 0.8, -0.2);
    const fitted = fitEditorPreviewObject(object);
    assert.ok(fitted);

    const sphere = new THREE.Box3().setFromObject(fitted).getBoundingSphere(new THREE.Sphere());
    assert.ok(sphere.center.length() < 1e-9);
    assert.ok(Math.abs(sphere.radius - 1) < 1e-9);

    const invalid = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    invalid.scale.x = Number.NaN;
    assert.equal(fitEditorPreviewObject(invalid), null);
});

test('preview disposal releases owned clone resources once and preserves shared primitives', () => {
    const manager = createPrimitiveManager();
    const ownedGeometry = new THREE.BoxGeometry();
    const ownedMaterial = new THREE.MeshBasicMaterial();
    ownedGeometry.userData.editorOwnedResource = true;
    ownedMaterial.userData.editorOwnedResource = true;
    let geometryDisposals = 0;
    let materialDisposals = 0;
    ownedGeometry.dispose = () => { geometryDisposals += 1; };
    ownedMaterial.dispose = () => { materialDisposals += 1; };

    const root = new THREE.Group();
    root.add(new THREE.Mesh(ownedGeometry, ownedMaterial));
    root.add(new THREE.Mesh(ownedGeometry, ownedMaterial));
    root.add(new THREE.Mesh(manager.blockGeo, manager.mats.hard));
    disposeEditorPreviewObject(root, manager);

    assert.equal(geometryDisposals, 1);
    assert.equal(materialDisposals, 1);
});

test('animated preview reuses one renderer and releases frame, observer and WebGL resources', () => {
    const manager = createPrimitiveManager();
    const renderCalls = [];
    const cancelledFrames = [];
    let pendingFrame = null;
    let observerCallback = null;
    let observerDisconnected = false;
    let rendererDisposed = false;
    let contextLost = false;
    let motionListener = null;
    const fakeRenderer = {
        domElement: {},
        setSize() {},
        setPixelRatio() {},
        setClearColor() {},
        render(scene, camera) { renderCalls.push({ scene, camera }); },
        dispose() { rendererDisposed = true; },
        forceContextLoss() { contextLost = true; },
    };
    const controller = createEditorBuildPreviewRenderer(manager, {
        rendererFactory: () => fakeRenderer,
        requestAnimationFrame(callback) { pendingFrame = callback; return 17; },
        cancelAnimationFrame(id) { cancelledFrames.push(id); pendingFrame = null; },
        intersectionObserverFactory(callback) {
            observerCallback = callback;
            return {
                observe() {},
                unobserve() {},
                disconnect() { observerDisconnected = true; },
            };
        },
        motionQuery: {
            matches: false,
            addEventListener(type, listener) { if (type === 'change') motionListener = listener; },
            removeEventListener(type, listener) {
                if (type === 'change' && motionListener === listener) motionListener = null;
            },
        },
    });
    let draws = 0;
    const canvas = {
        isConnected: true,
        getContext() {
            return { drawImage() { draws += 1; } };
        },
    };
    const entry = { id: 'build-hard', tool: 'hard', subType: '' };

    assert.equal(controller.attach(canvas, entry), true);
    assert.equal(pendingFrame, null);
    observerCallback([{ target: canvas, isIntersecting: true }]);
    assert.equal(typeof pendingFrame, 'function');
    const frame = pendingFrame;
    frame(1000);
    assert.equal(renderCalls.length, 1);
    assert.equal(draws, 1);

    controller.dispose();
    assert.deepEqual(cancelledFrames, [17]);
    assert.equal(observerDisconnected, true);
    assert.equal(rendererDisposed, true);
    assert.equal(contextLost, true);
    assert.equal(motionListener, null);
});
