import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { createRuntimeConfigSnapshot, applyRuntimeConfigCompatibility } from '../src/core/RuntimeConfig.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { createSettingsOverrideDraft, validateSettingsOverrideDraft,
    createSettingsStudioSchemaDescriptor } from '../src/core/settings/SettingsOverrideContract.js';
import { createDefaultSettingsSnapshotWithOverride } from '../src/core/settings/SettingsDefaultsFacade.js';
import { normalizeMapBalancingLayer, normalizeMapBalancingModesDocument } from '../src/shared/contracts/MapBalancingContract.js';
import { normalizePresetValues } from '../src/ui/menu/MenuPresetApplyOps.js';
import { renderSectionForm } from '../electron/settings-studio/ui/settings-studio-form-renderer.js';
import { createTranslator } from '../electron/settings-studio/ui/settings-studio-i18n.js';
import { createBotRuntimeContext } from '../src/entities/ai/BotRuntimeContextFactory.js';
import { SoloFlightController } from '../src/entities/ai/SoloFlightController.js';
import { Player } from '../src/entities/Player.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

test('pitch and yaw survive save/load independently and reach entity and legacy configs', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    Object.assign(settings.gameplay, { turnSensitivity: 3, pitchSensitivity: 4.5 });
    assert.equal(manager.saveSettings(settings).success, true);
    const loaded = manager.loadSettings();
    assert.equal(loaded.gameplay.turnSensitivity, 3);
    assert.equal(loaded.gameplay.pitchSensitivity, 4.5);
    const runtime = createRuntimeConfigSnapshot(loaded);
    assert.equal(runtime.player.turnSpeed, 3);
    assert.equal(runtime.player.pitchTurnSpeed, 4.5);
    assert.equal(createEntityRuntimeConfig(runtime).PLAYER.PITCH_TURN_SPEED, 4.5);
    assert.equal(applyRuntimeConfigCompatibility(runtime).PLAYER.PITCH_TURN_SPEED, 4.5);
    const actor = { turnSpeed: 3, pitchTurnSpeed: 3 };
    Player.prototype.setControlOptions.call(actor, { pitchTurnSpeed: 4.5 });
    assert.equal(actor.turnSpeed, 3);
    assert.equal(actor.pitchTurnSpeed, 4.5);
});

test('legacy settings, studio overrides and mode defaults inherit yaw when pitch is missing', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    settings.gameplay.turnSensitivity = 2.6;
    delete settings.gameplay.pitchSensitivity;
    assert.equal(manager.sanitizeSettings(settings).gameplay.pitchSensitivity, 2.6);
    assert.equal(createRuntimeConfigSnapshot(settings).player.pitchTurnSpeed, 2.6);
    assert.equal(normalizeMapBalancingModesDocument({ modes: { normal: { values: { turnSensitivity: 2.6 } } } })
        .modes.normal.values.pitchSensitivity, 2.6);
    assert.equal(normalizePresetValues({ values: { 'gameplay.turnSensitivity': 2.6 } })['gameplay.pitchSensitivity'], undefined);
    assert.equal(normalizeMapBalancingLayer({ values: { turnSensitivity: 2.6 } }).values.pitchSensitivity, undefined);
    const override = createSettingsOverrideDraft();
    override.baseSettings.gameplay.turnSensitivity = 2.6;
    delete override.baseSettings.gameplay.pitchSensitivity;
    assert.equal(createDefaultSettingsSnapshotWithOverride(override).gameplay.pitchSensitivity, 2.6);
    assert.equal(normalizeMapBalancingLayer({ values: {
        turnSensitivity: 2.6, pitchSensitivity: 4.5,
    } }).values.pitchSensitivity, 4.5);
});

test('Settings Studio exposes named independent controls, validates pitch and renders both languages', () => {
    const draft = createSettingsOverrideDraft();
    draft.baseSettings.gameplay.pitchSensitivity = 4.5;
    assert.equal(validateSettingsOverrideDraft(draft).valid, true);
    const schema = createSettingsStudioSchemaDescriptor();
    for (const language of ['de', 'en']) {
        const html = renderSectionForm('baseSettings', schema, draft, createSettingsOverrideDraft(), createTranslator(language), []);
        assert.match(html, /baseSettings.gameplay.pitchSensitivity/);
        assert.match(html, /baseSettings.gameplay.turnSensitivity/);
        assert.match(html, language === 'de' ? /Lenkung Hoch\/Runter \(Pitch\)/ : /Up\/down steering \(Pitch\)/);
    }
    for (const value of [0, 5.1, NaN]) {
        draft.baseSettings.gameplay.pitchSensitivity = value;
        const result = validateSettingsOverrideDraft(draft);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((error) => error.path === 'baseSettings.gameplay.pitchSensitivity'));
    }
});

test('bot dynamics and profile cache track pitch without changing equal-axis profile identities', () => {
    const manager = { players: [], projectiles: [], powerupManager: { items: [] },
        runtimeConfig: { bot: {} }, huntEnabled: false, botDifficulty: 'NORMAL' };
    const player = { index: 0, isBot: true, baseSpeed: 18, turnSpeed: 3, rollSpeed: 2 };
    const before = createBotRuntimeContext(manager, player, 1 / 60).rampControlProfileId;
    player.pitchTurnSpeed = 3;
    assert.equal(createBotRuntimeContext(manager, player, 1 / 60).rampControlProfileId, before);
    player.pitchTurnSpeed = 4.5;
    const after = createBotRuntimeContext(manager, player, 1 / 60);
    assert.notEqual(after.rampControlProfileId, before);
    assert.equal(after.controlDynamics.turnSpeed, 3);
    assert.equal(after.controlDynamics.pitchTurnSpeed, 4.5);
    assert.equal(createBotRuntimeContext(manager, player, 1 / 60).rampControlProfileId, after.rampControlProfileId);
});

test('bot path prediction uses the actual pitch rate and keeps planar prediction level', () => {
    const pilot = new SoloFlightController();
    const player = { index: 0, turnSpeed: 3, pitchTurnSpeed: 4.5,
        position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    const manager = {};
    const arena = {};
    pilot._score(player, arena, manager, 0, 1, 10, 3, 1, 2, 20);
    const rotation = new THREE.Euler().setFromQuaternion(pilot.orientation, 'YXZ');
    assert.ok(Math.abs(rotation.x - 4.5 * 0.3) < 1e-9);
    pilot._score(player, arena, manager, 1, 1, 10, 3, 1, 2, 20, true);
    assert.ok(Math.abs(pilot.position.y) < 1e-9);
});
