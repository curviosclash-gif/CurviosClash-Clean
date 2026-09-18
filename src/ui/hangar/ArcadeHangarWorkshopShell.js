import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { FIGHT_MACHINE_GUN_MODELS } from '../../shared/contracts/FightMachineGunContract.js';
import { HANGAR_STARTER_BUILDS } from './HangarStarterBuildCatalog.js';
import { createInfoHintButton } from '../menu/InfoHintToggle.js';

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
    return createInfoHintButton(document, text, className);
}

function labeledSelect(labelText, select) {
    const label = el('label', 'hangar-filter-field');
    label.append(el('span', 'hangar-filter-field-label', labelText), select);
    return label;
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
        el('h3', 'arcade-surface-card-title hangar-workshop-title', 'Fahrzeug-Werkstatt'),
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
    viewSwitch.setAttribute('role', 'tablist');
    viewSwitch.setAttribute('aria-label', 'Katalogansicht');
    const vehiclesViewButton = button('hangar-catalog-view is-active', 'Fahrzeuge');
    vehiclesViewButton.dataset.catalogView = 'vehicles';
    vehiclesViewButton.setAttribute('role', 'tab');
    vehiclesViewButton.setAttribute('aria-selected', 'true');
    const partsViewButton = button('hangar-catalog-view', 'Steine');
    partsViewButton.dataset.catalogView = 'parts';
    partsViewButton.setAttribute('role', 'tab');
    partsViewButton.setAttribute('aria-selected', 'false');
    viewSwitch.append(vehiclesViewButton, partsViewButton);
    const controls = el('div', 'arcade-vehicle-controls');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'arcade-vehicle-search';
    search.placeholder = 'Fahrzeuge durchsuchen …';
    search.setAttribute('aria-label', 'Katalog durchsuchen');
    const onlyFavBtn = button('secondary-btn arcade-vehicle-favorites-only', 'Nur Favoriten');
    onlyFavBtn.setAttribute('aria-pressed', 'false');
    controls.append(search, onlyFavBtn);
    const categoryTabs = el('div', 'arcade-vehicle-category-tabs');
    categoryTabs.setAttribute('role', 'group');
    categoryTabs.setAttribute('aria-label', 'Fahrzeugklasse');
    const hitboxChips = el('div', 'arcade-vehicle-chip-row');
    hitboxChips.setAttribute('role', 'group');
    hitboxChips.setAttribute('aria-label', 'Hitboxklasse');
    const levelChips = el('div', 'arcade-vehicle-chip-row');
    levelChips.setAttribute('role', 'group');
    levelChips.setAttribute('aria-label', 'Fahrzeuglevel');
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
    const partFilterReset = button('secondary-btn hangar-part-filter-reset', 'Filter zurücksetzen');
    partFilters.append(
        labeledSelect('Farbe', familySelect),
        labeledSelect('Stufe', tierSelect),
        labeledSelect('Eigenschaft', traitSelect),
        labeledSelect('Verfügbarkeit', availabilitySelect),
        partFilterReset
    );
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
    previewStage.tabIndex = 0;
    previewStage.setAttribute('aria-label', 'Fahrzeugvorschau; Pfeiltasten wechseln das Fahrzeug');
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
    const detailDescription = el('p', 'hangar-vehicle-description');
    detailCopy.append(detailTitle, detailMeta, detailDescription);
    const favoriteBtn = button('secondary-btn arcade-vehicle-favorite-toggle', 'Favorit');
    detailHead.append(detailCopy, favoriteBtn);
    const profileBox = el('div', 'arcade-vehicle-profile hangar-profile-summary');
    const levelLine = el('p', 'arcade-vehicle-level');
    const xpBar = el('div', 'arcade-vehicle-xp-bar');
    const xpFill = el('div', 'arcade-vehicle-xp-fill');
    xpBar.appendChild(xpFill);
    const levelDetail = el('p', 'arcade-vehicle-level-detail');
    levelDetail.setAttribute('aria-live', 'polite');
    profileBox.append(levelLine, xpBar, levelDetail);
    const buildViewSwitch = el('div', 'hangar-build-view-switch');
    buildViewSwitch.setAttribute('role', 'tablist');
    buildViewSwitch.setAttribute('aria-label', 'Werkstattbereich');
    const workshopViewButton = button('hangar-build-view-tab is-active', 'Umbau');
    workshopViewButton.id = 'hangar-build-view-workshop';
    workshopViewButton.dataset.buildView = 'workshop';
    workshopViewButton.setAttribute('role', 'tab');
    workshopViewButton.setAttribute('aria-selected', 'true');
    workshopViewButton.setAttribute('aria-controls', 'hangar-build-panel-workshop');
    const statsViewButton = button('hangar-build-view-tab', 'Werte');
    statsViewButton.id = 'hangar-build-view-stats';
    statsViewButton.dataset.buildView = 'stats';
    statsViewButton.setAttribute('role', 'tab');
    statsViewButton.setAttribute('aria-selected', 'false');
    statsViewButton.setAttribute('aria-controls', 'hangar-build-panel-stats');
    const presetsViewButton = button('hangar-build-view-tab', 'Builds');
    presetsViewButton.id = 'hangar-build-view-presets';
    presetsViewButton.dataset.buildView = 'presets';
    presetsViewButton.setAttribute('role', 'tab');
    presetsViewButton.setAttribute('aria-selected', 'false');
    presetsViewButton.setAttribute('aria-controls', 'hangar-build-panel-presets');
    buildViewSwitch.append(workshopViewButton, statsViewButton, presetsViewButton);
    const machineGunPanel = el('section', `hangar-preset-panel hangar-machine-gun-panel${mode === 'fight' ? '' : ' hidden'}`);
    machineGunPanel.appendChild(el('h4', 'arcade-vehicle-subtitle', 'Maschinengewehr'));
    const machineGunSelect = document.createElement('select');
    machineGunSelect.className = 'hangar-machine-gun-select';
    machineGunSelect.setAttribute('aria-label', 'Maschinengewehr-Modell');
    FIGHT_MACHINE_GUN_MODELS.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.label} · ${model.role}`;
        machineGunSelect.appendChild(option);
    });
    const machineGunDetails = el('p', 'field-hint hangar-machine-gun-details');
    machineGunDetails.setAttribute('aria-live', 'polite');
    machineGunPanel.append(machineGunSelect, machineGunDetails);
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
    comparePanel.append(compareHeader, statRows, budgetRows);
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
    HANGAR_STARTER_BUILDS.forEach((starterBuild) => {
        const node = button('secondary-btn hangar-starter-build', '', starterBuild.description);
        node.dataset.starterBuild = starterBuild.id;
        node.append(
            el('strong', 'hangar-starter-build-name', starterBuild.label),
            el('span', 'hangar-starter-build-description', starterBuild.description)
        );
        starterBuilds.appendChild(node);
    });
    starterPanel.appendChild(starterBuilds);
    const loadoutPanel = el('section', 'arcade-vehicle-loadout hangar-preset-panel');
    loadoutPanel.appendChild(el('h4', 'arcade-vehicle-subtitle', 'Build-Presets'));
    const presetName = document.createElement('input');
    presetName.type = 'text';
    presetName.className = 'arcade-vehicle-preset-input';
    presetName.placeholder = 'Build-Name';
    presetName.setAttribute('aria-label', 'Build-Name');
    const presetSelect = document.createElement('select');
    presetSelect.className = 'arcade-vehicle-preset-select';
    presetSelect.setAttribute('aria-label', 'Gespeicherter Build');
    const presetSort = document.createElement('select');
    presetSort.className = 'hangar-preset-sort';
    presetSort.setAttribute('aria-label', 'Builds sortieren');
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
    presetTags.setAttribute('aria-label', 'Build-Tags, kommagetrennt');
    const presetActions = el('div', 'arcade-vehicle-loadout-controls hangar-preset-actions');
    const presetSave = button('secondary-btn arcade-vehicle-preset-save', 'Speichern');
    const presetSaveAs = button('secondary-btn hangar-preset-save-as', 'Speichern als');
    const presetLoad = button('secondary-btn arcade-vehicle-preset-load', 'Laden');
    const presetRename = button('secondary-btn hangar-preset-rename', 'Umbenennen');
    const presetDuplicate = button('secondary-btn hangar-preset-duplicate', 'Duplizieren');
    const presetDelete = button('secondary-btn arcade-vehicle-preset-delete hangar-danger-action', 'Löschen');
    const presetFavorite = button('secondary-btn hangar-preset-favorite', '☆ Favorit');
    const presetExport = button('secondary-btn hangar-preset-export', 'Export');
    const presetImport = button('secondary-btn hangar-preset-import', 'Import');
    const presetPrimaryActions = el('div', 'hangar-preset-primary-actions');
    presetPrimaryActions.append(presetSave, presetSaveAs, presetLoad);
    const presetMore = document.createElement('details');
    presetMore.className = 'hangar-preset-more';
    const presetMoreSummary = document.createElement('summary');
    presetMoreSummary.textContent = 'Weitere Aktionen';
    presetMoreSummary.setAttribute('role', 'button');
    presetMoreSummary.setAttribute('aria-controls', 'hangar-preset-more-actions');
    const presetMoreActions = el('div', 'hangar-preset-more-actions');
    presetMoreActions.id = 'hangar-preset-more-actions';
    presetMoreActions.append(presetRename, presetDuplicate, presetFavorite, presetExport, presetImport, presetDelete);
    presetMore.append(presetMoreSummary, presetMoreActions);
    presetActions.append(presetPrimaryActions, presetMore);
    const activateButton = button('start-btn hangar-activate-build', mode === 'fight' ? 'Für nächsten Kampf aktivieren' : 'Für nächsten Run aktivieren');
    loadoutPanel.append(presetName, presetTags, presetSort, presetSelect, presetActions);
    const workshopViewPanel = el('div', 'hangar-build-view-panel');
    workshopViewPanel.id = 'hangar-build-panel-workshop';
    workshopViewPanel.dataset.buildViewPanel = 'workshop';
    workshopViewPanel.setAttribute('role', 'tabpanel');
    workshopViewPanel.setAttribute('aria-labelledby', workshopViewButton.id);
    workshopViewPanel.append(machineGunPanel, partPreviewBox, slotsPanel, validationBox, historyBar);
    const statsViewPanel = el('div', 'hangar-build-view-panel hidden');
    statsViewPanel.id = 'hangar-build-panel-stats';
    statsViewPanel.dataset.buildViewPanel = 'stats';
    statsViewPanel.setAttribute('role', 'tabpanel');
    statsViewPanel.setAttribute('aria-labelledby', statsViewButton.id);
    statsViewPanel.appendChild(comparePanel);
    const presetsViewPanel = el('div', 'hangar-build-view-panel hidden');
    presetsViewPanel.id = 'hangar-build-panel-presets';
    presetsViewPanel.dataset.buildViewPanel = 'presets';
    presetsViewPanel.setAttribute('role', 'tabpanel');
    presetsViewPanel.setAttribute('aria-labelledby', presetsViewButton.id);
    presetsViewPanel.append(
        starterPanel,
        loadoutPanel,
        infoHint('Entf: Stein entfernen · Strg+Z/Y: Undo/Redo · Vorschau: Pfeile wechseln das Fahrzeug', 'arcade-vehicle-shortcuts')
    );
    buildScroll.append(
        detailHead, profileBox, buildViewSwitch, workshopViewPanel, statsViewPanel, presetsViewPanel
    );
    const activationDock = el('div', 'hangar-activation-dock');
    activationDock.appendChild(activateButton);
    rightPanel.append(buildScroll, activationDock);
    layout.appendChild(rightPanel);
    const statusBar = el('footer', 'hangar-status-bar');
    const statusMessage = el('span', 'hangar-status-message', 'Hangar wird geladen …');
    statusMessage.setAttribute('role', 'status');
    statusMessage.setAttribute('aria-live', 'polite');
    const activeBuildLabel = el('span', 'hangar-active-build-label', mode === 'fight' ? 'Aktiver Kampf-Build: Standard' : 'Aktiver Run-Build: Standard');
    statusBar.append(statusMessage, activeBuildLabel);
    container.appendChild(statusBar);

    return {
        container, saveState, viewSwitch, vehiclesViewButton, partsViewButton, search, onlyFavBtn,
        categoryTabs, hitboxChips, levelChips, partFilters, familySelect, tierSelect, traitSelect, availabilitySelect, partFilterReset, quickRows,
        favRow, recentRow, resultLine, catalogList, cameraToolbar, cameraReset, previewStage,
        vehiclePreviousButton, vehicleNextButton,
        previewOverlay, pairToggle, removeZone, detailTitle, detailMeta, detailDescription, favoriteBtn, levelLine,
        levelDetail, xpFill, machineGunPanel, machineGunSelect, machineGunDetails, compareSelect, buildCompareSelect, statRows, budgetRows, partPreviewBox, slotGrid, validationBox, undoButton,
        redoButton, revertButton, defaultButton, starterBuilds, presetName, presetSelect, presetSave,
        presetSaveAs, presetLoad, presetRename, presetDuplicate, presetDelete, presetSort, presetTags,
        presetFavorite, presetExport, presetImport, buildScroll, buildViewSwitch,
        workshopViewButton, statsViewButton, presetsViewButton,
        workshopViewPanel, statsViewPanel, presetsViewPanel, activationDock, activateButton,
        statusMessage, activeBuildLabel,
    };
}
