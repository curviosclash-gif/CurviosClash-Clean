import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { RenderViewportSystem } from '../src/core/renderer/RenderViewportSystem.js';
import { buildStandardCaptureSegments } from '../src/core/renderer/RecordingCaptureLayoutOps.js';
import { buildHumanConfigs } from '../src/state/match-session/MatchSessionSetupOps.js';
import { migrateSettingsSnapshot } from '../src/core/settings/SettingsVersionMigrations.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';
import {
    FOUR_PLAYER_PLANAR_KEY_BINDINGS,
    FOUR_PLAYER_PLANAR_PLAYER_COLORS,
    FOUR_PLAYER_PLANAR_ROLL_BINDINGS,
    SPLIT_SCREEN_VARIANTS,
    THREE_PLAYER_SPLIT_DEFAULT_DEVICE_ASSIGNMENT,
    THREE_PLAYER_SPLIT_INPUT_DEVICES,
    THREE_PLAYER_SPLIT_PLAYER_COLORS,
    normalizeFourPlayerPlanarRollBindings,
    normalizeFourPlayerPlanarSettings,
    normalizeSplitScreenVariant,
    normalizeThreePlayerSplitDeviceAssignment,
    normalizeThreePlayerSplitSettings,
    resolveThreePlayerSplitInputDevice,
} from '../src/four-player-planar/FourPlayerPlanarContract.js';
import {
    createFourPlayerPlanarInputSource,
    resolvePreferredFourPlayerPlanarAction,
} from '../src/four-player-planar/FourPlayerPlanarInputSource.js';
import { applyFourPlayerPlanarPhysicsConstraint } from '../src/four-player-planar/FourPlayerPlanarPhysics.js';
import { VIEWPORT_LAYOUTS } from '../src/shared/contracts/ViewportLayoutContract.js';

function createManager() {
    return new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
}

test('four-player planar settings migrate and sanitize without changing legacy profiles', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();
    const migrated = migrateSettingsSnapshot({
        settingsVersion: 2,
        localSettings: { sessionType: 'splitscreen' },
    }, defaults);
    assert.deepEqual(migrated.appliedMigrations, ['settings.v2-to-v3']);
    assert.equal(migrated.settings.localSettings.splitScreenVariant, SPLIT_SCREEN_VARIANTS.STANDARD);

    const sanitized = manager.sanitizeSettings({
        ...defaults,
        localSettings: {
            ...defaults.localSettings,
            splitScreenVariant: 'unknown-future-value',
            fourPlayerPlanar: {
                mode: 'invalid',
                mapKey: '__missing__',
                vehicleId: '__missing__',
                botCount: 99,
            },
        },
    });
    assert.equal(sanitized.localSettings.splitScreenVariant, SPLIT_SCREEN_VARIANTS.STANDARD);
    assert.deepEqual(sanitized.localSettings.fourPlayerPlanar, {
        mode: 'classic',
        mapKey: sanitized.mapKey,
        vehicleId: sanitized.vehicles.PLAYER_1,
        botCount: 6,
        rollBindings: FOUR_PLAYER_PLANAR_ROLL_BINDINGS.map((binding) => ({ ...binding })),
    });
    assert.equal(normalizeSplitScreenVariant(null), SPLIT_SCREEN_VARIANTS.STANDARD);
    assert.equal(normalizeFourPlayerPlanarSettings({ botCount: -4 }).botCount, 0);
    assert.deepEqual(
        normalizeFourPlayerPlanarRollBindings([{ left: 'Escape', right: 'KeyA' }]),
        FOUR_PLAYER_PLANAR_ROLL_BINDINGS.map((binding) => ({ ...binding }))
    );
});

test('runtime snapshot creates four local humans, one shared vehicle, four-grid layout and at most six bots', () => {
    const manager = createManager();
    const settings = manager.createDefaultSettings();
    settings.localSettings.sessionType = 'splitscreen';
    settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
    settings.localSettings.fourPlayerPlanar = {
        mode: 'hunt',
        mapKey: settings.mapKey,
        vehicleId: settings.vehicles.PLAYER_1,
        botCount: 20,
    };
    const runtime = manager.createRuntimeConfig(settings);
    assert.equal(runtime.session.numHumans, 4);
    assert.equal(runtime.session.numBots, 6);
    assert.equal(runtime.session.activeGameMode, 'HUNT');
    assert.equal(runtime.session.viewportLayout, VIEWPORT_LAYOUTS.FOUR_GRID);
    assert.equal(runtime.gameplay.planarMode, true);
    assert.deepEqual(runtime.session.fourPlayerPlanar.rollBindings, FOUR_PLAYER_PLANAR_ROLL_BINDINGS.map((binding) => ({ ...binding })));
    assert.deepEqual(Object.values(runtime.player.vehicles), Array(4).fill(settings.vehicles.PLAYER_1));

    const humans = buildHumanConfigs(settings, runtime);
    assert.equal(humans.length, 4);
    assert.deepEqual(humans.map((entry) => entry.vehicleId), Array(4).fill(settings.vehicles.PLAYER_1));
    assert.deepEqual(humans.map((entry) => entry.color), FOUR_PLAYER_PLANAR_PLAYER_COLORS);
});

test('runtime snapshot creates three local humans on equal-width columns with full 3D physics (no planar lock)', () => {
    const manager = createManager();
    const settings = manager.createDefaultSettings();
    settings.localSettings.sessionType = 'splitscreen';
    settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.THREE_PLAYER;
    settings.gameplay.planarMode = false;
    settings.localSettings.threePlayerSplit = {
        mode: 'classic',
        mapKey: settings.mapKey,
        vehicleId: settings.vehicles.PLAYER_1,
        botCount: 20,
        deviceAssignment: ['gamepad-1', 'gamepad-2', 'keyboard'],
    };
    const runtime = manager.createRuntimeConfig(settings);
    assert.equal(runtime.session.numHumans, 3);
    assert.equal(runtime.session.numBots, 6);
    assert.equal(runtime.session.splitScreenVariant, SPLIT_SCREEN_VARIANTS.THREE_PLAYER);
    assert.equal(runtime.session.viewportLayout, VIEWPORT_LAYOUTS.THREE_COLUMNS);
    assert.equal(runtime.session.fourPlayerPlanar, null);
    assert.deepEqual(runtime.session.threePlayerSplit.deviceAssignment, ['gamepad-1', 'gamepad-2', 'keyboard']);
    // Unlike four-player-planar, this variant keeps full 3D flight: no height/pitch lock.
    assert.equal(runtime.gameplay.planarMode, false);
    assert.deepEqual(Object.values(runtime.player.vehicles), Array(3).fill(settings.vehicles.PLAYER_1));

    const humans = buildHumanConfigs(settings, runtime);
    assert.equal(humans.length, 3);
    assert.deepEqual(humans.map((entry) => entry.vehicleId), Array(3).fill(settings.vehicles.PLAYER_1));
    assert.deepEqual(humans.map((entry) => entry.color), THREE_PLAYER_SPLIT_PLAYER_COLORS);
});

test('standard two-player splitscreen remains the compatible two-column adapter', () => {
    const manager = createManager();
    const settings = manager.createDefaultSettings();
    settings.localSettings.sessionType = 'splitscreen';
    settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.STANDARD;
    settings.gameplay.planarMode = false;
    const runtime = manager.createRuntimeConfig(settings);
    assert.equal(runtime.session.numHumans, 2);
    assert.equal(runtime.session.viewportLayout, VIEWPORT_LAYOUTS.TWO_COLUMNS);
    assert.equal(runtime.gameplay.planarMode, false);
    assert.equal(buildHumanConfigs(settings, runtime).length, 2);
});

test('all four keyboard groups support steering, context action and configurable roll while keeping pitch and extras neutral', () => {
    const down = new Set();
    const pressed = new Set();
    const inputManager = {
        isDown: (code) => down.has(code),
        wasPressed(code) {
            const result = pressed.has(code);
            pressed.delete(code);
            return result;
        },
    };
    const players = Array.from({ length: 4 }, () => ({ inventory: ['SHIELD'], selectedItemIndex: 0 }));
    const sources = FOUR_PLAYER_PLANAR_KEY_BINDINGS.map((binding, index) => {
        const source = createFourPlayerPlanarInputSource({
            inputManager,
            playerIndex: index,
            getPlayer: () => players[index],
            getMode: () => 'classic',
            rollBinding: FOUR_PLAYER_PLANAR_ROLL_BINDINGS[index],
        });
        source.bind(index);
        down.add(binding.left);
        down.add(FOUR_PLAYER_PLANAR_ROLL_BINDINGS[index].left);
        pressed.add(binding.action);
        const first = { ...source.poll() };
        const held = { ...source.poll() };
        down.delete(binding.left);
        down.delete(FOUR_PLAYER_PLANAR_ROLL_BINDINGS[index].left);
        assert.equal(first.yawLeft, true);
        assert.equal(first.rollLeft, true);
        assert.equal(first.rollAxis, 1);
        assert.equal(first.useItem, true);
        assert.equal(held.useItem, false);
        assert.equal(first.pitchAxis, 0);
        for (const key of ['pitchUp', 'pitchDown', 'rollRight', 'boost', 'boostPressed', 'cameraSwitch', 'shootMG']) {
            assert.equal(first[key], false);
        }
        source.clearInputState();
        assert.equal(source.poll().yawLeft, false);
        return source;
    });
    assert.equal(sources.length, 4);

    const dual = { hasItem: true, hasRocket: true, canUseNow: true, canShootRocketNow: true };
    assert.deepEqual(resolvePreferredFourPlayerPlanarAction(dual, 'classic'), { useItem: true, shootItem: false, shootRocket: false });
    assert.deepEqual(resolvePreferredFourPlayerPlanarAction(dual, 'hunt'), { useItem: false, shootItem: false, shootRocket: true });
    const itemOnly = { hasItem: true, hasRocket: false, canUseNow: true, canShootRocketNow: false };
    assert.deepEqual(resolvePreferredFourPlayerPlanarAction(itemOnly, 'hunt'), { useItem: true, shootItem: false, shootRocket: false });
});

test('four-player planar physics restores height and pitch while preserving manual roll after curve, collision and respawn changes', () => {
    const player = {
        entityManager: { runtimeConfig: { session: { splitScreenVariant: 'four_player_planar', viewportLayout: 'four_grid' } } },
        currentPlanarY: 7,
        position: new THREE.Vector3(1, 30, 2),
        velocity: new THREE.Vector3(3, 9, 4),
        quaternion: new THREE.Quaternion(),
        _tmpEuler2: new THREE.Euler(0, 0, 0, 'YXZ'),
    };
    for (const [pitch, yaw, roll] of [[0.5, 0.2, 0.7], [-0.8, 1.2, -0.4], [1.1, -0.3, 0.9]]) {
        player.position.y = 50;
        player.velocity.y = -12;
        player.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
        const before = new THREE.Euler().setFromQuaternion(player.quaternion, 'YXZ');
        assert.equal(applyFourPlayerPlanarPhysicsConstraint(player), true);
        const euler = new THREE.Euler().setFromQuaternion(player.quaternion, 'YXZ');
        assert.equal(player.position.y, 7);
        assert.equal(player.velocity.y, 0);
        assert.ok(Math.abs(euler.x) < 1e-9);
        assert.ok(Math.abs(euler.y - before.y) < 1e-9);
        assert.ok(Math.abs(euler.z - before.z) < 1e-9);
    }
});

test('four-grid renderer uses P1/P2 top, P3/P4 bottom, updates aspects and resets scissor state', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { innerWidth: 1920, innerHeight: 1080 };
    const calls = [];
    const renderer = {
        setSize: (...args) => calls.push(['size', ...args]),
        setViewport: (...args) => calls.push(['viewport', ...args]),
        setScissor: (...args) => calls.push(['scissor', ...args]),
        setScissorTest: (...args) => calls.push(['scissorTest', ...args]),
        render: (_scene, camera) => calls.push(['render', camera.id]),
    };
    const cameras = Array.from({ length: 4 }, (_, index) => ({
        id: `P${index + 1}`,
        aspect: 0,
        updateProjectionMatrix() {},
    }));
    try {
        const viewport = new RenderViewportSystem(renderer, { width: 1920, height: 1080 });
        viewport.setViewportLayout(VIEWPORT_LAYOUTS.FOUR_GRID, cameras);
        assert.deepEqual(cameras.map((camera) => camera.aspect), Array(4).fill(16 / 9));
        calls.length = 0;
        viewport.render({}, cameras);
        assert.deepEqual(calls.filter(([type]) => type === 'render').map(([, id]) => id), ['P1', 'P2', 'P3', 'P4']);
        assert.deepEqual(calls.filter(([type]) => type === 'viewport').slice(0, 4), [
            ['viewport', 0, 540, 960, 540],
            ['viewport', 960, 540, 960, 540],
            ['viewport', 0, 0, 960, 540],
            ['viewport', 960, 0, 960, 540],
        ]);
        assert.deepEqual(calls.at(-2), ['viewport', 0, 0, 1920, 1080]);
        assert.deepEqual(calls.at(-3), ['scissorTest', false]);
        globalThis.window.innerWidth = 1280;
        globalThis.window.innerHeight = 720;
        viewport.onResize(cameras);
        assert.equal(viewport.getAspect(), 16 / 9);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('three-player split settings normalize device assignment, clamp bots and reject unknown variants', () => {
    assert.equal(normalizeSplitScreenVariant(SPLIT_SCREEN_VARIANTS.THREE_PLAYER), SPLIT_SCREEN_VARIANTS.THREE_PLAYER);
    assert.equal(normalizeSplitScreenVariant('not-a-real-variant'), SPLIT_SCREEN_VARIANTS.STANDARD);

    assert.deepEqual(
        normalizeThreePlayerSplitDeviceAssignment(null),
        THREE_PLAYER_SPLIT_DEFAULT_DEVICE_ASSIGNMENT
    );
    assert.deepEqual(
        normalizeThreePlayerSplitDeviceAssignment(['keyboard', 'not-a-device', 'gamepad-1']),
        ['keyboard', THREE_PLAYER_SPLIT_INPUT_DEVICES.GAMEPAD_2, THREE_PLAYER_SPLIT_INPUT_DEVICES.GAMEPAD_1]
    );

    const settings = normalizeThreePlayerSplitSettings({ mode: 'hunt', botCount: 99, deviceAssignment: ['keyboard', 'keyboard', 'keyboard'] });
    assert.equal(settings.mode, 'hunt');
    assert.equal(settings.botCount, 6);
    assert.deepEqual(settings.deviceAssignment, ['keyboard', 'keyboard', 'keyboard']);
});

test('resolveThreePlayerSplitInputDevice reads the default two-gamepad-one-keyboard assignment', () => {
    assert.deepEqual(resolveThreePlayerSplitInputDevice(null, 0), { type: 'gamepad', gamepadIndex: 0 });
    assert.deepEqual(resolveThreePlayerSplitInputDevice(null, 1), { type: 'gamepad', gamepadIndex: 1 });
    assert.deepEqual(resolveThreePlayerSplitInputDevice(null, 2), { type: 'keyboard', gamepadIndex: -1 });
    assert.equal(resolveThreePlayerSplitInputDevice(null, 3), null);
    assert.equal(resolveThreePlayerSplitInputDevice(null, -1), null);
});

test('three-column renderer splits P1/P2/P3 into equal-width panes and resets scissor state', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { innerWidth: 1920, innerHeight: 1080 };
    const calls = [];
    const renderer = {
        setSize: (...args) => calls.push(['size', ...args]),
        setViewport: (...args) => calls.push(['viewport', ...args]),
        setScissor: (...args) => calls.push(['scissor', ...args]),
        setScissorTest: (...args) => calls.push(['scissorTest', ...args]),
        render: (_scene, camera) => calls.push(['render', camera.id]),
    };
    const cameras = Array.from({ length: 3 }, (_, index) => ({
        id: `P${index + 1}`,
        aspect: 0,
        updateProjectionMatrix() {},
    }));
    try {
        const viewport = new RenderViewportSystem(renderer, { width: 1920, height: 1080 });
        viewport.setViewportLayout(VIEWPORT_LAYOUTS.THREE_COLUMNS, cameras);
        assert.deepEqual(cameras.map((camera) => camera.aspect), Array(3).fill((1920 / 3) / 1080));
        calls.length = 0;
        viewport.render({}, cameras);
        assert.deepEqual(calls.filter(([type]) => type === 'render').map(([, id]) => id), ['P1', 'P2', 'P3']);
        assert.deepEqual(calls.filter(([type]) => type === 'viewport').slice(0, 3), [
            ['viewport', 0, 0, 640, 1080],
            ['viewport', 640, 0, 640, 1080],
            ['viewport', 1280, 0, 640, 1080],
        ]);
        assert.deepEqual(calls.at(-2), ['viewport', 0, 0, 1920, 1080]);
        assert.deepEqual(calls.at(-3), ['scissorTest', false]);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('recording capture metadata segments preserve the visible 2x2 quadrant order', () => {
    const players = Array.from({ length: 4 }, (_, playerIndex) => ({ playerIndex }));
    const segments = buildStandardCaptureSegments({
        players,
        viewportLayout: VIEWPORT_LAYOUTS.FOUR_GRID,
        width: 1920,
        height: 1080,
    });
    assert.deepEqual(segments.map((segment) => ({
        label: segment.label,
        playerIndex: segment.player.playerIndex,
        x: segment.x,
        y: segment.y,
    })), [
        { label: 'P1', playerIndex: 0, x: 0, y: 0 },
        { label: 'P2', playerIndex: 1, x: 960, y: 0 },
        { label: 'P3', playerIndex: 2, x: 0, y: 540 },
        { label: 'P4', playerIndex: 3, x: 960, y: 540 },
    ]);
});
