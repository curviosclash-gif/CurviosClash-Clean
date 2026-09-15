import assert from 'node:assert/strict';
import test from 'node:test';
import {
    GamepadRumble,
    resolvePlayerGamepadIndex,
    resolveRumbleEffect,
} from '../src/core/input/GamepadRumble.js';
import * as THREE from 'three';
import { Renderer } from '../src/core/Renderer.js';
import { RocketBlastEffect } from '../src/entities/effects/RocketBlastEffect.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { createDefaultSettingsSnapshot } from '../src/core/settings/SettingsDefaultsFacade.js';
import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

function createPads(count = 2) {
    return Array.from({ length: count }, () => {
        const effects = [];
        return {
            effects,
            vibrationActuator: {
                playEffect(type, params) {
                    effects.push({ type, ...params });
                    return Promise.resolve('complete');
                },
            },
        };
    });
}

function createRumble({ pads = createPads(), slots = { 0: 0, 1: 1 }, enabled = { value: true }, clock = { now: 0 } } = {}) {
    const rumble = new GamepadRumble({
        resolveGamepadIndex: (playerIndex) => slots[playerIndex] ?? null,
        isEnabled: () => enabled.value,
        getGamepads: () => pads,
        now: () => clock.now,
    });
    return { rumble, pads, enabled, clock };
}

test('camera shake strength maps onto bounded dual-rumble motor power and duration', () => {
    assert.equal(resolveRumbleEffect(0, 0.2), null);
    assert.equal(resolveRumbleEffect(0.3, 0), null);
    assert.equal(resolveRumbleEffect(Number.NaN, 0.2), null);

    const light = resolveRumbleEffect(0.08, 0.12);
    const heavy = resolveRumbleEffect(0.52, 0.38);
    assert.ok(heavy.strongMagnitude > light.strongMagnitude);
    assert.equal(heavy.strongMagnitude, 1, 'the strongest camera shake uses the full heavy motor');
    assert.ok(light.strongMagnitude >= 0.12, 'a light hit is still felt');
    assert.equal(light.duration, 120);
    assert.equal(resolveRumbleEffect(0.3, 5).duration, 500, 'long shakes are capped');
    for (const effect of [light, heavy]) {
        assert.ok(effect.weakMagnitude > 0 && effect.weakMagnitude <= 1);
    }
});

test('each pulse reaches only the controller of the shaken player', () => {
    const { rumble, pads } = createRumble();
    assert.equal(rumble.pulse(1, 0.4, 0.3), true);
    assert.equal(pads[0].effects.length, 0);
    assert.deepEqual(pads[1].effects, [{ type: 'dual-rumble', startDelay: 0, ...resolveRumbleEffect(0.4, 0.3) }]);
});

test('keyboard players, missing pads and the disabled setting stay silent', () => {
    const { rumble, pads, enabled } = createRumble({ slots: { 0: 0 } });
    assert.equal(rumble.pulse(1, 0.4, 0.3), false, 'player without a controller');
    enabled.value = false;
    assert.equal(rumble.pulse(0, 0.4, 0.3), false, 'vibration switched off');
    assert.equal(pads[0].effects.length, 0);

    const noActuator = new GamepadRumble({ resolveGamepadIndex: () => 0, getGamepads: () => [{}] });
    assert.equal(noActuator.pulse(0, 0.4, 0.3), false);
    const throwing = new GamepadRumble({
        resolveGamepadIndex: () => 0,
        getGamepads: () => [{ vibrationActuator: { playEffect() { throw new Error('unsupported'); } } }],
    });
    assert.equal(throwing.pulse(0, 0.4, 0.3), false);
});

test('weaker hits cannot cut a running stronger rumble short', () => {
    const { rumble, pads, clock } = createRumble();
    rumble.pulse(0, 0.45, 0.3);
    clock.now = 100;
    assert.equal(rumble.pulse(0, 0.1, 0.12), false, 'MG graze during a blast');
    assert.equal(rumble.pulse(0, 0.5, 0.3), true, 'a stronger impact takes over');
    clock.now = 1000;
    assert.equal(rumble.pulse(0, 0.1, 0.12), true, 'after the effect ends light hits rumble again');
    assert.equal(pads[0].effects.length, 3);
});

test('only an active controller source yields a hardware slot', () => {
    assert.equal(resolvePlayerGamepadIndex({ type: 'gamepad', gamepadIndex: 1 }), 1);
    assert.equal(resolvePlayerGamepadIndex({ type: 'keyboard', gamepadIndex: 0 }), null);
    assert.equal(resolvePlayerGamepadIndex({ type: 'gamepad' }), null);
    assert.equal(resolvePlayerGamepadIndex(null), null);
});

test('the renderer reports every per-player camera shake as an impact', () => {
    const renderer = Object.create(Renderer.prototype);
    const shakes = [];
    renderer.cameraRigSystem = { triggerCameraShake: (...args) => shakes.push(['camera', ...args]) };
    renderer.triggerCameraShake(0, 0.3, 0.2);
    renderer.setImpactListener((...args) => shakes.push(['impact', ...args]));
    renderer.triggerCameraShake(1, 0.4, 0.25);
    renderer.reportImpact(0, 0.2, 0.15);
    renderer.setImpactListener(null);
    renderer.triggerCameraShake(0, 0.1, 0.1);
    assert.deepEqual(shakes, [
        ['camera', 0, 0.3, 0.2],
        ['camera', 1, 0.4, 0.25],
        ['impact', 1, 0.4, 0.25],
        ['impact', 0, 0.2, 0.15],
        ['camera', 0, 0.1, 0.1],
    ]);
});

test('a nearby blast still reports an impact when reduced motion keeps the camera still', () => {
    for (const reduceMotion of [true, false]) {
        const calls = [];
        const renderer = {
            cameras: [{ position: new THREE.Vector3(0, 0, 0) }, { position: new THREE.Vector3(500, 0, 0) }],
            addToScene() {},
            getCameraPerspectiveSettings: () => ({ reduceMotion }),
            triggerCameraShake: (index) => calls.push(['shake', index]),
            reportImpact: (index) => calls.push(['impact', index]),
        };
        new RocketBlastEffect(renderer, { modernGraphics: false })
            .spawn(new THREE.Vector3(2, 0, 0), 'ROCKET_HEAVY', new THREE.Color(0xff8800));
        // Only the near view (index 0) feels it; reduced motion swaps the shake for a bare impact report.
        assert.deepEqual(calls, [[reduceMotion ? 'impact' : 'shake', 0]], `reduceMotion=${reduceMotion}`);
    }
});

test('vibration is on by default and a switched-off choice survives save and reload', () => {
    const defaults = createDefaultSettingsSnapshot();
    assert.equal(defaults.localSettings.gamepadVibration, true);

    const legacy = { localSettings: { ...defaults.localSettings } };
    delete legacy.localSettings.gamepadVibration;
    ensureMenuContractState(legacy);
    assert.equal(legacy.localSettings.gamepadVibration, true, 'saves from before the setting keep vibration on');

    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    settings.localSettings.gamepadVibration = false;
    assert.equal(manager.saveSettings(settings).success, true);
    assert.equal(manager.loadSettings().localSettings.gamepadVibration, false);
});
