import { GAME_MODE_TYPES } from '../../hunt/HuntMode.js';
import {
    HANGAR_SELECTION_PLAYER_SLOTS,
    writeHangarMapSelection,
    writeHangarVehicleSelection,
} from '../../composition/core-ui/CoreUiMenuPorts.js';
import { SETTINGS_CHANGE_KEYS } from '../../shared/settings/SettingsChangeKeys.js';
import { CONFIG } from '../Config.js';
import { MATCH_SETTING_CHANGE_KEY_SET, START_VALIDATION_RELEVANT_KEY_SET } from './GameRuntimeSettingsKeySets.js';
import { resolveMatchStartValidationIssue } from './MatchStartValidationService.js';
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import {
    applyMultiplayerMatchSettingsSnapshot,
    createMultiplayerMatchSettingsSnapshot,
    didHostChangeMatchSettings,
    invalidateMultiplayerReadyIfHostChangedSettings,
} from './MenuRuntimeMultiplayerService.js';
import { orchestrateRuntimeSettingsChanged } from './RuntimeSettingsChangeOrchestrator.js';
import { filterKnownSettingsChangeKeys } from './RuntimeSettingsChangeKeys.js';
import { resolveMapSinglePlayerScenario } from '../../shared/contracts/MapSinglePlayerScenarioContract.js';
import { RUNTIME_SESSION_TYPES, resolveRuntimeSessionContract } from '../../shared/contracts/RuntimeSessionContract.js';

export class GameRuntimeSettingsHandler {
    constructor({ facade = null } = {}) {
        this._facade = facade || null;
        this._pendingAutoSaveId = null;
        // Bot count a scenario map replaced for its match, handed back on the way to the menu.
        this._scenarioBotCountRestore = null;
    }

    captureMultiplayerMatchSettings() {
        return createMultiplayerMatchSettingsSnapshot(this._facade?.game?.settings);
    }

    applyAuthoritativeMultiplayerMatchSettings(snapshot) {
        const game = this._facade?.game;
        if (!game?.settings) return;
        applyMultiplayerMatchSettingsSnapshot(game.settings, snapshot);
        game.settingsManager?.applyMenuCompatibilityRules?.(
            game.settings,
            { accessContext: this._facade?._resolveMenuAccessContext?.() }
        );
        const modePath = game.settings?.localSettings?.modePath;
        writeHangarMapSelection(
            game.settings,
            game.settings.mapKey,
            game.settings.mapKey,
            { modePath }
        );
        for (const playerSlot of Object.values(HANGAR_SELECTION_PLAYER_SLOTS)) {
            const vehicleId = game.settings?.vehicles?.[playerSlot];
            writeHangarVehicleSelection(
                game.settings,
                playerSlot,
                vehicleId,
                vehicleId,
                { modePath }
            );
        }
        this.markSettingsDirty(false);
        game.uiManager?.syncAll?.();
        game.uiManager?.updateContext?.();
    }

    didHostChangeMatchSettings(changedKeys) {
        return didHostChangeMatchSettings(changedKeys, MATCH_SETTING_CHANGE_KEY_SET);
    }

    invalidateMultiplayerReadyIfHostChangedSettings(changedKeys) {
        invalidateMultiplayerReadyIfHostChangedSettings({
            changedKeys,
            matchSettingChangeKeySet: MATCH_SETTING_CHANGE_KEY_SET,
            resolveMenuAccessContext: () => this._facade?._resolveMenuAccessContext?.(),
            menuMultiplayerBridge: this._facade?.menuMultiplayerBridge,
            game: this._facade?.game,
            onSettingsChanged: (payload) => this._facade?.onSettingsChanged?.(payload),
            settingsChangeKeys: SETTINGS_CHANGE_KEYS,
        });
    }

    resolveStartValidationIssue() {
        return resolveMatchStartValidationIssue({
            settings: this._facade?.game?.settings,
            ui: this._facade?.game?.ui,
            multiplayerSessionState: this._facade?.menuMultiplayerBridge?.getSessionState?.(),
            maps: CONFIG?.MAPS,
            huntModeType: GAME_MODE_TYPES.HUNT,
            productSurfaceId: this._facade?.game?.uiManager?._runtimeFeatureFlags?.surfacePolicy?.productSurfaceId || '',
        });
    }

    applySurfacePolicyStartDefaults() {
        const game = this._facade?.game;
        if (!game?.settings) return null;

        const surfacePolicyPort = createSurfacePolicyPort({
            getProductSurfaceId: () => game?.uiManager?._runtimeFeatureFlags?.surfacePolicy?.productSurfaceId || ''
        });
        const migration = surfacePolicyPort.applyMenuState(game.settings, {
            maps: CONFIG?.MAPS,
        });
        if (!migration?.changed) {
            return migration;
        }

        const surfaceChangedKeys = migration.changedKeys.map((key) => (
            key === 'sessionType'
                ? SETTINGS_CHANGE_KEYS.SESSION_TYPE
                : (key === 'modePath'
                    ? SETTINGS_CHANGE_KEYS.MODE_PATH
                    : SETTINGS_CHANGE_KEYS.MAP_KEY)
        ));
        const compatibilityResult = game.settingsManager?.applyMenuCompatibilityRules?.(
            game.settings,
            {
                accessContext: this._facade?._resolveMenuAccessContext?.(),
                changedKeys: surfaceChangedKeys,
            }
        );
        surfacePolicyPort.applyMenuState(game.settings, {
            maps: CONFIG?.MAPS,
        });
        writeHangarMapSelection(
            game.settings,
            game.settings.mapKey,
            game.settings.mapKey,
            { modePath: game.settings?.localSettings?.modePath }
        );
        const changedKeys = filterKnownSettingsChangeKeys([
            ...surfaceChangedKeys,
            ...(Array.isArray(compatibilityResult?.changedKeys) ? compatibilityResult.changedKeys : []),
        ]);

        this._facade?.applySettingsToRuntime?.({ schedulePrewarm: false });
        this._facade?._syncMultiplayerRuntimeContext?.(changedKeys);
        game.uiManager?.syncByChangeKeys?.(changedKeys);
        game.uiManager?.updateContext?.();
        this.invalidateMultiplayerReadyIfHostChangedSettings(changedKeys);
        this.updateSaveButtonState();

        return {
            ...migration,
            changedKeys,
        };
    }

    applyMapScenarioStartDefaults() {
        const facade = this._facade;
        const game = facade?.game;
        const settings = game?.settings;
        if (!settings) return null;

        const session = resolveRuntimeSessionContract(settings.localSettings);
        if (session.sessionType !== RUNTIME_SESSION_TYPES.SINGLE) {
            return { changed: false, changedKeys: [] };
        }

        const mapDefinition = CONFIG?.MAPS?.[settings.mapKey];
        const scenario = resolveMapSinglePlayerScenario(mapDefinition);
        if (!scenario) {
            return { changed: false, changedKeys: [] };
        }

        const changedKeys = [];
        const botCountBefore = Number(settings.numBots);
        if (settings.localSettings.modePath !== scenario.modePath) {
            settings.localSettings.modePath = scenario.modePath;
            changedKeys.push(SETTINGS_CHANGE_KEYS.MODE_PATH);
        }
        if (settings.gameMode !== scenario.gameMode) {
            settings.gameMode = scenario.gameMode;
            changedKeys.push(SETTINGS_CHANGE_KEYS.GAME_MODE);
        }
        if (Number.isInteger(scenario.botCount) && Number(settings.numBots) !== scenario.botCount) {
            settings.numBots = scenario.botCount;
            changedKeys.push(SETTINGS_CHANGE_KEYS.BOTS_COUNT);
        } else if (Number(settings.numBots) < scenario.minBots) {
            settings.numBots = scenario.minBots;
            changedKeys.push(SETTINGS_CHANGE_KEYS.BOTS_COUNT);
        }
        if (changedKeys.includes(SETTINGS_CHANGE_KEYS.BOTS_COUNT) && !this._scenarioBotCountRestore) {
            this._scenarioBotCountRestore = { numBots: botCountBefore, scenarioNumBots: settings.numBots };
        }
        if (changedKeys.length === 0) {
            return { changed: false, changedKeys: [] };
        }

        const compatibilityResult = game.settingsManager?.applyMenuCompatibilityRules?.(
            settings,
            {
                accessContext: facade?._resolveMenuAccessContext?.(),
                changedKeys,
            }
        );
        const resolvedChangedKeys = filterKnownSettingsChangeKeys([
            ...changedKeys,
            ...(Array.isArray(compatibilityResult?.changedKeys) ? compatibilityResult.changedKeys : []),
        ]);

        writeHangarMapSelection(
            settings,
            settings.mapKey,
            settings.mapKey,
            { modePath: settings.localSettings.modePath }
        );
        facade?._applySettingsToRuntimeInternal?.({ schedulePrewarm: false });
        game.uiManager?.syncByChangeKeys?.(resolvedChangedKeys);
        game.uiManager?.updateContext?.();

        return {
            changed: true,
            scenarioId: scenario.id,
            changedKeys: resolvedChangedKeys,
        };
    }

    // A scenario map sets its bots for the match it starts. Written straight into the
    // settings, that count used to stay for every later map as well.
    restoreMapScenarioBotCount() {
        const restore = this._scenarioBotCountRestore;
        this._scenarioBotCountRestore = null;
        const game = this._facade?.game;
        const settings = game?.settings;
        if (!restore || !settings || Number(settings.numBots) !== restore.scenarioNumBots) return false;
        if (!Number.isFinite(restore.numBots)) return false;
        settings.numBots = restore.numBots;
        game.uiManager?.syncByChangeKeys?.([SETTINGS_CHANGE_KEYS.BOTS_COUNT]);
        game.uiManager?.updateContext?.();
        this._scheduleSettingsAutoSave();
        return true;
    }

    onSettingsChanged(event = null) {
        const changedKeys = orchestrateRuntimeSettingsChanged({
            game: this._facade?.game,
            event,
            resolveMenuAccessContext: () => this._facade?._resolveMenuAccessContext?.(),
            startValidationRelevantKeySet: START_VALIDATION_RELEVANT_KEY_SET,
            invalidateMultiplayerReadyIfHostChangedSettings: (nextChangedKeys) => this.invalidateMultiplayerReadyIfHostChangedSettings(nextChangedKeys),
            markSettingsDirty: (isDirty) => this.markSettingsDirty(isDirty),
            updateSaveButtonState: () => this.updateSaveButtonState(),
            scheduleMatchPrewarm: () => this._facade?.scheduleMatchPrewarm?.(),
        });
        this._facade?.applySettingsToRuntime?.({ schedulePrewarm: false });
        this._facade?._syncMultiplayerRuntimeContext?.(changedKeys);
        this._scheduleSettingsAutoSave();
        return changedKeys;
    }

    _scheduleSettingsAutoSave() {
        if (this._pendingAutoSaveId != null) {
            clearTimeout(this._pendingAutoSaveId);
        }
        this._pendingAutoSaveId = setTimeout(() => {
            this._pendingAutoSaveId = null;
            if (this._facade?._disposed === true) return;
            this._facade?.game?._saveSettings?.();
        }, 400);
    }

    dispose() {
        if (this._pendingAutoSaveId != null) {
            clearTimeout(this._pendingAutoSaveId);
            this._pendingAutoSaveId = null;
        }
        this._facade = null;
    }

    markSettingsDirty(isDirty) {
        const game = this._facade?.game;
        if (!game) return;
        game.settingsDirty = !!isDirty;
        this.updateSaveButtonState();
    }

    updateSaveButtonState() {
        const game = this._facade?.game;
        if (!game?.ui?.saveKeysButton) return;
        game.ui.saveKeysButton.classList.toggle('unsaved', game.settingsDirty);
        game.ui.saveKeysButton.textContent = game.settingsDirty
            ? 'Einstellungen explizit speichern *'
            : 'Einstellungen explizit speichern';
        game.uiManager?.updateContext?.();
    }
}
