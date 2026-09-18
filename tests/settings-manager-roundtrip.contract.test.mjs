import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import {
    collectPrimitiveLeafPaths,
    readPathValue,
    writePathValue,
} from '../src/core/settings/SettingsOverrideMergeOps.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { GAMEPLAY_COCKPIT_CAMERA_ENABLED } from '../src/shared/contracts/CameraModeContract.js';
import { STORAGE_KEYS } from '../src/shared/storage/StorageKeys.js';

import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

// The sanitizer copies every persisted field by hand. Fields that are forgotten there are
// silently dropped on the next save (see d14a69b "keep the arcade block when settings are
// saved" and 7eaedc9 "keep display theme outside session drafts"). These tests walk every
// primitive leaf of the default snapshot so a forgotten field fails the suite instead of
// only showing up as a lost setting in the running game.

/**
 * Leaves the sanitizer deliberately derives or forces, together with the value it forces.
 * Everything else has to survive a save/load roundtrip untouched.
 */
function createDerivedLeafExpectations(defaults) {
    return new Map([
        // The snapshot always carries the version stamp of the current defaults.
        ['settingsVersion', defaults.settingsVersion],
        // Cockpit camera is a build-wide switch, not a stored preference.
        ['cockpitCamera.PLAYER_1', GAMEPLAY_COCKPIT_CAMERA_ENABLED],
        ['cockpitCamera.PLAYER_2', GAMEPLAY_COCKPIT_CAMERA_ENABLED],
        // Portal beams are hard disabled in the sanitizer.
        ['gameplay.portalBeams', false],
        // Respawn follows localSettings.modePath via the menu rules. The sweep stores the
        // mode path 'normal', where the rule forces respawn off - the swept value only
        // happens to match, so the expectation belongs here and not in the sweep.
        ['hunt.respawnEnabled', false],
        // Developer mode is switched off while the feature flag or release preview says so.
        ['localSettings.developerModeEnabled', false],
    ]);
}

/**
 * Leaves the mutation sweep deliberately leaves on their default, with the reason why.
 * The sweep asserts this exact list, so a new persisted field cannot slip in unnoticed:
 * it either gets a valid alternative below or an entry here.
 */
const UNCHANGED_LEAF_PATHS = Object.freeze([
    // The arcade contract always rewrites the score model to the current one.
    'arcade.scoreModel',
    // An empty container for per-session drafts. Filling it adds leaf paths instead of
    // changing a value; the session draft tests cover its content.
    'localSettings.draftStateBySessionType',
    // Only kept while the session type is multiplayer, which the sweep does not select.
    'localSettings.multiplayerTransport',
    // Contract version stamps the code writes on every sanitize.
    'localSettings.schemaVersion',
    'matchSettings.schemaVersion',
    // These four are different: createMenuContractState carries them over from the stored
    // state with normalizeString, so a stored value would survive. They stay unmutated
    // because there is no second valid version to store.
    'menuContracts.lifecycleContractVersion',
    'menuContracts.localSettingsSchemaVersion',
    'menuContracts.matchSettingsSchemaVersion',
    'menuContracts.playerLoadoutSchemaVersion',
    // Written by the code again.
    'menuContracts.schemaVersion',
    'playerLoadout.schemaVersion',
]);

/**
 * Numeric leaves whose range lives in their own contract instead of SETTINGS_LIMITS.
 * Each value is valid and differs from the default, so it must survive unchanged.
 */
const ALTERNATIVE_NUMBERS = new Map([
    ['cameraPerspective.speedFovIntensity', 1.25],
    ['cameraPerspective.thrusterExhaustIntensity', 1.25],
    ['localSettings.viewDistance', 50],
    ['localSettings.shadowQuality', 1],
    ['localSettings.hud.scale', 1.2],
    ['localSettings.hud.opacity', 0.8],
    ['localSettings.mobileControls.tiltSensitivity', 1.5],
]);

/**
 * Non-numeric leaves with a valid alternative, taken from the positive list each field is
 * normalized against. Coupled fields move together: the session type matches the mode, the
 * mode path matches the game mode, and the active preset identity matches the fixed preset.
 * The control bindings get conflict-free codes, because normalizeControlBindings resets a
 * binding that collides with another combat action of the same player.
 */
const ALTERNATIVE_VALUES = new Map([
    ['mode', '1p'],
    ['gameMode', 'CLASSIC'],
    ['mapKey', 'maze'],
    ['botDifficulty', 'EASY'],
    ['botPolicyStrategy', 'heuristic'],
    ['hunt.winCondition', 'score_target'],
    ['botHeuristicProfile', 'aggressive'],
    ['vehicles.PLAYER_1', 'aircraft'],
    ['vehicles.PLAYER_2', 'drone'],
    ['arcade.profileId', 'arcade-alt'],
    ['arcade.runType', 'endless_parcours'],
    ['arcade.combatProfile', 'hunt'],
    ['botBridge.url', 'ws://127.0.0.1:9100'],
    ['botBridge.resumeCheckpoint', 'checkpoint-7'],
    ['recording.profile', 'cinematic'],
    ['recording.hudMode', 'with_hud'],
    ['recording.exportPreset', 'master'],
    ['recording.orientation', 'portrait'],
    ['cameraPerspective.normal', 'cinematic_soft'],
    ['matchSettings.activePresetId', 'endlosjagd'],
    ['matchSettings.activePresetKind', 'fixed'],
    ['matchSettings.activePresetSourceId', 'endlosjagd-source'],
    ['playerLoadout.presetId', 'loadout-alt'],
    ['playerLoadout.presetKind', 'open'],
    ['localSettings.ownerId', 'studio-owner'],
    ['localSettings.actorId', 'studio-owner'],
    ['localSettings.developerModeVisibility', 'open'],
    ['localSettings.developerThemeId', 'arctic-grid'],
    ['localSettings.fixedPresetId', 'endlosjagd'],
    ['localSettings.sessionType', 'single'],
    ['localSettings.splitScreenVariant', 'four_player_planar'],
    ['localSettings.fourPlayerPlanar.mode', 'hunt'],
    ['localSettings.fourPlayerPlanar.mapKey', 'maze'],
    ['localSettings.fourPlayerPlanar.vehicleId', 'aircraft'],
    ['localSettings.fourPlayerPlanar.rollBindings', [
        { left: 'KeyZ', right: 'KeyX' },
        { left: 'KeyC', right: 'KeyV' },
        { left: 'KeyB', right: 'KeyN' },
        { left: 'KeyM', right: 'KeyG' },
    ]],
    ['localSettings.threePlayerSplit.deviceAssignment', ['keyboard', 'gamepad-2', 'gamepad-1']],
    ['localSettings.threePlayerSplit.mode', 'hunt'],
    ['localSettings.threePlayerSplit.mapKey', 'maze'],
    ['localSettings.threePlayerSplit.vehicleId', 'aircraft'],
    ['localSettings.modePath', 'normal'],
    ['localSettings.themeMode', 'hell'],
    ['localSettings.graphicsStyle', 'classic'],
    ['localSettings.mapBrightness', 'hell'],
    ['localSettings.hud.colorPreset', 'amber'],
    ['localSettings.startSetup.mapSearch', 'maze'],
    ['localSettings.startSetup.mapFilter', 'parcours-collection'],
    ['localSettings.startSetup.vehicleSearch', 'ship'],
    ['localSettings.startSetup.vehicleFilter', 'heavy'],
    ['localSettings.startSetup.arcadeGhostDuelMode', 'self_longest_ghost'],
    ['localSettings.toolsState.activeSection', 'gameplay'],
    ['localSettings.mobileControls.tiltPitchMode', 'touch'],
    ['localSettings.mobileControls.tiltAssistMode', 'arcade'],
    ['localSettings.telemetryState.lastEvents', [{ type: 'quickstart' }]],
    ['localSettings.eventPlaylistState.activePlaylistId', 'chaos_rotation'],
    ['localSettings.eventPlaylistState.lastPresetId', 'arcade'],
    ['controls.PLAYER_1.UP', 'KeyT'],
    ['controls.PLAYER_1.DOWN', 'KeyY'],
    ['controls.PLAYER_1.LEFT', 'KeyU'],
    ['controls.PLAYER_1.RIGHT', 'KeyI'],
    ['controls.PLAYER_1.ROLL_LEFT', 'KeyO'],
    ['controls.PLAYER_1.ROLL_RIGHT', 'KeyP'],
    ['controls.PLAYER_1.BOOST', 'KeyH'],
    ['controls.PLAYER_1.SLOWMO', 'KeyQ'],
    ['controls.PLAYER_1.SHOOT', 'KeyJ'],
    ['controls.PLAYER_1.SHOOT_ROCKET', 'KeyK'],
    ['controls.PLAYER_1.SHOOT_MG', 'KeyL'],
    ['controls.PLAYER_1.NEXT_ITEM', 'KeyN'],
    ['controls.PLAYER_1.USE_ITEM', 'KeyM'],
    ['controls.PLAYER_1.CAMERA', 'KeyB'],
    ['controls.PLAYER_2.UP', 'Digit1'],
    ['controls.PLAYER_2.DOWN', 'Digit2'],
    ['controls.PLAYER_2.LEFT', 'Digit3'],
    ['controls.PLAYER_2.RIGHT', 'Digit4'],
    ['controls.PLAYER_2.ROLL_LEFT', 'Digit5'],
    ['controls.PLAYER_2.ROLL_RIGHT', 'Digit6'],
    ['controls.PLAYER_2.BOOST', 'Digit7'],
    ['controls.PLAYER_2.SLOWMO', 'Numpad1'],
    ['controls.PLAYER_2.SHOOT', 'Digit8'],
    ['controls.PLAYER_2.SHOOT_ROCKET', 'Digit9'],
    ['controls.PLAYER_2.SHOOT_MG', 'Digit0'],
    ['controls.PLAYER_2.NEXT_ITEM', 'Minus'],
    ['controls.PLAYER_2.USE_ITEM', 'Equal'],
    ['controls.PLAYER_2.CAMERA', 'Backslash'],
    ['controls.GLOBAL.CINEMATIC_TOGGLE', 'F7'],
    ['controls.GLOBAL.RECORDING_TOGGLE', 'F6'],
    ['controls.SPLITSCREEN.layout', 'controller-keyboard'],
]);

function resolveSettingsLimitRule(path) {
    if (path === 'numBots') return SETTINGS_LIMITS.session.numBots;
    if (path === 'winsNeeded') return SETTINGS_LIMITS.session.winsNeeded;
    if (path.startsWith('gameplay.')) return SETTINGS_LIMITS.gameplay[path.slice('gameplay.'.length)] || null;
    if (path.startsWith('botBridge.')) return SETTINGS_LIMITS.botBridge[path.slice('botBridge.'.length)] || null;
    if (path.startsWith('hunt.')) return SETTINGS_LIMITS.hunt[path.slice('hunt.'.length)] || null;
    return null;
}

function createAlternativeNumber(path, value) {
    if (ALTERNATIVE_NUMBERS.has(path)) return ALTERNATIVE_NUMBERS.get(path);

    const rule = resolveSettingsLimitRule(path);
    if (rule) {
        const step = rule.integer ? 1 : (rule.max - rule.min) / 8;
        let next = value + step;
        if (next > rule.max) next = value - step;
        if (next < rule.min) next = rule.min;
        return rule.integer ? Math.trunc(next) : Number(next.toFixed(4));
    }
    return Number.isInteger(value) ? value + 1 : Number((value + 0.01).toFixed(4));
}

/**
 * Builds a snapshot where every leaf with a known valid alternative carries a value that
 * differs from the default. Returns the map of intended values plus the sorted list of
 * leaves that stayed on their default, so the test can pin that list.
 */
function createFullyChangedSnapshot(defaults) {
    const changed = structuredClone(defaults);
    const intended = new Map();
    const unchanged = [];

    for (const path of collectPrimitiveLeafPaths(defaults)) {
        const value = readPathValue(defaults, path);
        if (ALTERNATIVE_VALUES.has(path)) {
            const next = structuredClone(ALTERNATIVE_VALUES.get(path));
            writePathValue(changed, path, next);
            intended.set(path, next);
            continue;
        }
        if (typeof value === 'boolean') {
            writePathValue(changed, path, !value);
            intended.set(path, !value);
            continue;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            const next = createAlternativeNumber(path, value);
            writePathValue(changed, path, next);
            intended.set(path, next);
            continue;
        }
        unchanged.push(path);
    }

    return { changed, intended, unchanged: unchanged.sort() };
}

test('SettingsManager keeps every default leaf path through sanitize, save and load', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const manager = new SettingsManager({ storagePlatform });
    const defaults = manager.createDefaultSettings();
    const leafPaths = collectPrimitiveLeafPaths(defaults);

    assert.ok(leafPaths.length >= 150, `expected a rich default snapshot, got ${leafPaths.length} leaves`);

    const sanitized = manager.sanitizeSettings(defaults);
    for (const path of leafPaths) {
        assert.deepEqual(
            readPathValue(sanitized, path),
            readPathValue(defaults, path),
            `sanitize lost or changed ${path}`
        );
    }

    const saveResult = manager.saveSettings(sanitized);
    const loaded = manager.loadSettings();

    assert.equal(saveResult.success, true);
    assert.deepEqual(collectPrimitiveLeafPaths(loaded), leafPaths);
    assert.deepEqual(loaded, sanitized);
    assert.deepEqual(storagePlatform.getRecord(STORAGE_KEYS.settings), sanitized);
});

test('SettingsManager keeps a fully changed snapshot through sanitize, save and load', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    const derivedLeaves = createDerivedLeafExpectations(defaults);
    const { changed, intended, unchanged } = createFullyChangedSnapshot(defaults);

    assert.deepEqual(unchanged, [...UNCHANGED_LEAF_PATHS]);
    assert.equal(intended.size + unchanged.length, collectPrimitiveLeafPaths(defaults).length);
    assert.ok(intended.size >= 150, `expected a broad mutation set, got ${intended.size} leaves`);

    const sanitized = manager.sanitizeSettings(changed);
    for (const [path, expectedValue] of intended) {
        if (derivedLeaves.has(path)) {
            assert.deepEqual(
                readPathValue(sanitized, path),
                derivedLeaves.get(path),
                `derived leaf ${path} no longer carries its forced value`
            );
            continue;
        }
        assert.deepEqual(
            readPathValue(sanitized, path),
            expectedValue,
            `sanitize dropped the stored value of ${path}`
        );
    }

    const saveResult = manager.saveSettings(sanitized);
    const loaded = manager.loadSettings();

    assert.equal(saveResult.success, true);
    assert.deepEqual(loaded, sanitized);
    assert.deepEqual(collectPrimitiveLeafPaths(loaded), collectPrimitiveLeafPaths(defaults));
});

test('SettingsManager keeps the arcade block and hunt limits when settings are saved', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();

    const saved = manager.sanitizeSettings({
        ...structuredClone(defaults),
        arcade: {
            ...defaults.arcade,
            seed: 4242,
            sectorCount: 7,
            dailyChallenge: true,
        },
        hunt: {
            ...defaults.hunt,
            deathmatchKillLimit: 25,
            timeLimitEnabled: false,
        },
    });
    manager.saveSettings(saved);
    const loaded = manager.loadSettings();

    assert.equal(loaded.arcade.seed, 4242);
    assert.equal(loaded.arcade.sectorCount, 7);
    assert.equal(loaded.arcade.dailyChallenge, true);
    assert.equal(loaded.hunt.deathmatchKillLimit, 25);
    assert.equal(loaded.hunt.timeLimitEnabled, false);
});

test('SettingsManager derives hunt respawn from the stored mode path', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });

    // Respawn is not a free setting: the menu rules tie it to the mode path, so a stored
    // value that contradicts the path is corrected instead of being kept.
    const fightSnapshot = manager.sanitizeSettings({
        localSettings: { modePath: 'fight' },
        hunt: { respawnEnabled: false },
    });
    const normalSnapshot = manager.sanitizeSettings({
        localSettings: { modePath: 'normal' },
        hunt: { respawnEnabled: true },
    });
    const arcadeSnapshot = manager.sanitizeSettings({
        localSettings: { modePath: 'arcade' },
        hunt: { respawnEnabled: true },
    });

    assert.equal(fightSnapshot.gameMode, 'HUNT');
    assert.equal(fightSnapshot.hunt.respawnEnabled, true);
    assert.equal(normalSnapshot.gameMode, 'CLASSIC');
    assert.equal(normalSnapshot.hunt.respawnEnabled, false);
    assert.equal(arcadeSnapshot.gameMode, 'ARCADE');
    assert.equal(arcadeSnapshot.hunt.respawnEnabled, false);
});

test('SettingsManager clamps every gameplay field to its declared limit rule', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settingsVersion = manager.createDefaultSettings().settingsVersion;
    const belowMinimum = {};
    const aboveMaximum = {};
    for (const [field, rule] of Object.entries(SETTINGS_LIMITS.gameplay)) {
        belowMinimum[field] = rule.min - 1000;
        aboveMaximum[field] = rule.max + 1000;
    }

    const clampedLow = manager.sanitizeSettings({ settingsVersion, gameplay: belowMinimum }).gameplay;
    const clampedHigh = manager.sanitizeSettings({ settingsVersion, gameplay: aboveMaximum }).gameplay;

    for (const [field, rule] of Object.entries(SETTINGS_LIMITS.gameplay)) {
        assert.equal(clampedLow[field], rule.min, `${field} is not clamped to its minimum`);
        assert.equal(clampedHigh[field], rule.max, `${field} is not clamped to its maximum`);
    }
});

test('SettingsManager clamps the deathmatch kill limit to its contract range', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    const rule = SETTINGS_LIMITS.hunt.deathmatchKillLimit;
    const sanitizeKillLimit = (value) => (
        manager.sanitizeSettings({ hunt: { deathmatchKillLimit: value } }).hunt.deathmatchKillLimit
    );

    assert.equal(sanitizeKillLimit(rule.max + 150), rule.max);
    assert.equal(sanitizeKillLimit(rule.min - 6), rule.min);
    assert.equal(sanitizeKillLimit(0), rule.min);
    assert.equal(sanitizeKillLimit(12.7), 12);
    assert.equal(sanitizeKillLimit('broken'), defaults.hunt.deathmatchKillLimit);
    assert.equal(sanitizeKillLimit(undefined), defaults.hunt.deathmatchKillLimit);
});

test('SettingsManager sanitize is stable when it runs twice on its own output', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    const { changed } = createFullyChangedSnapshot(defaults);

    const once = manager.sanitizeSettings(changed);
    const twice = manager.sanitizeSettings(once);

    assert.deepEqual(twice, once);
});
