import { createVehicleManagerPreview3d } from '../arcade/vehicle-manager/VehicleManagerPreview3d.js';
import { resolveVehicleManagerCatalogEntry } from '../arcade/VehicleManagerCatalog.js';
import { HITBOX_LABELS } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { HANGAR_SELECTION_PLAYER_SLOTS } from '../hangar/HangarSelectionWritebackContract.js';
import { MENU_SESSION_TYPES } from '../menu/MenuStateContracts.js';
import { bindChoiceStripKeys } from './ChoiceStripKeys.js';

const PLAYER_COLORS = Object.freeze({
    [HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1]: '#66b6ff',
    [HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2]: '#ff9f5a',
});

const CATEGORY_LABELS = Object.freeze({
    jaeger: 'Jäger',
    kreuzer: 'Kreuzer',
    spezial: 'Spezial',
    custom: 'Custom',
});

function clampStat(value) {
    return Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
}

function resolvePlayerColor(settings, slot) {
    if (slot === HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1) {
        const configured = String(settings?.localSettings?.playerColorP1 || '').trim();
        if (/^#[0-9a-fA-F]{6}$/.test(configured)) return configured;
    }
    return PLAYER_COLORS[slot] || PLAYER_COLORS.PLAYER_1;
}

function selectedOptions(select) {
    return Array.from(select?.options || []).map((option) => ({
        id: String(option.value || '').trim(),
        label: String(option.textContent || option.value || '').trim(),
    })).filter((entry) => entry.id);
}

function updateStat(progress, valueNode, value) {
    const normalizedValue = clampStat(value);
    if (progress) {
        progress.value = normalizedValue;
        progress.setAttribute('aria-valuetext', `${normalizedValue} von 5`);
    }
    if (valueNode) valueNode.textContent = `${normalizedValue}/5`;
}

function supportsSecondVehicleSelection(sessionType) {
    return sessionType === MENU_SESSION_TYPES.SPLITSCREEN
        || sessionType === MENU_SESSION_TYPES.MULTIPLAYER;
}

export function createStartSetupVehiclePicker3d({ ui, listen } = {}) {
    const mount = ui?.vehiclePreview3dMount || null;
    if (!mount) {
        return Object.freeze({ sync() {}, dispose() {}, getState: () => ({ status: 'unavailable' }) });
    }

    const preview = createVehicleManagerPreview3d({ mount });
    const fallbackDisposers = [];
    const bind = (target, type, handler) => {
        if (!target?.addEventListener) return;
        if (typeof listen === 'function') {
            listen(target, type, handler);
            return;
        }
        target.addEventListener(type, handler);
        fallbackDisposers.push(() => target.removeEventListener(type, handler));
    };

    let activeSlot = HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1;
    let activeVehicleSignature = '';
    let choiceSignature = '';
    let lastSettings = null;
    let lastSessionType = MENU_SESSION_TYPES.SINGLE;
    let disposed = false;

    const selectForSlot = (slot = activeSlot) => (
        slot === HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2 ? ui.vehicleSelectP2 : ui.vehicleSelectP1
    );

    function isPreviewVisible() {
        const sectionOpen = !ui.vehiclePickerSection || ui.vehiclePickerSection.open === true;
        const panel = mount.closest?.('#submenu-game');
        const menu = mount.closest?.('#main-menu');
        const panelVisible = !panel || (
            !panel.classList.contains('hidden')
            && panel.getAttribute('aria-hidden') !== 'true'
        );
        const menuVisible = !menu || (
            !menu.classList.contains('hidden')
            && menu.getAttribute('aria-hidden') !== 'true'
        );
        return sectionOpen && panelVisible && menuVisible && document.visibilityState !== 'hidden';
    }

    function syncVisibility() {
        if (disposed) return;
        preview.setActive(isPreviewVisible());
    }

    function selectVehicle(vehicleId) {
        const select = selectForSlot();
        const normalizedVehicleId = String(vehicleId || '').trim();
        if (!select || !normalizedVehicleId) return;
        select.value = normalizedVehicleId;
        if (select.value !== normalizedVehicleId) return;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function moveSelection(direction) {
        const select = selectForSlot();
        const options = selectedOptions(select);
        if (options.length < 2) return;
        const currentIndex = Math.max(0, options.findIndex((entry) => entry.id === select.value));
        const nextIndex = (currentIndex + direction + options.length) % options.length;
        selectVehicle(options[nextIndex].id);
    }

    function renderChoices(select, selectedVehicleId) {
        const options = selectedOptions(select);
        const nextSignature = `${activeSlot}|${options.map((entry) => `${entry.id}:${entry.label}`).join('|')}`;
        if (nextSignature !== choiceSignature) {
            choiceSignature = nextSignature;
            const fragment = document.createDocumentFragment();
            options.forEach((entry) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'start-vehicle-choice';
                button.dataset.vehicleId = entry.id;
                button.setAttribute('role', 'option');
                button.textContent = entry.label;
                fragment.appendChild(button);
            });
            ui.vehiclePickerChoiceStrip?.replaceChildren(fragment);
        }
        ui.vehiclePickerChoiceStrip?.querySelectorAll?.('[data-vehicle-id]').forEach((button) => {
            const selected = button.dataset.vehicleId === selectedVehicleId;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
        const hasAlternatives = options.length > 1;
        if (ui.vehiclePickerPreviousButton) ui.vehiclePickerPreviousButton.disabled = !hasAlternatives;
        if (ui.vehiclePickerNextButton) ui.vehiclePickerNextButton.disabled = !hasAlternatives;
    }

    function syncPlayerUi(isP2Available) {
        if (!isP2Available && activeSlot === HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2) {
            activeSlot = HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1;
        }
        const isPlayer2 = activeSlot === HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2;
        ui.vehiclePickerPlayerP2Button?.classList.toggle('hidden', !isP2Available);
        ui.vehiclePickerPlayerP1Button?.classList.toggle('active', !isPlayer2);
        ui.vehiclePickerPlayerP1Button?.setAttribute('aria-pressed', String(!isPlayer2));
        ui.vehiclePickerPlayerP2Button?.classList.toggle('active', isPlayer2);
        ui.vehiclePickerPlayerP2Button?.setAttribute('aria-pressed', String(isPlayer2));
        ui.vehicleSelectP1Panel?.classList.toggle('hidden', isPlayer2);
        ui.vehicleSelectP2Panel?.classList.toggle('hidden', !isPlayer2);
    }

    function syncDetails(vehicleId) {
        const entry = resolveVehicleManagerCatalogEntry(vehicleId);
        const stats = entry.statsSummary || {};
        if (ui.vehiclePickerTitle) ui.vehiclePickerTitle.textContent = entry.label;
        if (ui.vehiclePickerDescription) ui.vehiclePickerDescription.textContent = entry.kurzbeschreibung;
        if (ui.vehiclePickerCategory) {
            ui.vehiclePickerCategory.textContent = CATEGORY_LABELS[entry.kategorie] || entry.kategorie;
        }
        if (ui.vehiclePickerHitbox) {
            ui.vehiclePickerHitbox.textContent = `Trefferzone: ${HITBOX_LABELS[entry.hitboxKlasse] || entry.hitboxKlasse}`;
        }
        updateStat(ui.vehiclePickerArmorStat, ui.vehiclePickerArmorValue, stats.armor);
        updateStat(ui.vehiclePickerAgilityStat, ui.vehiclePickerAgilityValue, stats.agility);
        updateStat(ui.vehiclePickerControlStat, ui.vehiclePickerControlValue, stats.control);
        if (ui.vehiclePreviewP2) {
            const p2VehicleId = String(ui.vehicleSelectP2?.value || '').trim();
            const p2Entry = resolveVehicleManagerCatalogEntry(p2VehicleId);
            ui.vehiclePreviewP2.textContent = `Pilot 2: ${p2Entry.label}`;
        }
    }

    function syncFavoriteState(settings, vehicleId) {
        const favorites = settings?.localSettings?.startSetup?.favoriteVehicles;
        const isFavorite = Array.isArray(favorites) && favorites.includes(vehicleId);
        if (!ui.vehicleFavoriteToggleButton) return;
        ui.vehicleFavoriteToggleButton.classList.toggle('active', isFavorite);
        ui.vehicleFavoriteToggleButton.setAttribute('aria-pressed', String(isFavorite));
        ui.vehicleFavoriteToggleButton.textContent = isFavorite ? '★ Favorit' : '☆ Favorit';
    }

    function sync({ settings, sessionType } = {}) {
        if (disposed) return;
        lastSettings = settings || lastSettings;
        lastSessionType = sessionType || lastSessionType;
        const isP2Available = supportsSecondVehicleSelection(lastSessionType);
        syncPlayerUi(isP2Available);
        const select = selectForSlot();
        const vehicleId = String(select?.value || lastSettings?.vehicles?.[activeSlot] || 'ship5').trim().toLowerCase();
        const color = resolvePlayerColor(lastSettings, activeSlot);
        const nextVehicleSignature = `${activeSlot}|${vehicleId}|${color}`;
        if (nextVehicleSignature !== activeVehicleSignature) {
            activeVehicleSignature = nextVehicleSignature;
            preview.setVehicle(vehicleId, color);
        }
        syncDetails(vehicleId);
        syncFavoriteState(lastSettings, vehicleId);
        renderChoices(select, vehicleId);
        syncVisibility();
    }

    function setActiveSlot(slot) {
        if (slot === HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2
            && !supportsSecondVehicleSelection(lastSessionType)) return;
        activeSlot = slot;
        activeVehicleSignature = '';
        choiceSignature = '';
        sync({ settings: lastSettings, sessionType: lastSessionType });
    }

    bind(ui.vehiclePickerPreviousButton, 'click', () => moveSelection(-1));
    bind(ui.vehiclePickerNextButton, 'click', () => moveSelection(1));
    bind(ui.vehiclePickerResetButton, 'click', () => preview.resetView());
    bind(ui.vehiclePickerPlayerP1Button, 'click', () => setActiveSlot(HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1));
    bind(ui.vehiclePickerPlayerP2Button, 'click', () => setActiveSlot(HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2));
    bind(ui.vehiclePickerChoiceStrip, 'click', (event) => {
        const button = event.target?.closest?.('[data-vehicle-id]');
        if (button) selectVehicle(button.dataset.vehicleId);
    });
    bindChoiceStripKeys({ strip: ui.vehiclePickerChoiceStrip, datasetKey: 'vehicleId', onChoose: selectVehicle, bind });
    bind(ui.vehiclePickerSection, 'toggle', syncVisibility);
    bind(document, 'visibilitychange', syncVisibility);

    const menuPanel = mount.closest?.('#submenu-game');
    const menuRoot = mount.closest?.('#main-menu');
    const visibilityObserver = typeof MutationObserver !== 'undefined'
        ? new MutationObserver(syncVisibility)
        : null;
    if (menuPanel) {
        visibilityObserver?.observe(menuPanel, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    }
    if (menuRoot) {
        visibilityObserver?.observe(menuRoot, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    }
    syncVisibility();

    return Object.freeze({
        sync,
        getState: () => ({
            status: preview.getStatus(),
            activeSlot,
            vehicleId: String(selectForSlot()?.value || ''),
            active: isPreviewVisible(),
        }),
        dispose() {
            if (disposed) return;
            disposed = true;
            visibilityObserver?.disconnect();
            fallbackDisposers.splice(0).forEach((dispose) => dispose());
            preview.dispose();
        },
    });
}
