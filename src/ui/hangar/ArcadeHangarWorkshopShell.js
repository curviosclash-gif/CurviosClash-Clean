import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';

const STONE_COLORS = Object.freeze([
    ['all', 'Alle Farben'], ['blue', 'Blau · Geschwindigkeit'], ['green', 'Grün · Wendigkeit'],
    ['gold', 'Gold · Schutz'], ['cyan', 'Cyan · Effizienz'], ['violet', 'Violett · Resonanz'],
]);
const PART_TIERS = Object.freeze(['ALL', 'T1', 'T2', 'T3']);
const PART_TRAITS = Object.freeze([
    ['all', 'Alle Rollen'], ['speed', 'Tempo'], ['agility', 'Wendig'],
    ['armor', 'Panzerung'], ['efficiency', 'Effizient'], ['balanced', 'Ausgewogen'],
]);

function button(className, text, title = '') {
    const node = el('button', className, text);
    node.type = 'button';
    if (title) node.title = title;
    return node;
}

function infoHint(text, className = '') {
    const node = el('span', `menu-info-hint ${className}`.trim(), 'i');
    node.title = text;
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', text);
    return node;
}

export function createArcadeHangarWorkshopShell(rules = {}, options = {}) {
    const mode = options.mode === 'fight' ? 'fight' : 'arcade';
    const container = el('section', 'arcade-surface-card arcade-vehicle-manager hangar-workshop-shell');
    container.id = 'arcade-vehicle-manager';
    container.tabIndex = 0;
    container.dataset.vehiclePreviewMode = 'interactive-3d-workshop';
    container.dataset.vehicleBreakpointStacked = String(rules?.responsiveBreakpoints?.stackedPanelMaxWidth || 1000);
    container.dataset.vehicleBreakpointCompact = String(rules?.responsiveBreakpoints?.compactListMaxWidth || 700);
    const header = el('header', 'hangar-workshop-header');
    const heading = el('div', 'hangar-workshop-heading');
    heading.append(
        el('span', 'hangar-workshop-kicker', mode === 'fight' ? 'FIGHT ENGINEERING' : 'ARCADE OPERATIONS'),
        el('h3', 'arcade-surface-card-title hangar-workshop-title', 'Desktop Hangar'),
        infoHint(mode === 'fight'
            ? 'Faire Sidegrades bauen: Jeder Vorteil erzeugt einen Nachteil.'
            : 'Universelle Steine einsetzen und den nächsten Run vorbereiten.', 'hangar-workshop-subtitle')
    );
    const saveState = el('div', 'hangar-save-state', 'Gespeichert');
    saveState.setAttribute('role', 'status');
    header.append(heading, saveState);
    container.appendChild(header);

    const layout = el('div', 'arcade-vehicle-layout hangar-workshop-layout');
    container.appendChild(layout);
    const leftPanel = el('section', 'arcade-vehicle-panel arcade-vehicle-panel-list hangar-catalog-panel');
    leftPanel.setAttribute('aria-label', 'Fahrzeug- und Steinkatalog');
    const viewSwitch = el('div', 'hangar-catalog-view-switch');
    const vehiclesViewButton = button('hangar-catalog-view is-active', 'Fahrzeuge');
    vehiclesViewButton.dataset.catalogView = 'vehicles';
    const partsViewButton = button('hangar-catalog-view', 'Steine');
    partsViewButton.dataset.catalogView = 'parts';
    viewSwitch.append(vehiclesViewButton, partsViewButton);
    const controls = el('div', 'arcade-vehicle-controls');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'arcade-vehicle-search';
    search.placeholder = 'Fahrzeuge durchsuchen …';
    search.setAttribute('aria-label', 'Katalog durchsuchen');
    const onlyFavBtn = button('secondary-btn arcade-vehicle-favorites-only', 'Nur Favoriten');
    controls.append(search, onlyFavBtn);
    const categoryTabs = el('div', 'arcade-vehicle-category-tabs');
    const hitboxChips = el('div', 'arcade-vehicle-chip-row');
    const levelChips = el('div', 'arcade-vehicle-chip-row');
    const partFilters = el('div', 'hangar-part-filters hidden');
    const familySelect = document.createElement('select');
    familySelect.className = 'hangar-part-family-filter';
    familySelect.setAttribute('aria-label', 'Steinfarbe');
    STONE_COLORS.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        familySelect.appendChild(option);
    });
    const tierSelect = document.createElement('select');
    tierSelect.className = 'hangar-part-tier-filter';
    tierSelect.setAttribute('aria-label', 'Steinstufe');
    PART_TIERS.forEach((tier) => {
        const option = document.createElement('option');
        option.value = tier;
        option.textContent = tier === 'ALL' ? 'Alle Tiers' : tier;
        tierSelect.appendChild(option);
    });
    const traitSelect = document.createElement('select');
    traitSelect.className = 'hangar-part-trait-filter';
    traitSelect.setAttribute('aria-label', 'Steineigenschaft');
    PART_TRAITS.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        traitSelect.appendChild(option);
    });
    const availabilitySelect = document.createElement('select');
    availabilitySelect.className = 'hangar-part-availability-filter';
    availabilitySelect.setAttribute('aria-label', 'Steinverfügbarkeit');
    [['all', 'Alle Steine'], ['available', 'Einsetzbar oder kaufbar'], ['locked', 'Nur gesperrt']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        availabilitySelect.appendChild(option);
    });
    partFilters.append(familySelect, tierSelect, traitSelect, availabilitySelect);
    const quickRows = el('div', 'arcade-vehicle-quick-rows');
    const favRow = el('div', 'arcade-vehicle-quick-row');
    const recentRow = el('div', 'arcade-vehicle-quick-row');
    quickRows.append(favRow, recentRow);
    const resultLine = el('p', 'menu-hint arcade-vehicle-results-line');
    const catalogList = el('div', 'arcade-vehicle-list hangar-catalog-list');
    catalogList.setAttribute('role', 'listbox');
    leftPanel.append(viewSwitch, controls, categoryTabs, hitboxChips, levelChips, partFilters, quickRows, resultLine, catalogList);
    layout.appendChild(leftPanel);

    const centerPanel = el('section', 'arcade-vehicle-panel arcade-vehicle-panel-preview hangar-viewport-panel');
    const cameraToolbar = el('div', 'hangar-camera-toolbar');
    ['hero', 'front', 'top', 'rear'].forEach((preset) => {
        const label = { hero: 'Hero', front: 'Front', top: 'Top', rear: 'Heck' }[preset];
        const node = button('secondary-btn hangar-camera-preset', label, `Kamera: ${label}`);
        node.dataset.cameraPreset = preset;
        cameraToolbar.appendChild(node);
    });
    const cameraReset = button('secondary-btn hangar-camera-reset', 'Reset', 'Kamera zurücksetzen');
    cameraToolbar.appendChild(cameraReset);
    const previewStage = el('div', 'arcade-vehicle-preview-stage hangar-viewport-stage');
    previewStage.id = 'arcade-vehicle-preview-stage';
    const previewOverlay = el('div', 'arcade-vehicle-preview-overlay hangar-hardpoint-overlay');
    previewOverlay.id = 'arcade-vehicle-preview-overlay';
    const vehiclePreviousButton = button(
        'hangar-vehicle-cycle hangar-vehicle-cycle-previous',
        '‹',
        'Vorheriges Fahrzeug'
    );
    vehiclePreviousButton.setAttribute('aria-label', 'Vorheriges Fahrzeug');
    const vehicleNextButton = button(
        'hangar-vehicle-cycle hangar-vehicle-cycle-next',
        '›',
        'Nächstes Fahrzeug'
    );
    vehicleNextButton.setAttribute('aria-label', 'Nächstes Fahrzeug');
    previewStage.append(previewOverlay, vehiclePreviousButton, vehicleNextButton);
    const viewportFooter = el('div', 'hangar-viewport-footer');
    viewportFooter.appendChild(infoHint(
        'Ziehen: drehen · Rad: zoomen · Rechtszug: verschieben · Esc: Drag abbrechen',
        'arcade-vehicle-preview-hint'
    ));
    const pairLabel = el('label', 'hangar-pair-toggle');
    const pairToggle = document.createElement('input');
    pairToggle.type = 'checkbox';
    pairToggle.checked = true;
    pairLabel.append(pairToggle, document.createTextNode(' Symmetrisch einsetzen'));
    viewportFooter.appendChild(pairLabel);
    const removeZone = el('div', 'hangar-remove-zone', 'Stein hier ablegen zum Entfernen');
    removeZone.dataset.hangarRemoveZone = 'true';
    removeZone.tabIndex = 0;
    centerPanel.append(cameraToolbar, previewStage, viewportFooter, removeZone);
    layout.appendChild(centerPanel);

    const rightPanel = el('section', 'arcade-vehicle-panel arcade-vehicle-panel-detail hangar-build-panel');
    const buildScroll = el('div', 'hangar-build-scroll');
    const detailHead = el('div', 'hangar-detail-head');
    const detailCopy = el('div', 'hangar-detail-copy');
    const detailTitle = el('p', 'arcade-vehicle-detail-title');
    const detailMeta = el('p', 'arcade-vehicle-detail-meta');
    detailCopy.append(detailTitle, detailMeta);
    const favoriteBtn = button('secondary-btn arcade-vehicle-favorite-toggle', 'Favorit');
    detailHead.append(detailCopy, favoriteBtn);
    const profileBox = el('div', 'arcade-vehicle-profile hangar-profile-summary');
    const levelLine = el('p', 'arcade-vehicle-level');
    const xpBar = el('div', 'arcade-vehicle-xp-bar');
    const xpFill = el('div', 'arcade-vehicle-xp-fill');
    xpBar.appendChild(xpFill);
    profileBox.append(levelLine, xpBar);
    const comparePanel = el('section', 'arcade-vehicle-compare hangar-stat-panel');
    const compareHeader = el('div', 'hangar-panel-heading');
    compareHeader.appendChild(el('h4', 'arcade-vehicle-subtitle', 'Build-Statistik'));
    const compareSelect = document.createElement('select');
    compareSelect.className = 'arcade-vehicle-compare-select';
    compareSelect.setAttribute('aria-label', 'Vergleichsfahrzeug');
    compareHeader.appendChild(compareSelect);
    const buildCompareSelect = document.createElement('select');
    buildCompareSelect.className = 'hangar-build-compare-select';
    buildCompareSelect.setAttribute('aria-label', 'Gespeicherten Build vergleichen');
    compareHeader.appendChild(buildCompareSelect);
    const statRows = el('div', 'arcade-vehicle-compare-rows hangar-stat-rows');
    const budgetRows = el('div', 'hangar-budget-rows');
    const partPreviewBox = el('div', 'hangar-part-preview hidden');
    partPreviewBox.setAttribute('aria-live', 'polite');
    comparePanel.append(compareHeader, statRows, budgetRows, partPreviewBox);
    const slotsPanel = el('section', 'hangar-slot-panel');
    slotsPanel.appendChild(el('h4', 'arcade-vehicle-subtitle', 'Fassungen'));
    const slotGrid = el('div', 'arcade-vehicle-slots hangar-slot-grid');
    slotsPanel.appendChild(slotGrid);
    const validationBox = el('div', 'hangar-validation-box');
    validationBox.setAttribute('aria-live', 'polite');
    const historyBar = el('div', 'hangar-history-bar');
    const undoButton = button('secondary-btn hangar-undo', 'Undo', 'Strg+Z');
    const redoButton = button('secondary-btn hangar-redo', 'Redo', 'Strg+Y');
    const revertButton = button('secondary-btn hangar-revert', 'Zurücksetzen', 'Letzten gespeicherten Stand laden');
    const defaultButton = button('secondary-btn hangar-default', 'Standard', 'Standardkonfiguration wiederherstellen');
    historyBar.append(undoButton, redoButton, revertButton, defaultButton);
    const starterPanel = el('section', 'hangar-starter-panel');
    starterPanel.appendChild(el('h4', 'arcade-vehicle-subtitle', 'Starter-Builds'));
    const starterBuilds = el('div', 'hangar-starter-builds');
    [
        ['sprinter', 'Sprinter'], ['turn_fighter', 'Kurvenjäger'],
        ['tank', 'Tank'], ['efficient', 'Energiesparer'],
    ].forEach(([id, label]) => {
        const node = button('secondary-btn hangar-starter-build', label);
        node.dataset.starterBuild = id;
        starterBuilds.appendChild(node);
    });
    starterPanel.appendChild(starterBuilds);
    const loadoutPanel = el('section', 'arcade-vehicle-loadout hangar-preset-panel');
    loadoutPanel.appendChild(el('h4', 'arcade-vehicle-subtitle', 'Build-Presets'));
    const presetName = document.createElement('input');
    presetName.type = 'text';
    presetName.className = 'arcade-vehicle-preset-input';
    presetName.placeholder = 'Build-Name';
    const presetSelect = document.createElement('select');
    presetSelect.className = 'arcade-vehicle-preset-select';
    const presetSort = document.createElement('select');
    presetSort.className = 'hangar-preset-sort';
    [['updated', 'Zuletzt bearbeitet'], ['favorite', 'Favoriten zuerst'], ['name', 'Name A-Z']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        presetSort.appendChild(option);
    });
    const presetTags = document.createElement('input');
    presetTags.type = 'text';
    presetTags.className = 'hangar-preset-tags';
    presetTags.placeholder = 'Tags, kommagetrennt';
    const presetActions = el('div', 'arcade-vehicle-loadout-controls hangar-preset-actions');
    const presetSave = button('secondary-btn arcade-vehicle-preset-save', 'Speichern');
    const presetSaveAs = button('secondary-btn hangar-preset-save-as', 'Speichern als');
    const presetLoad = button('secondary-btn arcade-vehicle-preset-load', 'Laden');
    const presetRename = button('secondary-btn hangar-preset-rename', 'Umbenennen');
    const presetDuplicate = button('secondary-btn hangar-preset-duplicate', 'Duplizieren');
    const presetDelete = button('secondary-btn arcade-vehicle-preset-delete', 'Löschen');
    const presetFavorite = button('secondary-btn hangar-preset-favorite', '☆ Favorit');
    const presetExport = button('secondary-btn hangar-preset-export', 'Export');
    const presetImport = button('secondary-btn hangar-preset-import', 'Import');
    presetActions.append(presetSave, presetSaveAs, presetLoad, presetRename, presetDuplicate, presetFavorite, presetExport, presetImport, presetDelete);
    const activateButton = button('start-btn hangar-activate-build', mode === 'fight' ? 'Für nächsten Fight aktivieren' : 'Für nächsten Run aktivieren');
    loadoutPanel.append(presetName, presetTags, presetSort, presetSelect, presetActions);
    buildScroll.append(
        detailHead, profileBox, comparePanel, slotsPanel, validationBox, historyBar, starterPanel, loadoutPanel,
        infoHint('Entf: Stein entfernen · Strg+Z/Y: Undo/Redo · Pfeile: Fahrzeug wechseln', 'arcade-vehicle-shortcuts')
    );
    const activationDock = el('div', 'hangar-activation-dock');
    activationDock.appendChild(activateButton);
    rightPanel.append(buildScroll, activationDock);
    layout.appendChild(rightPanel);
    const statusBar = el('footer', 'hangar-status-bar');
    const statusMessage = el('span', 'hangar-status-message', 'Hangar wird geladen …');
    const activeBuildLabel = el('span', 'hangar-active-build-label', 'Aktiver Run-Build: Standard');
    statusBar.append(statusMessage, activeBuildLabel);
    container.appendChild(statusBar);

    return {
        container, saveState, viewSwitch, vehiclesViewButton, partsViewButton, search, onlyFavBtn,
        categoryTabs, hitboxChips, levelChips, partFilters, familySelect, tierSelect, traitSelect, availabilitySelect, quickRows,
        favRow, recentRow, resultLine, catalogList, cameraToolbar, cameraReset, previewStage,
        vehiclePreviousButton, vehicleNextButton,
        previewOverlay, pairToggle, removeZone, detailTitle, detailMeta, favoriteBtn, levelLine,
        xpFill, compareSelect, buildCompareSelect, statRows, budgetRows, partPreviewBox, slotGrid, validationBox, undoButton,
        redoButton, revertButton, defaultButton, starterBuilds, presetName, presetSelect, presetSave,
        presetSaveAs, presetLoad, presetRename, presetDuplicate, presetDelete, presetSort, presetTags,
        presetFavorite, presetExport, presetImport, buildScroll, activationDock, activateButton,
        statusMessage, activeBuildLabel,
    };
}
