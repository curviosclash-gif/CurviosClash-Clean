import assert from 'node:assert/strict';
import test from 'node:test';

import { GameRuntimeSettingsHandler } from '../src/core/runtime/GameRuntimeSettingsHandler.js';
import { handleQuickStartEventPlaylistStartAction } from '../src/core/runtime/MenuRuntimeQuickStartService.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';

const AUTO_SAVE_DELAY_MS = 400;

/**
 * Replaces the global timers so the debounced autosave can be stepped forward without
 * real waiting. The handler calls the bare setTimeout/clearTimeout, so swapping the
 * globals is enough and no production seam is needed.
 */
function installControlledTimers() {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const pendingTimers = new Map();
    let nextTimerId = 1;

    globalThis.setTimeout = (callback, delayMs) => {
        const timerId = nextTimerId;
        nextTimerId += 1;
        pendingTimers.set(timerId, { callback, delayMs: Number(delayMs) || 0 });
        return timerId;
    };
    globalThis.clearTimeout = (timerId) => {
        pendingTimers.delete(timerId);
    };

    return {
        advance(byMs) {
            for (const [timerId, timer] of Array.from(pendingTimers)) {
                if (timer.delayMs > byMs) continue;
                pendingTimers.delete(timerId);
                timer.callback();
            }
        },
        countPending() {
            return pendingTimers.size;
        },
        restore() {
            globalThis.setTimeout = realSetTimeout;
            globalThis.clearTimeout = realClearTimeout;
        },
    };
}

/**
 * Stands for Game plus SettingsManager: applyMenuPreset writes the preset straight into
 * the live settings (including the preset's own map), exactly like the real manager, and
 * saveSettings is the only way anything reaches the store.
 */
function createQuickStartHarness({ baselineMapKey = 'mega_maze', presetMapKey = 'parcours_rift' } = {}) {
    const persisted = { value: null, saveCount: 0 };
    const game = {
        settingsDirty: false,
        // The quickstart is gated by the surface policy; the desktop surface allows it.
        uiManager: {
            _runtimeFeatureFlags: { surfacePolicy: { productSurfaceId: 'desktop-app' } },
            syncAll() {},
            syncByChangeKeys() {},
            updateContext() {},
            clearStartValidationError() {},
        },
        settings: {
            mapKey: baselineMapKey,
            matchSettings: { activePresetId: '' },
            localSettings: {
                sessionType: 'single',
                modePath: 'normal',
            },
        },
        settingsManager: {
            applyMenuPreset(targetSettings, presetId) {
                targetSettings.mapKey = presetMapKey;
                targetSettings.matchSettings = {
                    ...(targetSettings.matchSettings || {}),
                    activePresetId: presetId,
                };
                return { success: true, changedKeys: [SETTINGS_CHANGE_KEYS.MAP_KEY] };
            },
            applyMenuCompatibilityRules() {
                return { changedKeys: [] };
            },
            saveSettings(settingsToPersist) {
                persisted.value = JSON.parse(JSON.stringify(settingsToPersist));
                persisted.saveCount += 1;
                return { ok: true };
            },
        },
        _saveSettings() {
            game.settingsManager.saveSettings(game.settings);
        },
        _showStatusToast() {},
    };

    const facade = {
        game,
        _resolveMenuAccessContext: () => ({ isOwner: true }),
    };
    const handler = new GameRuntimeSettingsHandler({ facade });
    facade.onSettingsChanged = (payload) => handler.onSettingsChanged(payload);
    facade.cancelPendingSettingsAutoSave = () => handler.cancelPendingSettingsAutoSave?.();

    const quickStartContext = {
        game,
        event: null,
        onSettingsChanged: (payload) => facade.onSettingsChanged(payload),
        resolveMenuAccessContext: () => facade._resolveMenuAccessContext(),
        recordMenuTelemetry: () => {},
        startMatch: () => true,
        markSettingsDirty: (isDirty) => handler.markSettingsDirty(isDirty),
        cancelPendingSettingsAutoSave: () => facade.cancelPendingSettingsAutoSave(),
    };

    return { game, handler, persisted, quickStartContext };
}

test('an event playlist start keeps the player map in the store after the autosave window', async () => {
    const { game, persisted, quickStartContext } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.equal(game.settings.mapKey, 'parcours_rift', 'the running match uses the playlist preset map');
    assert.equal(
        persisted.value?.localSettings?.eventPlaylistState?.nextIndex,
        1,
        'the playlist cursor is persisted so the next start takes the following preset'
    );
    assert.equal(
        persisted.value?.mapKey,
        'mega_maze',
        'the stored map stays the player choice instead of the playlist preset map'
    );
    assert.equal(
        persisted.value?.localSettings?.modePath,
        'normal',
        'the stored mode path stays the player choice as well'
    );
});

test('a plain settings change is still written by the autosave', async () => {
    const { game, handler, persisted } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        game.settings.mapKey = 'burg';
        handler.onSettingsChanged({ changedKeys: [SETTINGS_CHANGE_KEYS.MAP_KEY] });
        assert.equal(persisted.saveCount, 0, 'the autosave is debounced, not immediate');
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.equal(persisted.saveCount, 1, 'the debounced autosave ran once');
    assert.equal(persisted.value?.mapKey, 'burg', 'a normal map change still reaches the store');
});

test('an event playlist start drops an autosave that was already pending', async () => {
    const { game, handler, persisted, quickStartContext } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        // A settings change moments before the playlist start leaves its own timer armed.
        handler.onSettingsChanged({ changedKeys: [SETTINGS_CHANGE_KEYS.MAP_KEY] });
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        assert.equal(timers.countPending(), 0, 'no autosave timer survives the deliberate snapshot save');
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.equal(game.settings.mapKey, 'parcours_rift', 'the running match still uses the preset map');
    assert.equal(persisted.value?.mapKey, 'mega_maze', 'the stored map stays the player choice');
});
