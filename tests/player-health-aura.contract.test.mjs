import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
    PLAYER_HEALTH_AURA_COLORS,
    PLAYER_HEALTH_AURA_PULSE_PERIOD_SECONDS,
    createPlayerHealthAura,
    resolvePlayerHealthAuraState,
    syncPlayerHealthAuraBounds,
    updatePlayerHealthAura,
} from '../src/entities/player/PlayerHealthAura.js';
import {
    PLAYER_HEALTH_AURA_MAX_VIEWERS,
    configurePlayerHealthAuraCamera,
    configurePlayerHealthAuraObserverCamera,
} from '../src/shared/rendering/PlayerHealthAuraLayers.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

function resolveState(overrides = {}) {
    return resolvePlayerHealthAuraState({
        hp: 100,
        maxHp: 100,
        timeSeconds: 0,
        playerIndex: 0,
        reduceMotion: true,
        activeGameMode: 'HUNT',
        alive: true,
        groupVisible: true,
        ...overrides,
    });
}

test('health aura clamps hit points and resolves the approved color anchors', () => {
    const critical = resolveState({ hp: -20 });
    const medium = resolveState({ hp: 50 });
    const full = resolveState({ hp: 140 });

    assert.equal(critical.healthRatio, 0);
    assert.equal(critical.color.getHex(), PLAYER_HEALTH_AURA_COLORS.critical);
    assert.equal(medium.healthRatio, 0.5);
    assert.equal(medium.color.getHex(), PLAYER_HEALTH_AURA_COLORS.medium);
    assert.equal(full.healthRatio, 1);
    assert.equal(full.color.getHex(), PLAYER_HEALTH_AURA_COLORS.full);
});

test('health aura stays stronger near the hull and brightens monotonically with health', () => {
    const critical = resolveState({ hp: 0 });
    const medium = resolveState({ hp: 50 });
    const full = resolveState({ hp: 100 });

    for (const state of [critical, medium, full]) {
        assert.ok(state.innerOpacity > state.outerOpacity);
    }
    assert.ok(critical.innerOpacity < medium.innerOpacity);
    assert.ok(medium.innerOpacity < full.innerOpacity);
    assert.ok(critical.outerOpacity < medium.outerOpacity);
    assert.ok(medium.outerOpacity < full.outerOpacity);
});

test('health aura pulse is periodic, restrained, phased per player and disabled by reduced motion', () => {
    const baseline = resolveState({ reduceMotion: false, timeSeconds: 0, playerIndex: 0 });
    const repeated = resolveState({
        reduceMotion: false,
        timeSeconds: PLAYER_HEALTH_AURA_PULSE_PERIOD_SECONDS,
        playerIndex: 0,
    });
    const peak = resolveState({
        reduceMotion: false,
        timeSeconds: PLAYER_HEALTH_AURA_PULSE_PERIOD_SECONDS * 0.25,
        playerIndex: 0,
    });
    const phased = resolveState({ reduceMotion: false, timeSeconds: 0, playerIndex: 1 });
    const reducedAtStart = resolveState({ reduceMotion: true, timeSeconds: 0, playerIndex: 4 });
    const reducedLater = resolveState({ reduceMotion: true, timeSeconds: 19, playerIndex: 4 });

    assert.ok(Math.abs(baseline.innerOpacity - repeated.innerOpacity) < 1e-12);
    assert.ok(Math.abs(baseline.outerScaleMultiplier - repeated.outerScaleMultiplier) < 1e-12);
    assert.ok(peak.innerOpacity <= 0.22 * 1.06 + 1e-12);
    assert.ok(peak.outerScaleMultiplier <= 1.015 + 1e-12);
    assert.notEqual(phased.innerOpacity, baseline.innerOpacity);
    assert.equal(reducedAtStart.innerOpacity, reducedLater.innerOpacity);
    assert.equal(reducedAtStart.outerScaleMultiplier, 1);
    assert.equal(reducedLater.outerScaleMultiplier, 1);
});

test('viewer layers hide only the owning ship for all ten supported player slots', () => {
    const cameras = Array.from({ length: PLAYER_HEALTH_AURA_MAX_VIEWERS }, (_, index) => {
        const camera = new THREE.PerspectiveCamera();
        assert.equal(configurePlayerHealthAuraCamera(camera, index), true);
        return camera;
    });
    const ownerZero = createPlayerHealthAura(0);
    const ownerNine = createPlayerHealthAura(9);

    assert.equal(ownerZero.inner.layers.test(cameras[0].layers), false);
    assert.equal(ownerZero.outer.layers.test(cameras[0].layers), false);
    assert.equal(ownerZero.inner.layers.test(cameras[1].layers), true);
    assert.equal(ownerNine.inner.layers.test(cameras[0].layers), true);
    assert.equal(ownerNine.inner.layers.test(cameras[9].layers), false);
    assert.equal(cameras[0].layers.isEnabled(0), true, 'normal scene layer remains enabled');

    const captureCamera = new THREE.PerspectiveCamera();
    configurePlayerHealthAuraObserverCamera(captureCamera);
    assert.equal(ownerZero.inner.layers.test(captureCamera.layers), true);
    assert.equal(ownerNine.inner.layers.test(captureCamera.layers), true);
    configurePlayerHealthAuraCamera(captureCamera, 9);
    assert.equal(ownerZero.inner.layers.test(captureCamera.layers), true);
    assert.equal(ownerNine.inner.layers.test(captureCamera.layers), false);
    configurePlayerHealthAuraCamera(captureCamera, 0);
    assert.equal(ownerZero.inner.layers.test(captureCamera.layers), false, 'reused cameras drop their prior owner layer');
    assert.equal(ownerNine.inner.layers.test(captureCamera.layers), true);

    disposeObject3DResources(ownerZero.root);
    disposeObject3DResources(ownerNine.root);
});

test('health aura tracks bounds and HUNT lifecycle without reacting to teams or shields', () => {
    const aura = createPlayerHealthAura(2);
    const size = new THREE.Vector3(2, 4, 6);
    const center = new THREE.Vector3(0.5, -0.25, 1.25);
    assert.equal(syncPlayerHealthAuraBounds(aura, size, center), true);
    assert.deepEqual(aura.root.position.toArray(), center.toArray());
    assert.ok(aura.innerBaseScale.distanceTo(new THREE.Vector3(1.3, 2.6, 3.9)) < 1e-12);
    assert.ok(aura.outerBaseScale.distanceTo(new THREE.Vector3(1.7, 3.4, 5.1)) < 1e-12);

    const visible = updatePlayerHealthAura(aura, {
        hp: 50,
        maxHp: 100,
        timeSeconds: 0,
        playerIndex: 2,
        reduceMotion: true,
        activeGameMode: 'HUNT',
        alive: true,
        groupVisible: true,
        teamId: 'ALPHA',
        hasShield: true,
    });
    assert.equal(visible.visible, true);
    assert.equal(aura.root.visible, true);
    assert.equal(aura.inner.material.color.getHex(), PLAYER_HEALTH_AURA_COLORS.medium);

    assert.equal(updatePlayerHealthAura(aura, {
        hp: 50, maxHp: 100, activeGameMode: 'HUNT', alive: false, groupVisible: true,
    }).visible, false);
    assert.equal(updatePlayerHealthAura(aura, {
        hp: 50, maxHp: 100, activeGameMode: 'CLASSIC', alive: true, groupVisible: true,
    }).visible, false);
    assert.equal(updatePlayerHealthAura(aura, {
        hp: 100, maxHp: 100, activeGameMode: 'HUNT', alive: true, groupVisible: true,
    }).visible, true, 'respawn restores the aura');

    disposeObject3DResources(aura.root);
});

test('health aura disposal releases per-player materials but preserves shared geometry', () => {
    const aura = createPlayerHealthAura(0);
    let geometryDisposals = 0;
    let materialDisposals = 0;
    const onGeometryDispose = () => { geometryDisposals += 1; };
    const onMaterialDispose = () => { materialDisposals += 1; };
    aura.inner.geometry.addEventListener('dispose', onGeometryDispose);
    aura.inner.material.addEventListener('dispose', onMaterialDispose);
    aura.outer.material.addEventListener('dispose', onMaterialDispose);

    disposeObject3DResources(aura.root);

    assert.equal(geometryDisposals, 0);
    assert.equal(materialDisposals, 2);
    aura.inner.geometry.removeEventListener('dispose', onGeometryDispose);
});
