import assert from 'node:assert/strict';
import test from 'node:test';

import { GameRuntimeMenuActionHandler } from '../src/core/runtime/GameRuntimeMenuActionHandler.js';
import { GameRuntimeSessionHandler } from '../src/core/runtime/GameRuntimeSessionHandler.js';
import { GameRuntimeSettingsHandler } from '../src/core/runtime/GameRuntimeSettingsHandler.js';
import { handleQuickStartEventPlaylistStartAction } from '../src/core/runtime/MenuRuntimeQuickStartService.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';

const AUTO_SAVE_DELAY_MS = 400;

/**
 * A scenario map: its singlePlayerScenario raises the bot count to four for the match it
 * starts, which is what makes the order of the two restores on the way back observable.
 */
const SCENARIO_MAP_KEY = 'parcours_assault';
const SCENARIO_MIN_BOTS = 4;

/**
 * The three fun-rotation presets the playlist hands out, reduced to the values that matter
 * here: every one of them replaces map, bot count, wins and a gameplay value. powerUps is
 * an array on purpose - a list is a leaf the diff cannot walk into.
 */
const PLAYLIST_PRESET_VALUES = {
    arcade: { mapKey: 'parcours_rift', numBots: 2, winsNeeded: 5, gameplaySpeed: 18, powerUps: ['boost', 'mine'] },
    chaos: { mapKey: 'chaos_arena', numBots: 6, winsNeeded: 3, gameplaySpeed: 24, powerUps: ['shock'] },
    competitive: { mapKey: 'maze', numBots: 0, winsNeeded: 7, gameplaySpeed: 12, powerUps: [] },
};

/**
 * Promise chains inside the quickstart action only need microtasks, never timers, so the
 * controlled timers stay installed while the pending steps run to their end.
 */
async function settlePromiseChains() {
    for (let step = 0; step < 12; step += 1) {
        await Promise.resolve();
    }
}

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
function createQuickStartHarness({
    baselineMapKey = 'mega_maze',
    baselineNumBots = 4,
    presetMapKey = null,
    onStartMatch = null,
} = {}) {
    const persisted = { value: null, saveCount: 0 };
    const startMatchCalls = [];
    const pendingStarts = [];
    let startMatchResult = true;
    let startsAreDeferred = false;
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
            numBots: baselineNumBots,
            winsNeeded: 3,
            gameplay: { speed: 10, powerUps: ['shield'] },
            audio: { masterVolume: 0.5 },
            matchSettings: { activePresetId: '' },
            localSettings: {
                sessionType: 'single',
                modePath: 'normal',
            },
        },
        settingsManager: {
            applyMenuPreset(targetSettings, presetId) {
                const presetValues = PLAYLIST_PRESET_VALUES[presetId] || PLAYLIST_PRESET_VALUES.arcade;
                targetSettings.mapKey = presetMapKey || presetValues.mapKey;
                targetSettings.numBots = presetValues.numBots;
                targetSettings.winsNeeded = presetValues.winsNeeded;
                targetSettings.gameplay = {
                    ...(targetSettings.gameplay || {}),
                    speed: presetValues.gameplaySpeed,
                    powerUps: [...presetValues.powerUps],
                };
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
        // Only the match teardown is stubbed; the way back to the menu itself is product code.
        finalizeMatch: () => true,
    };
    const handler = new GameRuntimeSettingsHandler({ facade });
    facade.settingsHandler = handler;
    facade.onSettingsChanged = (payload) => handler.onSettingsChanged(payload);
    facade.cancelPendingSettingsAutoSave = () => handler.cancelPendingSettingsAutoSave?.();
    facade.markSettingsDirty = (isDirty) => handler.markSettingsDirty(isDirty);
    facade._recordMenuTelemetry = () => {};
    // Stands for the real startMatch: it applies the scenario start defaults (when the test
    // asks for it) and may stay pending, which is the window a second click falls into.
    facade.startMatch = () => {
        startMatchCalls.push(String(game.settings?.matchSettings?.activePresetId || ''));
        if (typeof onStartMatch === 'function') onStartMatch({ handler, game });
        if (!startsAreDeferred) return startMatchResult;
        return new Promise((resolve) => {
            pendingStarts.push(() => resolve(startMatchResult));
        });
    };
    const sessionHandler = new GameRuntimeSessionHandler({ facade });
    const menuActionHandler = new GameRuntimeMenuActionHandler({ facade });

    // Mirrors GameRuntimeMenuActionHandler._createSessionContext.
    const quickStartContext = {
        game,
        event: null,
        onSettingsChanged: (payload) => facade.onSettingsChanged(payload),
        resolveMenuAccessContext: () => facade._resolveMenuAccessContext(),
        recordMenuTelemetry: () => {},
        startMatch: () => facade.startMatch(),
        markSettingsDirty: (isDirty) => handler.markSettingsDirty(isDirty),
        cancelPendingSettingsAutoSave: () => facade.cancelPendingSettingsAutoSave(),
        holdSessionSettingsRestore: (plan) => facade.settingsHandler?.holdSessionSettingsRestore?.(plan),
        restoreSessionSettings: () => facade.settingsHandler?.restoreSessionSettings?.(),
    };

    return {
        game,
        handler,
        sessionHandler,
        menuActionHandler,
        persisted,
        quickStartContext,
        startMatchCalls,
        failNextStart() {
            startMatchResult = false;
        },
        deferStarts() {
            startsAreDeferred = true;
        },
        flushStarts() {
            const waiting = pendingStarts.splice(0, pendingStarts.length);
            for (const resolveStart of waiting) resolveStart();
        },
    };
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

test('the way back to the menu hands the player configuration back before anything saves', async () => {
    const { game, handler, persisted, quickStartContext, sessionHandler } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        sessionHandler.returnToMenu();
        // Picking a style in the menu is already a settings change and arms the autosave.
        handler.onSettingsChanged({ changedKeys: [SETTINGS_CHANGE_KEYS.MODE_PATH] });
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.equal(game.settings.mapKey, 'mega_maze', 'the menu runs on the player map again');
    assert.equal(game.settings.numBots, 4, 'the menu runs on the player bot count again');
    assert.equal(game.settings.localSettings.modePath, 'normal', 'the menu runs on the player mode path again');
    assert.equal(
        game.settings.matchSettings.activePresetId,
        '',
        'the menu no longer claims the playlist preset as the active one'
    );
    assert.equal(
        persisted.value?.matchSettings?.activePresetId,
        '',
        'the stored active preset is the player state, not the playlist preset'
    );
    assert.equal(persisted.value?.mapKey, 'mega_maze', 'the stored map is the player choice, not the playlist preset');
    assert.equal(persisted.value?.numBots, 4, 'the stored bot count is the player choice');
    assert.equal(
        persisted.value?.localSettings?.modePath,
        'normal',
        'the stored mode path is the player choice'
    );
    assert.equal(
        persisted.value?.localSettings?.eventPlaylistState?.nextIndex,
        1,
        'the playlist cursor stays advanced so the next start takes the following preset'
    );
});

test('a pause menu change outside the preset survives the way back to the menu', async () => {
    const { game, handler, persisted, quickStartContext, sessionHandler } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        // Volume is not part of any playlist preset, so the restore must not touch it.
        game.settings.audio.masterVolume = 0.2;
        handler.onSettingsChanged({ changedKeys: [SETTINGS_CHANGE_KEYS.MAP_KEY] });
        sessionHandler.returnToMenu();
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.equal(game.settings.audio.masterVolume, 0.2, 'the volume set during the match stays');
    assert.equal(persisted.value?.audio?.masterVolume, 0.2, 'the volume set during the match is stored');
    assert.equal(persisted.value?.mapKey, 'mega_maze', 'the map is still handed back to the player choice');
});

test('a preset value the player changed himself during the match wins over the restore', async () => {
    const { game, persisted, quickStartContext, sessionHandler } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        // The player raises the bot count himself while the playlist match runs.
        game.settings.numBots = 7;
        sessionHandler.returnToMenu();
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.equal(game.settings.numBots, 7, 'the bot count the player picked himself stays');
    assert.equal(persisted.value?.numBots, 7, 'the bot count the player picked himself is stored');
    assert.equal(game.settings.mapKey, 'mega_maze', 'the untouched preset values are still handed back');
});

test('a failed start hands the settings back at once and leaves the playlist cursor alone', async () => {
    const { game, persisted, quickStartContext, failNextStart } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        failNextStart();
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        assert.equal(game.settings.mapKey, 'mega_maze', 'no match ran, so the player map is back at once');
        timers.advance(AUTO_SAVE_DELAY_MS);
        assert.equal(timers.countPending(), 0, 'no autosave timer is left behind');
    } finally {
        timers.restore();
    }

    assert.equal(persisted.value?.mapKey, 'mega_maze', 'the store keeps the player map');
    assert.equal(persisted.value?.numBots, 4, 'the store keeps the player bot count');
    assert.equal(
        game.settings.localSettings.eventPlaylistState?.nextIndex ?? 0,
        0,
        'a start that never ran does not advance the playlist cursor'
    );
});

test('the second playlist start rotates on and still restores the player configuration', async () => {
    const { game, persisted, quickStartContext, sessionHandler, startMatchCalls } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        sessionHandler.returnToMenu();
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        assert.equal(game.settings.mapKey, 'chaos_arena', 'the second start runs the next playlist preset');
        sessionHandler.returnToMenu();
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.deepEqual(startMatchCalls, ['arcade', 'chaos'], 'the rotation moved on to the next entry');
    assert.equal(game.settings.mapKey, 'mega_maze', 'the menu is back on the player map, not on the first preset map');
    assert.equal(game.settings.numBots, 4, 'the menu is back on the player bot count');
    assert.equal(game.settings.gameplay.speed, 10, 'the menu is back on the player speed');
    assert.equal(persisted.value?.mapKey, 'mega_maze', 'the store holds the player map after two playlist rounds');
    assert.equal(
        persisted.value?.localSettings?.eventPlaylistState?.nextIndex,
        2,
        'the playlist cursor keeps counting across the restores'
    );
});

test('a list the player edits in place during the match wins over the restore', async () => {
    const { game, persisted, quickStartContext, sessionHandler } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        assert.deepEqual(game.settings.gameplay.powerUps, ['boost', 'mine'], 'the preset list is live');
        // The player edits the running list itself instead of replacing it - same array, one
        // more entry. That is still his decision and must survive the way back.
        game.settings.gameplay.powerUps.push('laser');
        sessionHandler.returnToMenu();
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.deepEqual(
        game.settings.gameplay.powerUps,
        ['boost', 'mine', 'laser'],
        'the list the player edited in place stays as he left it'
    );
    assert.deepEqual(
        persisted.value?.gameplay?.powerUps,
        ['boost', 'mine', 'laser'],
        'the list the player edited in place is stored'
    );
    assert.equal(game.settings.mapKey, 'mega_maze', 'the untouched preset values are still handed back');
});

test('a scenario map hands the bot count back to the player, not to the playlist preset', async () => {
    const { game, handler, persisted, quickStartContext, sessionHandler } = createQuickStartHarness({
        baselineNumBots: 6,
        presetMapKey: SCENARIO_MAP_KEY,
        // The real start applies the scenario defaults right before the match runs.
        onStartMatch: () => handler.applyMapScenarioStartDefaults(),
    });
    const timers = installControlledTimers();
    try {
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        assert.equal(
            game.settings.numBots,
            SCENARIO_MIN_BOTS,
            'the scenario raised the preset bot count for its own match'
        );
        sessionHandler.returnToMenu();
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    // Both restores run on the way back: the scenario count first, so the playlist restore
    // sees the preset value it wrote itself and may hand the player value back.
    assert.equal(game.settings.numBots, 6, 'the menu runs on the player bot count again');
    assert.equal(persisted.value?.numBots, 6, 'the stored bot count is the player choice');
    assert.equal(game.settings.mapKey, 'mega_maze', 'the menu runs on the player map again');
});

test('a normal match after the playlist leaves a value that matches the old preset alone', async () => {
    const { game, persisted, quickStartContext, sessionHandler } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        await handleQuickStartEventPlaylistStartAction(quickStartContext);
        sessionHandler.returnToMenu();
        // The player now picks, for his own match, exactly the values the playlist preset used.
        game.settings.mapKey = 'parcours_rift';
        game.settings.numBots = 2;
        sessionHandler.returnToMenu();
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.equal(game.settings.mapKey, 'parcours_rift', 'his own map stays even though the preset used it too');
    assert.equal(game.settings.numBots, 2, 'his own bot count stays even though the preset used it too');
    assert.equal(persisted.value?.mapKey, 'parcours_rift', 'the store holds his own map');
    assert.equal(persisted.value?.numBots, 2, 'the store holds his own bot count');
});

test('a second playlist click while the start still runs does not skip an entry', async () => {
    const {
        game,
        persisted,
        menuActionHandler,
        startMatchCalls,
        deferStarts,
        flushStarts,
    } = createQuickStartHarness();
    const timers = installControlledTimers();
    try {
        deferStarts();
        // Two clicks on the quickstart button without waiting: the menu binding emits both.
        const firstClick = menuActionHandler.handleQuickStartEventPlaylistStart();
        const secondClick = menuActionHandler.handleQuickStartEventPlaylistStart();
        flushStarts();
        await Promise.all([firstClick, secondClick]);
        await settlePromiseChains();
        timers.advance(AUTO_SAVE_DELAY_MS);
    } finally {
        timers.restore();
    }

    assert.deepEqual(startMatchCalls, ['arcade'], 'only the first click started a match');
    assert.equal(game.settings.mapKey, 'parcours_rift', 'the running match is the first playlist entry');
    assert.equal(
        persisted.value?.localSettings?.eventPlaylistState?.nextIndex,
        1,
        'the playlist cursor advanced exactly once, so no entry is skipped'
    );
    assert.equal(
        persisted.value?.mapKey,
        'mega_maze',
        'the stored baseline is the player map, not the map the first preset already wrote'
    );
});
