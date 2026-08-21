import './four-player-planar.css';

import { CONFIG } from '../core/Config.js';
import { getVehicleIds, VEHICLE_DEFINITIONS } from '../entities/vehicle-registry.js';
import { resolveInventoryActionAvailability } from '../shared/contracts/GameplayActionAvailabilityContract.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { isMapEligibleForModePath } from '../shared/contracts/MapModeContract.js';
import { FourPlayerPlanarHudView } from '../ui/four-player-planar/FourPlayerPlanarHudView.js';
import { FourPlayerPlanarSetupView } from '../ui/four-player-planar/FourPlayerPlanarSetupView.js';
import { createFourPlayerPlanarInputSource } from './FourPlayerPlanarInputSource.js';
import {
    FOUR_PLAYER_PLANAR_HUMAN_COUNT,
    FOUR_PLAYER_PLANAR_KEY_BINDINGS,
    FOUR_PLAYER_PLANAR_MODES,
    FOUR_PLAYER_PLANAR_PLAYER_COLORS,
    SPLIT_SCREEN_VARIANTS,
    isFourPlayerPlanarRuntime,
    normalizeFourPlayerPlanarSettings,
} from './FourPlayerPlanarContract.js';

function resolveMapLabel(mapKey, definition) {
    return String(definition?.name || definition?.label || mapKey);
}

function resolveVehicleLabel(vehicleId) {
    const definition = VEHICLE_DEFINITIONS?.[vehicleId];
    return String(definition?.name || definition?.label || vehicleId);
}

export class FourPlayerPlanarModule {
    constructor({ runtimePort, setupView = null, hudView = null, documentRef = globalThis.document } = {}) {
        this.runtime = runtimePort || null;
        this.setupView = setupView || new FourPlayerPlanarSetupView({ documentRef });
        this.hudView = hudView || new FourPlayerPlanarHudView({ documentRef });
        this._matchActive = false;
        this._rollKeyCapture = null;
        this._lastHudValues = Array.from({ length: FOUR_PLAYER_PLANAR_HUMAN_COUNT }, () => ({}));
    }

    mountSetupUi() {
        const mounted = this.setupView.mount({
            keyBindings: FOUR_PLAYER_PLANAR_KEY_BINDINGS,
            playerColors: FOUR_PLAYER_PLANAR_PLAYER_COLORS,
            mapOptions: Object.entries(CONFIG.MAPS || {})
                .map(([mapKey, definition]) => ({ value: mapKey, label: resolveMapLabel(mapKey, definition) })),
            vehicleOptions: getVehicleIds()
                .map((vehicleId) => ({ value: vehicleId, label: resolveVehicleLabel(vehicleId) })),
            handlers: {
                onOpenRequested: () => this.openSetup(),
                onCloseRequested: () => this.closeSetup(),
                onStartRequested: () => this.startMatch(),
                onRollKeyRequested: (request) => this._beginRollKeyCapture(request),
                onKeyDown: (event) => this._captureRollKey(event),
                onControlChanged: () => this._persistSetupSelection(),
                onSessionTypeChanged: () => this.syncSetupUi(),
                onStandardModeSelected: () => this._selectStandardSplitScreen(),
            },
        });
        if (!mounted) return false;
        this.syncSetupUi();
        return true;
    }

    _selectStandardSplitScreen() {
        const localSettings = this.runtime?.ensureLocalSettings?.();
        if (localSettings) localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.STANDARD;
        this.closeSetup();
    }

    _resolveSelection() {
        const settings = this.runtime?.getSettings?.();
        const rawMode = settings?.localSettings?.fourPlayerPlanar?.mode;
        const normalizedMode = String(rawMode || '').toLowerCase() === FOUR_PLAYER_PLANAR_MODES.HUNT
            ? FOUR_PLAYER_PLANAR_MODES.HUNT
            : FOUR_PLAYER_PLANAR_MODES.CLASSIC;
        const mapKeys = this._getEligibleMapKeys(normalizedMode);
        const vehicleIds = new Set(getVehicleIds());
        const currentMapKey = String(settings?.mapKey || '');
        return normalizeFourPlayerPlanarSettings(
            settings?.localSettings?.fourPlayerPlanar,
            {
                allowedMapKeys: mapKeys,
                allowedVehicleIds: vehicleIds,
                fallbackMapKey: mapKeys.has(currentMapKey) ? currentMapKey : (mapKeys.values().next().value || 'standard'),
                fallbackVehicleId: settings?.vehicles?.PLAYER_1 || vehicleIds.values().next().value || 'ship5',
            }
        );
    }

    _getEligibleMapKeys(mode) {
        const modePath = mode === FOUR_PLAYER_PLANAR_MODES.HUNT ? 'fight' : 'normal';
        return new Set(Object.entries(CONFIG.MAPS || {})
            .filter(([, definition]) => isMapEligibleForModePath(definition, modePath))
            .map(([mapKey]) => mapKey));
    }

    syncSetupUi() {
        if (!this.setupView.isMounted()) return;
        const sessionType = this.runtime?.getSettings?.()?.localSettings?.sessionType;
        const isSplitScreen = String(sessionType || '').toLowerCase() === 'splitscreen';
        this.setupView.setEntryVisible(isSplitScreen);
        if (!isSplitScreen) this.closeSetup();
        const selection = this._resolveSelection();
        this.setupView.applySelection(selection);
        this.setupView.syncRollKeyButtons(selection.rollBindings);
    }

    _beginRollKeyCapture({ playerIndex, direction } = {}) {
        if (!Number.isInteger(playerIndex) || !['left', 'right'].includes(direction)) return;
        this.setupView.syncRollKeyButtons(this._resolveSelection().rollBindings);
        this._rollKeyCapture = { playerIndex, direction };
        this.setupView.showRollKeyCapture(playerIndex, direction);
    }

    _captureRollKey(event) {
        const capture = this._rollKeyCapture;
        if (!capture) {
            const rollBindings = this.runtime?.getRuntimeConfig?.()?.session?.fourPlayerPlanar?.rollBindings || [];
            if (this._matchActive && rollBindings.some((binding) => binding.left === event.code || binding.right === event.code)) {
                event.preventDefault();
            }
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const selection = this._resolveSelection();
        if (event.code === 'Escape') {
            this._rollKeyCapture = null;
            this.setupView.syncRollKeyButtons(selection.rollBindings);
            this.setupView.setKeyHint('Tastenauswahl abgebrochen.');
            return;
        }
        if (this._isKeyCodeOccupied(event.code, selection, capture)) {
            this.setupView.showKeyOccupied(event.code);
            return;
        }
        const rollBindings = selection.rollBindings.map((binding) => ({ ...binding }));
        rollBindings[capture.playerIndex][capture.direction] = event.code;
        const normalizedSelection = normalizeFourPlayerPlanarSettings({
            ...selection,
            rollBindings,
        });
        const localSettings = this.runtime?.ensureLocalSettings?.();
        if (localSettings) localSettings.fourPlayerPlanar = normalizedSelection;
        this._rollKeyCapture = null;
        this.setupView.syncRollKeyButtons(normalizedSelection.rollBindings);
        this.setupView.setKeyHint('Tastenbelegung gespeichert.');
        this.runtime?.notifySettingsChanged?.();
    }

    _isKeyCodeOccupied(code, selection, capture) {
        if (code === 'Enter') return true;
        const occupied = new Set(FOUR_PLAYER_PLANAR_KEY_BINDINGS
            .flatMap((binding) => [binding.left, binding.right, binding.action]));
        for (const boundCode of Object.values(this.runtime?.getGlobalKeyBindings?.() || {})) occupied.add(boundCode);
        selection.rollBindings.forEach((binding, playerIndex) => {
            for (const direction of ['left', 'right']) {
                if (playerIndex !== capture.playerIndex || direction !== capture.direction) occupied.add(binding[direction]);
            }
        });
        return occupied.has(code);
    }

    openSetup() {
        if (!this.setupView.isMounted()) return;
        const localSettings = this.runtime?.ensureLocalSettings?.();
        if (localSettings) localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
        this.syncSetupUi();
        this.setupView.openSetup();
    }

    closeSetup() {
        if (!this.setupView.isMounted()) return;
        this._rollKeyCapture = null;
        this.setupView.closeSetup();
    }

    _persistSetupSelection() {
        const controls = this.setupView.readControls();
        const localSettings = this.runtime?.ensureLocalSettings?.();
        if (!controls || !localSettings) return;
        const eligibleMapKeys = this._getEligibleMapKeys(controls.mode);
        const selection = normalizeFourPlayerPlanarSettings({
            mode: controls.mode,
            mapKey: controls.mapKey,
            vehicleId: controls.vehicleId,
            botCount: controls.botCount,
            rollBindings: localSettings.fourPlayerPlanar?.rollBindings,
        }, {
            allowedMapKeys: eligibleMapKeys,
            allowedVehicleIds: new Set(getVehicleIds()),
            fallbackMapKey: eligibleMapKeys.values().next().value || 'standard',
        });
        localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
        localSettings.fourPlayerPlanar = selection;
        this.setupView.applyNormalizedSelection(selection);
        this.runtime?.notifySettingsChanged?.();
    }

    startMatch() {
        const settings = this.runtime?.getSettings?.();
        if (!settings) return false;
        this._persistSetupSelection();
        const selection = this._resolveSelection();
        const localSettings = this.runtime.ensureLocalSettings();
        localSettings.sessionType = 'splitscreen';
        localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
        localSettings.fourPlayerPlanar = selection;
        localSettings.modePath = selection.mode === FOUR_PLAYER_PLANAR_MODES.HUNT ? 'fight' : 'normal';
        settings.mode = '2p';
        settings.gameMode = selection.mode === FOUR_PLAYER_PLANAR_MODES.HUNT ? 'HUNT' : 'CLASSIC';
        settings.mapKey = selection.mapKey;
        settings.numBots = selection.botCount;
        settings.autoRoll = false;
        if (!settings.gameplay) settings.gameplay = {};
        settings.gameplay.planarMode = true;
        if (!settings.vehicles) settings.vehicles = {};
        settings.vehicles.PLAYER_1 = selection.vehicleId;
        settings.vehicles.PLAYER_2 = selection.vehicleId;
        this.runtime.notifySettingsChanged();
        this.runtime.startMatch();
        return true;
    }

    isRuntimeActive() {
        return isFourPlayerPlanarRuntime(this.runtime?.getRuntimeConfig?.());
    }

    configureInputSources(inputManager) {
        if (!this.isRuntimeActive() || !inputManager?.setPlayerSource) return false;
        const session = this.runtime.getRuntimeConfig()?.session?.fourPlayerPlanar;
        const mode = session?.mode || FOUR_PLAYER_PLANAR_MODES.CLASSIC;
        const rollBindings = session?.rollBindings || [];
        for (let playerIndex = 0; playerIndex < FOUR_PLAYER_PLANAR_HUMAN_COUNT; playerIndex += 1) {
            inputManager.setPlayerSource(playerIndex, createFourPlayerPlanarInputSource({
                inputManager,
                playerIndex,
                getPlayer: () => this.runtime?.getPlayers?.()?.[playerIndex] || null,
                getMode: () => mode,
                rollBinding: rollBindings[playerIndex],
            }));
        }
        return true;
    }

    activateMatch() {
        if (this._matchActive) return;
        this._matchActive = true;
        this.hudView.setRuntimeSurfaceActive(true);
        this.hudView.ensureRows({
            playerCount: FOUR_PLAYER_PLANAR_HUMAN_COUNT,
            playerColors: FOUR_PLAYER_PLANAR_PLAYER_COLORS,
        });
        this.hudView.setVisible(true);
    }

    deactivateMatch() {
        if (!this._matchActive && !this.hudView.hasRoot()) return;
        this._matchActive = false;
        this.hudView.setRuntimeSurfaceActive(false);
        this.hudView.setVisible(false);
        this._lastHudValues.forEach((state) => {
            for (const key of Object.keys(state)) delete state[key];
        });
    }

    update() {
        const runtimeActive = this.isRuntimeActive()
            && this.runtime?.getGameStateId?.() !== GAME_STATE_IDS.MENU;
        if (!runtimeActive) {
            this.deactivateMatch();
            return;
        }
        this.activateMatch();
        const hunt = this.runtime.getRuntimeConfig()?.session?.fourPlayerPlanar?.mode === FOUR_PLAYER_PLANAR_MODES.HUNT;
        const players = this.runtime.getPlayers();
        this.runtime.forceThirdPersonCameras(FOUR_PLAYER_PLANAR_HUMAN_COUNT);
        for (let index = 0; index < FOUR_PLAYER_PLANAR_HUMAN_COUNT; index += 1) {
            const player = players[index];
            if (!player || !this.hudView.hasRow(index)) continue;
            const availability = resolveInventoryActionAvailability({
                player,
                modeType: hunt ? 'HUNT' : 'CLASSIC',
            });
            const values = {
                stat: hunt ? `HP ${Math.max(0, Math.ceil(Number(player.hp) || 0))}` : `Punkte ${Number(player.score) || 0}`,
                item: availability.hasItem ? availability.type : 'Kein Item',
            };
            const previous = this._lastHudValues[index];
            for (const key of ['stat', 'item']) {
                if (previous[key] === values[key]) continue;
                previous[key] = values[key];
                this.hudView.setRowText(index, key, values[key]);
            }
        }
    }

    dispose() {
        this.deactivateMatch();
        this.setupView.dispose();
        this.hudView.dispose();
        this.runtime = null;
    }
}
