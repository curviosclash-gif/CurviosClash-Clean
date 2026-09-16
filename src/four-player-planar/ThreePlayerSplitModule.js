import './three-player-split.css';

import { getVehicleIds, VEHICLE_DEFINITIONS } from '../entities/vehicle-registry.js';
import { resolveInventoryActionAvailability } from '../shared/contracts/GameplayActionAvailabilityContract.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { isMapEligibleForModePath } from '../shared/contracts/MapModeContract.js';
import {
    FOUR_PLAYER_PLANAR_MODES,
    SPLIT_SCREEN_VARIANTS,
    THREE_PLAYER_SPLIT_HUMAN_COUNT,
    THREE_PLAYER_SPLIT_KEY_BINDINGS,
    THREE_PLAYER_SPLIT_PLAYER_COLORS,
    isThreePlayerSplitRuntime,
    normalizeThreePlayerSplitSettings,
} from './FourPlayerPlanarContract.js';

function resolveMapLabel(mapKey, definition) {
    return String(definition?.name || definition?.label || mapKey);
}

function resolveVehicleLabel(vehicleId) {
    return String(VEHICLE_DEFINITIONS?.[vehicleId]?.label || vehicleId);
}

/**
 * Orchestrates the local 3-player split-screen (two gamepads, one keyboard
 * by default, freely reassignable). Deliberately a separate class from
 * FourPlayerPlanarModule rather than a parametrized variant of it: this
 * mode has no roll-key rebinding (the four-player-planar module's biggest
 * chunk of logic) but does have a device-assignment picker the other mode
 * doesn't, and it must never force planarMode - the two easily diverge.
 *
 * Views and map definitions are injected by the composition side: feature
 * modules may not import src/ui or src/core (the four-player-planar module's
 * imports are a frozen legacy exception, see ArchitectureConfig.mjs).
 */
export class ThreePlayerSplitModule {
    /**
     * @param {object} options
     * @param {any} options.runtimePort
     * @param {any} options.setupView  ThreePlayerSplitSetupView or an object with the same methods
     * @param {any} options.hudView  ThreePlayerSplitHudView or an object with the same methods
     * @param {Record<string, any>} [options.mapDefinitions]  CONFIG.MAPS, passed in from the composition side
     */
    constructor({ runtimePort, setupView, hudView, mapDefinitions = {} }) {
        this.runtime = runtimePort || null;
        this.setupView = setupView;
        this.hudView = hudView;
        this.mapDefinitions = mapDefinitions;
        this._matchActive = false;
        this._lastHudValues = Array.from({ length: THREE_PLAYER_SPLIT_HUMAN_COUNT }, () => ({}));
    }

    mountSetupUi() {
        const mounted = this.setupView.mount({
            keyBindings: THREE_PLAYER_SPLIT_KEY_BINDINGS,
            playerColors: THREE_PLAYER_SPLIT_PLAYER_COLORS,
            mapOptions: Object.entries(this.mapDefinitions)
                .map(([mapKey, definition]) => ({ value: mapKey, label: resolveMapLabel(mapKey, definition) })),
            vehicleOptions: getVehicleIds()
                .map((vehicleId) => ({ value: vehicleId, label: resolveVehicleLabel(vehicleId) })),
            handlers: {
                onOpenRequested: () => this.openSetup(),
                onCloseRequested: () => this.closeSetup(),
                onStartRequested: () => this.startMatch(),
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
        const rawMode = settings?.localSettings?.threePlayerSplit?.mode;
        const normalizedMode = String(rawMode || '').toLowerCase() === FOUR_PLAYER_PLANAR_MODES.HUNT
            ? FOUR_PLAYER_PLANAR_MODES.HUNT
            : FOUR_PLAYER_PLANAR_MODES.CLASSIC;
        const mapKeys = this._getEligibleMapKeys(normalizedMode);
        const vehicleIds = new Set(getVehicleIds());
        const currentMapKey = String(settings?.mapKey || '');
        return normalizeThreePlayerSplitSettings(
            settings?.localSettings?.threePlayerSplit,
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
        return new Set(Object.entries(this.mapDefinitions)
            .filter(([, definition]) => isMapEligibleForModePath(definition, modePath))
            .map(([mapKey]) => mapKey));
    }

    syncSetupUi() {
        if (!this.setupView.isMounted()) return;
        const sessionType = this.runtime?.getSettings?.()?.localSettings?.sessionType;
        const isSplitScreen = String(sessionType || '').toLowerCase() === 'splitscreen';
        this.setupView.setEntryVisible(isSplitScreen);
        if (!isSplitScreen) this.closeSetup();
        this.setupView.applySelection(this._resolveSelection());
    }

    openSetup() {
        if (!this.setupView.isMounted()) return;
        const localSettings = this.runtime?.ensureLocalSettings?.();
        if (localSettings) localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.THREE_PLAYER;
        this.syncSetupUi();
        this.setupView.openSetup();
    }

    closeSetup() {
        if (!this.setupView.isMounted()) return;
        this.setupView.closeSetup();
    }

    _persistSetupSelection() {
        const controls = this.setupView.readControls();
        const localSettings = this.runtime?.ensureLocalSettings?.();
        if (!controls || !localSettings) return;
        const eligibleMapKeys = this._getEligibleMapKeys(controls.mode);
        const selection = normalizeThreePlayerSplitSettings({
            mode: controls.mode,
            mapKey: controls.mapKey,
            vehicleId: controls.vehicleId,
            botCount: controls.botCount,
            deviceAssignment: controls.deviceAssignment,
        }, {
            allowedMapKeys: eligibleMapKeys,
            allowedVehicleIds: new Set(getVehicleIds()),
            fallbackMapKey: eligibleMapKeys.values().next().value || 'standard',
        });
        localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.THREE_PLAYER;
        localSettings.threePlayerSplit = selection;
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
        localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.THREE_PLAYER;
        localSettings.threePlayerSplit = selection;
        localSettings.modePath = selection.mode === FOUR_PLAYER_PLANAR_MODES.HUNT ? 'fight' : 'normal';
        settings.mode = '2p';
        settings.gameMode = selection.mode === FOUR_PLAYER_PLANAR_MODES.HUNT ? 'HUNT' : 'CLASSIC';
        settings.mapKey = selection.mapKey;
        settings.numBots = selection.botCount;
        // Unlike four-player-planar, gameplay.planarMode is left alone: full 3D flight.
        if (!settings.vehicles) settings.vehicles = {};
        settings.vehicles.PLAYER_1 = selection.vehicleId;
        settings.vehicles.PLAYER_2 = selection.vehicleId;
        settings.vehicles.PLAYER_3 = selection.vehicleId;
        this.runtime.notifySettingsChanged();
        this.runtime.startMatch();
        return true;
    }

    isRuntimeActive() {
        return isThreePlayerSplitRuntime(this.runtime?.getRuntimeConfig?.());
    }

    /**
     * Pending: wiring an actual keyboard/gamepad source per slot needs the
     * shared input-resolution rework (MatchInputSourceResolver.js,
     * InputManager.js) that is mid-flight elsewhere in this tree. Once that
     * lands, this should read runtimeConfig.session.threePlayerSplit
     * .deviceAssignment and bind a source per slot via
     * resolveThreePlayerSplitInputDevice() from FourPlayerPlanarContract.js.
     */
    configureInputSources() {
        return false;
    }

    activateMatch() {
        if (this._matchActive) return;
        this._matchActive = true;
        this.hudView.setRuntimeSurfaceActive(true);
        this.hudView.ensureRows({
            playerCount: THREE_PLAYER_SPLIT_HUMAN_COUNT,
            playerColors: THREE_PLAYER_SPLIT_PLAYER_COLORS,
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
        const hunt = this.runtime.getRuntimeConfig()?.session?.threePlayerSplit?.mode === FOUR_PLAYER_PLANAR_MODES.HUNT;
        const players = this.runtime.getPlayers();
        const globalFog = this.runtime.getGlobalFogState?.();
        const fogLabel = globalFog?.active === true && Number(globalFog.remainingSeconds) > 0
            ? `☁ Nebel ${Math.ceil(Number(globalFog.remainingSeconds))}s`
            : '';
        this.runtime.forceThirdPersonCameras(THREE_PLAYER_SPLIT_HUMAN_COUNT);
        for (let index = 0; index < THREE_PLAYER_SPLIT_HUMAN_COUNT; index += 1) {
            const player = players[index];
            if (!player || !this.hudView.hasRow(index)) continue;
            const availability = resolveInventoryActionAvailability({
                player,
                modeType: hunt ? 'HUNT' : 'CLASSIC',
            });
            const itemLabel = availability.hasItem ? availability.type : 'Kein Item';
            const values = {
                stat: hunt ? `HP ${Math.max(0, Math.ceil(Number(player.hp) || 0))}` : `Punkte ${Number(player.score) || 0}`,
                item: fogLabel ? `${itemLabel} · ${fogLabel}` : itemLabel,
            };
            const previous = this._lastHudValues[index];
            for (const key of /** @type {Array<'stat'|'item'>} */ (['stat', 'item'])) {
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
