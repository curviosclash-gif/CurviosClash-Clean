import './four-player-planar.css';

import { CONFIG } from '../core/Config.js';
import { getVehicleIds, VEHICLE_DEFINITIONS } from '../entities/vehicle-registry.js';
import { resolveInventoryActionAvailability } from '../shared/contracts/GameplayActionAvailabilityContract.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { isMapEligibleForModePath } from '../shared/contracts/MapModeContract.js';
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

function createOption(documentRef, value, label) {
    const option = documentRef.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
}

function createStaticElement(documentRef, markup) {
    const range = documentRef.createRange();
    const fragment = range.createContextualFragment(String(markup || '').trim());
    return fragment.firstElementChild;
}

function colorToCss(color) {
    return `#${Number(color).toString(16).padStart(6, '0')}`;
}

function resolveMapLabel(mapKey, definition) {
    return String(definition?.name || definition?.label || mapKey);
}

function resolveVehicleLabel(vehicleId) {
    const definition = VEHICLE_DEFINITIONS?.[vehicleId];
    return String(definition?.name || definition?.label || vehicleId);
}

function isMobileProductSurface(documentRef) {
    const appTarget = String(documentRef?.documentElement?.dataset?.appTarget || '').trim().toLowerCase();
    return appTarget === 'mobile-classic' || appTarget === 'mobile-arcade';
}

export class FourPlayerPlanarModule {
    constructor({ game, documentRef = globalThis.document } = {}) {
        this.game = game || null;
        this.document = documentRef || null;
        this._listeners = [];
        this._setupNodes = null;
        this._hudRoot = null;
        this._hudRows = [];
        this._matchActive = false;
        this._lastHudValues = Array.from({ length: FOUR_PLAYER_PLANAR_HUMAN_COUNT }, () => ({}));
    }

    mountSetupUi() {
        if (!this.document || isMobileProductSurface(this.document) || this._setupNodes) return false;
        const grid = this.document.querySelector('#submenu-custom .level2-mode-grid');
        const submenuBody = this.document.querySelector('#submenu-custom .submenu-body');
        if (!grid || !submenuBody) return false;

        const card = createStaticElement(this.document, `
            <button type="button" id="btn-four-player-planar"
                class="mode-btn menu-choice-card four-player-planar-entry hidden">
                <span class="menu-choice-eyebrow">Lokales Modul</span>
                <span class="menu-choice-title">4 Spieler – Planar</span>
                <span class="menu-choice-copy">Classic oder Hunt im 2×2-Splitscreen</span>
            </button>`);
        grid.appendChild(card);

        const surface = createStaticElement(this.document, `
            <section id="four-player-planar-setup" class="menu-section four-player-planar-setup hidden"
                aria-labelledby="four-player-planar-setup-title">
              <div class="four-player-planar-setup-header">
                <button type="button" class="back-btn" data-four-player-planar-back aria-label="Zurück zur Spielstilwahl">← Zurück</button>
                <div>
                    <h2 id="four-player-planar-setup-title" class="section-title">4 Spieler – Planar</h2>
                    <p class="menu-hint">Vier lokale Tastaturspieler · Third Person · Pitch und Rollen gesperrt</p>
                </div>
            </div>
            <div class="four-player-planar-fields">
                <label>Modus<select data-four-player-planar-mode>
                    <option value="classic">Classic</option>
                    <option value="hunt">Hunt</option>
                </select></label>
                <label>Karte<select data-four-player-planar-map></select></label>
                <label>Gemeinsames Fahrzeug<select data-four-player-planar-vehicle></select></label>
                <label>Bots <span data-four-player-planar-bot-label>0</span>
                    <input data-four-player-planar-bots type="range" min="0" max="6" step="1" value="0">
                </label>
            </div>
            <div class="four-player-planar-keys" aria-label="Feste Tastaturbelegung"></div>
            <p class="menu-hint">Hinweis: Hardwarebedingtes Keyboard-Ghosting kann bei manchen Tastaturen auftreten.</p>
            <button type="button" class="start-btn" data-four-player-planar-start>4-Spieler-Match starten</button>
            </section>`);
        submenuBody.appendChild(surface);

        const mapSelect = surface.querySelector('[data-four-player-planar-map]');
        for (const [mapKey, definition] of Object.entries(CONFIG.MAPS || {})) {
            mapSelect.appendChild(createOption(this.document, mapKey, resolveMapLabel(mapKey, definition)));
        }
        const vehicleSelect = surface.querySelector('[data-four-player-planar-vehicle]');
        for (const vehicleId of getVehicleIds()) {
            vehicleSelect.appendChild(createOption(this.document, vehicleId, resolveVehicleLabel(vehicleId)));
        }
        const keys = surface.querySelector('.four-player-planar-keys');
        FOUR_PLAYER_PLANAR_KEY_BINDINGS.forEach((binding, index) => {
            const row = this.document.createElement('span');
            row.textContent = `P${index + 1}: ${binding.label}`;
            row.style.setProperty('--player-color', colorToCss(FOUR_PLAYER_PLANAR_PLAYER_COLORS[index]));
            keys.appendChild(row);
        });

        this._setupNodes = {
            card,
            surface,
            standardSections: Array.from(submenuBody.children).filter((node) => node !== surface),
            mode: surface.querySelector('[data-four-player-planar-mode]'),
            map: mapSelect,
            vehicle: vehicleSelect,
            bots: surface.querySelector('[data-four-player-planar-bots]'),
            botLabel: surface.querySelector('[data-four-player-planar-bot-label]'),
            back: surface.querySelector('[data-four-player-planar-back]'),
            start: surface.querySelector('[data-four-player-planar-start]'),
        };

        this._listen(card, 'click', () => this.openSetup());
        this._listen(this._setupNodes.back, 'click', () => this.closeSetup());
        this._listen(this._setupNodes.start, 'click', () => this.startMatch());
        for (const control of [this._setupNodes.mode, this._setupNodes.map, this._setupNodes.vehicle, this._setupNodes.bots]) {
            this._listen(control, 'input', () => this._persistSetupSelection());
            this._listen(control, 'change', () => this._persistSetupSelection());
        }
        for (const sessionButton of this.document.querySelectorAll('[data-session-type]')) {
            this._listen(sessionButton, 'click', () => queueMicrotask(() => this.syncSetupUi()));
        }
        for (const standardModeButton of this.document.querySelectorAll('#submenu-custom [data-mode-path]')) {
            this._listen(standardModeButton, 'click', () => {
                if (this.game?.settings?.localSettings) {
                    this.game.settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.STANDARD;
                }
                this.closeSetup();
            });
        }
        this.syncSetupUi();
        return true;
    }

    _listen(target, type, handler) {
        if (!target?.addEventListener) return;
        target.addEventListener(type, handler);
        this._listeners.push(() => target.removeEventListener(type, handler));
    }

    _resolveSelection() {
        const rawMode = this.game?.settings?.localSettings?.fourPlayerPlanar?.mode;
        const normalizedMode = String(rawMode || '').toLowerCase() === FOUR_PLAYER_PLANAR_MODES.HUNT
            ? FOUR_PLAYER_PLANAR_MODES.HUNT
            : FOUR_PLAYER_PLANAR_MODES.CLASSIC;
        const mapKeys = this._getEligibleMapKeys(normalizedMode);
        const vehicleIds = new Set(getVehicleIds());
        const currentMapKey = String(this.game?.settings?.mapKey || '');
        return normalizeFourPlayerPlanarSettings(
            this.game?.settings?.localSettings?.fourPlayerPlanar,
            {
                allowedMapKeys: mapKeys,
                allowedVehicleIds: vehicleIds,
                fallbackMapKey: mapKeys.has(currentMapKey) ? currentMapKey : (mapKeys.values().next().value || 'standard'),
                fallbackVehicleId: this.game?.settings?.vehicles?.PLAYER_1 || vehicleIds.values().next().value || 'ship5',
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
        if (!this._setupNodes) return;
        const isSplitScreen = String(this.game?.settings?.localSettings?.sessionType || '').toLowerCase() === 'splitscreen';
        this._setupNodes.card.classList.toggle('hidden', !isSplitScreen);
        this._setupNodes.card.setAttribute('aria-hidden', String(!isSplitScreen));
        if (!isSplitScreen) this.closeSetup();
        const selection = this._resolveSelection();
        this._setupNodes.mode.value = selection.mode;
        this._setupNodes.map.value = selection.mapKey;
        this._setupNodes.vehicle.value = selection.vehicleId;
        this._setupNodes.bots.value = String(selection.botCount);
        this._setupNodes.botLabel.textContent = String(selection.botCount);
    }

    openSetup() {
        if (!this._setupNodes) return;
        if (!this.game.settings.localSettings) this.game.settings.localSettings = {};
        this.game.settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
        this.syncSetupUi();
        for (const node of this._setupNodes.standardSections) node.classList.add('four-player-planar-standard-hidden');
        this._setupNodes.surface.classList.remove('hidden');
        this._setupNodes.mode.focus?.();
    }

    closeSetup() {
        if (!this._setupNodes) return;
        for (const node of this._setupNodes.standardSections) node.classList.remove('four-player-planar-standard-hidden');
        this._setupNodes.surface.classList.add('hidden');
    }

    _persistSetupSelection() {
        if (!this._setupNodes || !this.game?.settings) return;
        if (!this.game.settings.localSettings) this.game.settings.localSettings = {};
        const requestedMode = this._setupNodes.mode.value;
        const eligibleMapKeys = this._getEligibleMapKeys(requestedMode);
        const selection = normalizeFourPlayerPlanarSettings({
            mode: requestedMode,
            mapKey: this._setupNodes.map.value,
            vehicleId: this._setupNodes.vehicle.value,
            botCount: this._setupNodes.bots.value,
        }, {
            allowedMapKeys: eligibleMapKeys,
            allowedVehicleIds: new Set(getVehicleIds()),
            fallbackMapKey: eligibleMapKeys.values().next().value || 'standard',
        });
        this.game.settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
        this.game.settings.localSettings.fourPlayerPlanar = selection;
        this._setupNodes.map.value = selection.mapKey;
        this._setupNodes.botLabel.textContent = String(selection.botCount);
        this.game._onSettingsChanged?.();
    }

    startMatch() {
        if (!this.game?.settings) return false;
        this._persistSetupSelection();
        const selection = this._resolveSelection();
        const settings = this.game.settings;
        settings.localSettings.sessionType = 'splitscreen';
        settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
        settings.localSettings.fourPlayerPlanar = selection;
        settings.localSettings.modePath = selection.mode === FOUR_PLAYER_PLANAR_MODES.HUNT ? 'fight' : 'normal';
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
        this.game._onSettingsChanged?.();
        this.game.startMatch?.();
        return true;
    }

    isRuntimeActive() {
        return isFourPlayerPlanarRuntime(this.game?.runtimeConfig);
    }

    configureInputSources(inputManager) {
        if (!this.isRuntimeActive() || !inputManager?.setPlayerSource) return false;
        const mode = this.game.runtimeConfig?.session?.fourPlayerPlanar?.mode || FOUR_PLAYER_PLANAR_MODES.CLASSIC;
        for (let playerIndex = 0; playerIndex < FOUR_PLAYER_PLANAR_HUMAN_COUNT; playerIndex += 1) {
            inputManager.setPlayerSource(playerIndex, createFourPlayerPlanarInputSource({
                inputManager,
                playerIndex,
                getPlayer: () => this.game?.entityManager?.players?.[playerIndex] || null,
                getMode: () => mode,
            }));
        }
        return true;
    }

    activateMatch() {
        if (this._matchActive) return;
        this._matchActive = true;
        this.document?.documentElement?.classList?.add('four-player-planar-active');
        this._ensureHud();
        this._hudRoot?.classList?.remove('hidden');
    }

    deactivateMatch() {
        if (!this._matchActive && !this._hudRoot) return;
        this._matchActive = false;
        this.document?.documentElement?.classList?.remove('four-player-planar-active');
        this._hudRoot?.classList?.add('hidden');
        this._lastHudValues.forEach((state) => {
            for (const key of Object.keys(state)) delete state[key];
        });
    }

    _ensureHud() {
        if (this._hudRoot || !this.document) return;
        const hud = this.document.getElementById('hud');
        if (!hud) return;
        const root = this.document.createElement('div');
        root.id = 'four-player-planar-hud';
        root.className = 'four-player-planar-hud hidden';
        for (let index = 0; index < FOUR_PLAYER_PLANAR_HUMAN_COUNT; index += 1) {
            const row = createStaticElement(this.document, `
                <section class="four-player-planar-hud-quadrant q${index + 1}" aria-label="HUD Spieler ${index + 1}">
                    <div class="four-player-planar-hud-card">
                        <strong data-fpp-player>P${index + 1}</strong>
                        <span data-fpp-stat>–</span>
                        <span data-fpp-item>Kein Item</span>
                    </div>
                </section>`);
            row.style.setProperty('--player-color', colorToCss(FOUR_PLAYER_PLANAR_PLAYER_COLORS[index]));
            root.appendChild(row);
            this._hudRows.push({
                stat: row.querySelector('[data-fpp-stat]'),
                item: row.querySelector('[data-fpp-item]'),
            });
        }
        hud.appendChild(root);
        this._hudRoot = root;
    }

    update() {
        const runtimeActive = this.isRuntimeActive()
            && this.game?.state !== GAME_STATE_IDS.MENU;
        if (!runtimeActive) {
            this.deactivateMatch();
            return;
        }
        this.activateMatch();
        const hunt = this.game.runtimeConfig?.session?.fourPlayerPlanar?.mode === FOUR_PLAYER_PLANAR_MODES.HUNT;
        const players = this.game?.entityManager?.players || [];
        for (let index = 0; index < FOUR_PLAYER_PLANAR_HUMAN_COUNT; index += 1) {
            if (index < (this.game?.renderer?.cameraModes?.length || 0)) {
                this.game.renderer.cameraModes[index] = 0;
            }
            const player = players[index];
            const row = this._hudRows[index];
            if (!player || !row) continue;
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
                row[key].textContent = values[key];
            }
        }
    }

    dispose() {
        this.deactivateMatch();
        for (const disposeListener of this._listeners.splice(0)) disposeListener();
        this._hudRoot?.remove?.();
        this._setupNodes?.surface?.remove?.();
        this._setupNodes?.card?.remove?.();
        this._hudRoot = null;
        this._hudRows.length = 0;
        this._setupNodes = null;
        this.game = null;
    }
}
