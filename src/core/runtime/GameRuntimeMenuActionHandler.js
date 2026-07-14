import { SETTINGS_CHANGE_KEYS } from '../../composition/core-ui/CoreUiMenuPorts.js';
import {
    handleConfigExportCodeAction,
    handleConfigExportJsonAction,
    handleConfigImportAction,
    applyMenuPresetAction,
    saveMenuPresetAction,
    deleteMenuPresetAction,
} from './MenuRuntimePresetConfigService.js';
import {
    handleMultiplayerLeaveAction,
    handleMultiplayerReadyToggleAction,
} from './MenuRuntimeMultiplayerService.js';
import {
    handleDeveloperActorChangeAction,
    handleDeveloperFixedPresetLockToggleAction,
    handleDeveloperModeToggleAction,
    handleDeveloperReleasePreviewToggleAction,
    handleDeveloperTextOverrideClearAction,
    handleDeveloperTextOverrideSetAction,
    handleDeveloperThemeChangeAction,
    handleDeveloperVisibilityChangeAction,
} from './MenuRuntimeDeveloperModeService.js';
import {
    SESSION_SWITCH_CHANGED_KEYS,
    handleLevel3ResetAction,
    handleLevel4CloseAction,
    handleLevel4OpenAction,
    handleLevel4ResetAction,
    handleModePathChangeAction,
    handleQuickStartEventPlaylistStartAction,
    handleQuickStartLastStartAction,
    handleQuickStartRandomStartAction,
    handleSessionTypeChangeAction,
} from './MenuRuntimeSessionService.js';

export class GameRuntimeMenuActionHandler {
    constructor({ facade = null } = {}) {
        this._facade = facade || null;
    }

    handleMenuPanelChanged(previousPanelId, nextPanelId, transitionMetadata = null) {
        const fromPanelId = String(previousPanelId || '').trim();
        const toPanelId = String(nextPanelId || '').trim();
        const trigger = String(transitionMetadata?.trigger || '').trim();
        if (toPanelId) return;
        if (!fromPanelId || fromPanelId === 'submenu-custom') {
            if (trigger === 'back_button' || trigger === 'escape') {
                this._facade?._recordMenuTelemetry?.('backtrack', { fromPanelId, trigger });
            }
            return;
        }

        const isBacktrack = trigger === 'back_button' || trigger === 'escape';
        if (isBacktrack) {
            this._facade?._recordMenuTelemetry?.('backtrack', { fromPanelId, trigger });
        }
        if (fromPanelId === 'submenu-game') {
            this._facade?._recordMenuTelemetry?.('abort', { fromPanelId, trigger });
        }
    }

    handleSessionTypeChange(event) {
        handleSessionTypeChangeAction(this._createSessionContext(event));
    }

    handleModePathChange(event) {
        handleModePathChangeAction(this._createSessionContext(event));
    }

    handleQuickStartLastStart() {
        handleQuickStartLastStartAction(this._createSessionContext());
    }

    handleQuickStartEventPlaylistStart() {
        handleQuickStartEventPlaylistStartAction(this._createSessionContext());
    }

    handleQuickStartRandomStart() {
        handleQuickStartRandomStartAction(this._createSessionContext());
    }

    handleLevel3Reset() {
        handleLevel3ResetAction(this._createSessionContext());
    }

    handleLevel4Open(event) {
        handleLevel4OpenAction(this._createSessionContext(event));
    }

    handleLevel4Close() {
        handleLevel4CloseAction(this._createSessionContext());
    }

    handleLevel4Reset() {
        handleLevel4ResetAction(this._createSessionContext());
    }

    handleConfigExportCode() {
        handleConfigExportCodeAction(this._facade?.game);
    }

    handleConfigExportJson() {
        handleConfigExportJsonAction(this._facade?.game);
    }

    handleConfigImport(event) {
        const game = this._facade?.game;
        handleConfigImportAction({
            game,
            inputValue: String(event?.inputValue || game?.ui?.configShareInput?.value || ''),
            onSettingsChanged: (payload) => this._facade?.onSettingsChanged?.(payload),
            sessionSwitchChangedKeys: SESSION_SWITCH_CHANGED_KEYS,
        });
    }

    applyMenuPreset(event) {
        applyMenuPresetAction({
            game: this._facade?.game,
            presetId: String(event?.presetId || '').trim(),
            resolveMenuAccessContext: () => this._facade?._resolveMenuAccessContext?.(),
            onSettingsChanged: (payload) => this._facade?.onSettingsChanged?.(payload),
            settingsChangeKeys: SETTINGS_CHANGE_KEYS,
        });
    }

    saveMenuPreset(event, kind) {
        saveMenuPresetAction({
            game: this._facade?.game,
            kind,
            presetName: String(event?.name || '').trim(),
            sourcePresetId: String(event?.sourcePresetId || '').trim(),
            resolveMenuAccessContext: () => this._facade?._resolveMenuAccessContext?.(),
            onSettingsChanged: (payload) => this._facade?.onSettingsChanged?.(payload),
            settingsChangeKeys: SETTINGS_CHANGE_KEYS,
        });
    }

    deleteMenuPreset(event) {
        deleteMenuPresetAction({
            game: this._facade?.game,
            presetId: String(event?.presetId || '').trim(),
            resolveMenuAccessContext: () => this._facade?._resolveMenuAccessContext?.(),
            onSettingsChanged: (payload) => this._facade?.onSettingsChanged?.(payload),
            settingsChangeKeys: SETTINGS_CHANGE_KEYS,
        });
    }

    handleMultiplayerHost(event) {
        return this._facade?.hostLobby?.({
            lobbyCode: String(event?.lobbyCode || '').trim(),
        });
    }

    handleMultiplayerJoin(event) {
        return this._facade?.joinLobby?.({
            lobbyCode: String(event?.lobbyCode || '').trim(),
            signalingUrl: String(event?.signalingUrl || '').trim(),
        });
    }

    handleMultiplayerLeaveLobby(event) {
        return handleMultiplayerLeaveAction({
            game: this._facade?.game,
            menuMultiplayerBridge: this._facade?.menuMultiplayerBridge,
            syncUiState: () => this._facade?._syncMultiplayerUiState?.(),
        });
    }

    handleMultiplayerReadyToggle(event) {
        handleMultiplayerReadyToggleAction({
            game: this._facade?.game,
            event,
            resolveMenuAccessContext: () => this._facade?._resolveMenuAccessContext?.(),
            menuMultiplayerBridge: this._facade?.menuMultiplayerBridge,
            syncUiState: () => this._facade?._syncMultiplayerUiState?.(),
        });
    }

    handleDeveloperModeToggle(event) {
        handleDeveloperModeToggleAction(this._createDeveloperModeContext(event));
    }

    handleDeveloperThemeChange(event) {
        handleDeveloperThemeChangeAction(this._createDeveloperModeContext(event));
    }

    handleDeveloperVisibilityChange(event) {
        handleDeveloperVisibilityChangeAction(this._createDeveloperModeContext(event));
    }

    handleDeveloperFixedPresetLockToggle(event) {
        handleDeveloperFixedPresetLockToggleAction(this._createDeveloperModeContext(event));
    }

    handleDeveloperActorChange(event) {
        handleDeveloperActorChangeAction(this._createDeveloperModeContext(event));
    }

    handleDeveloperReleasePreviewToggle(event) {
        handleDeveloperReleasePreviewToggleAction(this._createDeveloperModeContext(event));
    }

    handleDeveloperTextOverrideSet(event) {
        handleDeveloperTextOverrideSetAction(this._createDeveloperModeContext(event));
    }

    handleDeveloperTextOverrideClear(event) {
        handleDeveloperTextOverrideClearAction(this._createDeveloperModeContext(event));
    }

    startKeyCapture(event) {
        this._facade?.game?.keybindEditorController?.startKeyCapture?.(event?.player, event?.action);
    }

    resetKeys() {
        const game = this._facade?.game;
        if (!game?.settingsManager || !game?.settings) return;
        game.settings.controls = game.settingsManager.cloneDefaultControls();
        this._facade?.onSettingsChanged?.();
        game._showStatusToast?.('Standard-Tasten wiederhergestellt');
    }

    saveKeys() {
        this._facade?.game?._saveSettings?.();
        this._facade?.game?._showStatusToast?.('Einstellungen gespeichert');
    }

    showStatusToast(event) {
        this._facade?.game?._showStatusToast?.(event?.message, event?.duration, event?.tone);
    }

    _createSessionContext(event = null) {
        return {
            game: this._facade?.game,
            event,
            onSettingsChanged: (payload) => this._facade?.onSettingsChanged?.(payload),
            resolveMenuAccessContext: () => this._facade?._resolveMenuAccessContext?.(),
            recordMenuTelemetry: (type, payload) => this._facade?._recordMenuTelemetry?.(type, payload),
            startMatch: () => this._facade?.startMatch?.(),
            markSettingsDirty: (dirty) => this._facade?.markSettingsDirty?.(dirty),
        };
    }

    _createDeveloperModeContext(event = null) {
        return {
            game: this._facade?.game,
            event,
            resolveMenuAccessContext: () => this._facade?._resolveMenuAccessContext?.(),
            onSettingsChanged: (payload) => this._facade?.onSettingsChanged?.(payload),
            SETTINGS_CHANGE_KEYS,
        };
    }
}
