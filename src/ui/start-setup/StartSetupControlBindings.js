import { HANGAR_SELECTION_PLAYER_SLOTS, writeHangarMapSelection, writeHangarVehicleSelection } from '../hangar/HangarSelectionWritebackContract.js';
import { ensureStartSetupLocalState, pushRecentEntry, toggleFavoriteEntry } from './StartSetupUiOps.js';

function bindStartSetupInput(controller, listen, getSettings, input, eventType, stateKey, fallbackValue) {
    if (!input) return;
    const settings = getSettings();
    if (!settings) return;
    const startSetup = ensureStartSetupLocalState(settings);
    input.value = startSetup[stateKey];
    listen(input, eventType, () => {
        const currentSettings = getSettings();
        if (!currentSettings) return;
        ensureStartSetupLocalState(currentSettings)[stateKey] = String(input.value || fallbackValue);
        controller.syncStartSetupState(currentSettings);
    });
}

function bindSearchAndFilterControls(controller, listen, getSettings) {
    const { ui } = controller;
    bindStartSetupInput(controller, listen, getSettings, ui.mapSearchInput, 'input', 'mapSearch', '');
    bindStartSetupInput(controller, listen, getSettings, ui.mapFilterSelect, 'change', 'mapFilter', 'all');
    bindStartSetupInput(controller, listen, getSettings, ui.vehicleSearchInput, 'input', 'vehicleSearch', '');
    bindStartSetupInput(controller, listen, getSettings, ui.vehicleFilterSelect, 'change', 'vehicleFilter', 'all');
}

function bindMapAndVehicleRecents(controller, listen, getSettings) {
    const { ui } = controller;
    if (ui.mapSelect) {
        listen(ui.mapSelect, 'change', () => {
            const currentSettings = getSettings();
            if (!currentSettings) return;
            const currentStartSetup = ensureStartSetupLocalState(currentSettings);
            const selectedMapKey = String(ui.mapSelect.value || '').trim();
            if (selectedMapKey) {
                writeHangarMapSelection(currentSettings, selectedMapKey, selectedMapKey, {
                    modePath: controller._resolveHangarSelectionModePath(currentSettings),
                });
            }
            pushRecentEntry(currentStartSetup.recentMaps, ui.mapSelect.value);
            controller.syncStartSetupState(currentSettings);
        });
    }
    if (ui.vehicleSelectP1) {
        listen(ui.vehicleSelectP1, 'change', () => {
            const currentSettings = getSettings();
            if (!currentSettings) return;
            const currentStartSetup = ensureStartSetupLocalState(currentSettings);
            writeHangarVehicleSelection(
                currentSettings,
                HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1,
                ui.vehicleSelectP1.value,
                'ship5',
                { modePath: controller._resolveHangarSelectionModePath(currentSettings) }
            );
            pushRecentEntry(currentStartSetup.recentVehicles, ui.vehicleSelectP1.value);
            controller.syncStartSetupState(currentSettings);
        });
    }
    if (ui.vehicleSelectP2) {
        listen(ui.vehicleSelectP2, 'change', () => {
            const currentSettings = getSettings();
            if (!currentSettings) return;
            const currentStartSetup = ensureStartSetupLocalState(currentSettings);
            writeHangarVehicleSelection(
                currentSettings,
                HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2,
                ui.vehicleSelectP2.value,
                'ship5',
                { modePath: controller._resolveHangarSelectionModePath(currentSettings) }
            );
            pushRecentEntry(currentStartSetup.recentVehicles, ui.vehicleSelectP2.value);
            controller.syncStartSetupState(currentSettings);
        });
    }
}

function bindFavoriteToggles(controller, listen, getSettings) {
    const { ui } = controller;
    if (ui.mapFavoriteToggleButton) {
        listen(ui.mapFavoriteToggleButton, 'click', () => {
            const currentSettings = getSettings();
            if (!currentSettings) return;
            const currentStartSetup = ensureStartSetupLocalState(currentSettings);
            toggleFavoriteEntry(currentStartSetup.favoriteMaps, ui.mapSelect?.value);
            controller.syncStartSetupState(currentSettings);
        });
    }
    if (ui.vehicleFavoriteToggleButton) {
        listen(ui.vehicleFavoriteToggleButton, 'click', () => {
            const currentSettings = getSettings();
            if (!currentSettings) return;
            const currentStartSetup = ensureStartSetupLocalState(currentSettings);
            toggleFavoriteEntry(currentStartSetup.favoriteVehicles, ui.vehicleSelectP1?.value);
            controller.syncStartSetupState(currentSettings);
        });
    }
}

function bindQuickPickList(listNode, attributeName, selectNode, listen) {
    if (!listNode || !selectNode) return;
    listen(listNode, 'click', (event) => {
        const button = event.target.closest(`button[${attributeName}]`);
        if (!button) return;
        selectNode.value = button.getAttribute(attributeName) || '';
        selectNode.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function bindStartSectionFlow(controller, listen) {
    const root = controller.ui?.mainMenu || document.getElementById('main-menu');
    const getSections = () => Array.from(root?.querySelectorAll?.('details[data-start-section]') || [])
        .filter((entry) => entry.dataset.startSection !== 'multiplayer');
    const syncSectionState = (activeSection = null) => {
        const sections = getSections();
        sections.forEach((section) => {
            if (activeSection && section !== activeSection && section.open) section.open = false;
            const summary = section.querySelector(':scope > summary');
            summary?.setAttribute('aria-expanded', String(section.open));
            section.dataset.startSectionState = section.open ? 'open' : 'closed';
        });
        const activeSectionId = String(activeSection?.dataset?.startSection || '').trim();
        root?.querySelectorAll?.('[data-start-section-target]').forEach((button) => {
            const isActive = !!activeSectionId
                && String(button.dataset.startSectionTarget || '').trim() === activeSectionId;
            button.classList.toggle('active', isActive);
            button.toggleAttribute('aria-current', isActive);
            if (isActive) button.setAttribute('aria-current', 'step');
        });
    };
    listen(root, 'toggle', (event) => {
        const section = event.target;
        if (section?.matches?.('details[data-start-section]:not([data-start-section="multiplayer"])')) {
            const activeSection = section.open
                ? section
                : getSections().find((entry) => entry.open) || null;
            syncSectionState(activeSection);
        }
    }, true);
    listen(root, 'click', (event) => {
        const button = event.target?.closest?.('[data-start-section-target]');
        if (!button || !root?.contains?.(button)) return;
        const sectionId = String(button.dataset.startSectionTarget || '').trim();
        const target = getSections().find((section) => section.dataset.startSection === sectionId);
        if (!target) return;
        target.open = true;
        syncSectionState(target);
        target.querySelector(':scope > summary')?.focus?.();
        const launchBayActive = !!root.querySelector?.('.start-step-rail')
            && globalThis.matchMedia?.('(min-width: 1180px)')?.matches === true;
        if (!launchBayActive) {
            target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        }
    });
    const sections = getSections();
    syncSectionState(sections.find((section) => section.open) || null);
}

export function bindStartSetupControls(controller, listen, getSettings) {
    bindStartSectionFlow(controller, listen);
    bindSearchAndFilterControls(controller, listen, getSettings);
    bindMapAndVehicleRecents(controller, listen, getSettings);
    bindFavoriteToggles(controller, listen, getSettings);
    const { ui } = controller;
    bindQuickPickList(ui.mapFavoritesList, 'data-map-key', ui.mapSelect, listen);
    bindQuickPickList(ui.mapRecentList, 'data-map-key', ui.mapSelect, listen);
    bindQuickPickList(ui.vehicleFavoritesList, 'data-vehicle-id', ui.vehicleSelectP1, listen);
    bindQuickPickList(ui.vehicleRecentList, 'data-vehicle-id', ui.vehicleSelectP1, listen);
}
