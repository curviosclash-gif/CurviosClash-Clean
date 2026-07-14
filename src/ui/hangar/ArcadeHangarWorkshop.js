import {
    ARCADE_VEHICLE_PROFILE_MAX_LEVEL,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    getArcadeVehicleProfileRecord,
    readArcadeVehicleProfileRecord,
} from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { HANGAR_SELECTION_PLAYER_SLOTS, writeHangarVehicleSelection } from './HangarSelectionWritebackContract.js';
import {
    getVehicleManagerInteractionRules,
    listVehicleManagerCatalogEntries,
    resolveVehicleManagerCatalogEntry,
} from '../arcade/VehicleManagerCatalog.js';
import { createVehicleManagerSelectionState } from '../arcade/vehicle-manager/VehicleManagerSelectionState.js';
import {
    HITBOX_LABELS,
    LEVEL_LABELS,
    createUiNode as el,
    normalizeVehicleValue as norm,
    resolvePlayerColor,
} from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { resolveHangarPart } from './HangarPartCatalog.js';
import {
    HangarBuildHistory,
    areHangarBuildsEqual,
    createDefaultHangarBuild,
    installHangarPart,
    normalizeHangarBuild,
    removeHangarPart,
} from './HangarBuildDraftState.js';
import { hangarBuildToProfileUpgrades, validateHangarBuild, validateHangarDrop } from './HangarBuildValidation.js';
import { createHangarBuildPersistenceAdapter } from './HangarBuildPersistence.js';
import { createHangarViewport3d } from './HangarViewport3d.js';
import { createHangarDragDropController } from './HangarDragDropController.js';
import { createArcadeHangarWorkshopShell } from './ArcadeHangarWorkshopShell.js';
import { createArcadeHangarWorkshopRenderer } from './ArcadeHangarWorkshopRenderer.js';

const HITBOX_TO_CONTRACT = Object.freeze({ kompakt: 'compact', standard: 'standard', schwer: 'heavy' });

function createFallbackProfilePort(store) {
    const xpForLevel = (level) => level <= 1 ? 0 : Math.floor(100 * Math.pow(level, 1.5));
    return Object.freeze({
        load() {
            const raw = store?.loadJsonRecord?.(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, {}) || {};
            return readArcadeVehicleProfileRecord(raw).profiles;
        },
        save(profiles) { return store?.saveJsonRecord?.(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, profiles); },
        getOrCreate: (profiles, vehicleId) => getArcadeVehicleProfileRecord(profiles, vehicleId),
        getSpendableUpgradeXp: (profile) => Math.max(0, Number(profile?.xpBank ?? profile?.xp) || 0),
        xpToNextLevel(profile) {
            const level = Math.max(1, Math.min(ARCADE_VEHICLE_PROFILE_MAX_LEVEL, Number(profile?.level) || 1));
            if (level >= ARCADE_VEHICLE_PROFILE_MAX_LEVEL) return { current: 0, required: 0, progress: 1 };
            const floor = xpForLevel(level);
            const required = xpForLevel(level + 1) - floor;
            const current = Math.max(0, (Number(profile?.xp) || 0) - floor);
            return { current, required, progress: required > 0 ? Math.min(1, current / required) : 1 };
        },
    });
}

function createButton(className, text) {
    const button = el('button', className, text);
    button.type = 'button';
    return button;
}

function mapHitboxClass(entry) {
    return HITBOX_TO_CONTRACT[String(entry?.hitboxKlasse || '').toLowerCase()] || 'standard';
}

function buildFromProfile(vehicleId, entry, profile) {
    return normalizeHangarBuild({
        ...createDefaultHangarBuild(vehicleId, { hitboxClass: mapHitboxClass(entry) }),
        upgrades: profile?.upgrades || {},
    });
}

function describeDropFailure(result) {
    if (result?.message) return result.message;
    return {
        incompatible_slot: 'Dieses Bauteil passt nicht auf den gewählten Slot.',
        required_slot: 'Ein Pflichtslot kann nur durch ein anderes Teil ersetzt werden.',
        slot_locked: 'Dieser Slot ist noch gesperrt.',
        tier_locked: 'Dieses Teile-Tier ist noch gesperrt.',
        part_family_locked: 'Diese Teilefamilie ist noch gesperrt.',
        level_locked: 'Dein Fahrzeuglevel ist für dieses Bauteil zu niedrig.',
    }[String(result?.code || '')] || 'Der Umbau wurde abgelehnt; der Entwurf blieb unverändert.';
}

export function setupArcadeHangarWorkshop(ctx = {}) {
    const ui = ctx.ui || {};
    const settings = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : {};
    const runtimeAccess = ctx.runtimeAccess && typeof ctx.runtimeAccess === 'object' ? ctx.runtimeAccess : null;
    const bind = typeof ctx.bind === 'function' ? ctx.bind : null;
    const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
    const eventTypes = ctx.eventTypes || {};
    if (!bind) return null;
    const store = runtimeAccess?.getSettingsStore?.() || ctx.settingsManager?.getSettingsRecordStorePort?.() || null;
    const profilePort = runtimeAccess?.arcadeVehicleProfileWorkshop || createFallbackProfilePort(store);
    const rules = getVehicleManagerInteractionRules();
    const catalogEntries = listVehicleManagerCatalogEntries();
    if (!catalogEntries.length) return null;
    const byVehicleId = new Map(catalogEntries.map((entry) => [entry.vehicleId, entry]));
    const selection = createVehicleManagerSelectionState({ settings, catalogEntries });
    const persistence = createHangarBuildPersistenceAdapter({ mode: 'arcade', store, invokeCapability: runtimeAccess?.invokeHangarCapability });
    let profiles = profilePort.load();
    let catalogView = 'vehicles';
    let partFamily = 'all';
    let partTier = 'ALL';
    let selectedSlotId = 'core';
    let draft = null;
    let savedBuild = null;
    let history = null;
    let hydrated = false;
    let disposed = false;

    const shell = createArcadeHangarWorkshopShell(rules);
    const {
        container, viewSwitch, search, onlyFavBtn, categoryTabs, hitboxChips, levelChips,
        familySelect, tierSelect, quickRows, catalogList, cameraToolbar, cameraReset, previewStage,
        previewOverlay, pairToggle, favoriteBtn, compareSelect, slotGrid, undoButton, redoButton,
        revertButton, defaultButton, presetName, presetSelect, presetSave, presetSaveAs, presetLoad,
        presetRename, presetDuplicate, presetDelete, activateButton, statusMessage,
    } = shell;
    search.value = selection.getSearchTerm();
    const viewport = createHangarViewport3d({ mount: previewStage, overlay: previewOverlay, color: resolvePlayerColor(settings) });
    let renderer = null;

    function toast(message, tone = 'info') {
        statusMessage.textContent = String(message || '');
        statusMessage.dataset.tone = tone;
        if (emit && eventTypes.SHOW_STATUS_TOAST) emit(eventTypes.SHOW_STATUS_TOAST, { message, tone, duration: 1600 });
    }

    function entryFor(vehicleId) {
        return byVehicleId.get(String(vehicleId || '').toLowerCase()) || resolveVehicleManagerCatalogEntry(vehicleId);
    }

    function profileFor(vehicleId) {
        const id = norm(vehicleId, 'ship5').toLowerCase();
        profiles[id] = profilePort.getOrCreate(profiles, id);
        return profiles[id];
    }

    function syncVehicleWriteback(vehicleId) {
        const id = norm(vehicleId, 'ship5').toLowerCase();
        writeHangarVehicleSelection(settings, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1, id, 'ship5', { modePath: 'arcade' });
        const hasOption = Array.from(ui.vehicleSelectP1?.options || []).some((option) => option.value === id);
        if (hasOption && ui.vehicleSelectP1.value !== id) {
            ui.vehicleSelectP1.value = id;
            ui.vehicleSelectP1.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return id;
    }

    function initialBuild(vehicleId) {
        return persistence.getActiveBuild(vehicleId)
            || persistence.listBuilds(vehicleId)[0]
            || buildFromProfile(vehicleId, entryFor(vehicleId), profileFor(vehicleId));
    }

    function isDirty() {
        return savedBuild ? !areHangarBuildsEqual(draft, savedBuild) : false;
    }

    function state() {
        return {
            draft, savedBuild, history, hydrated, profiles, catalogView, partFamily, partTier,
            selectedSlotId, buildFromProfile,
            xpToNextLevel: profilePort.xpToNextLevel,
            getSpendableUpgradeXp: profilePort.getSpendableUpgradeXp,
        };
    }

    function syncDisplay(options = {}) {
        if (!disposed) renderer?.sync(options);
    }

    function setDraft(nextBuild, options = {}) {
        draft = normalizeHangarBuild(nextBuild);
        if (!history || options.resetHistory) history = new HangarBuildHistory(draft);
        else if (options.recordHistory !== false) history.push(draft);
        if (options.saved) savedBuild = normalizeHangarBuild(draft);
        syncDisplay();
    }

    function selectVehicle(vehicleId, options = {}) {
        const id = syncVehicleWriteback(vehicleId);
        selection.setSelectedVehicleId(id, options);
        savedBuild = persistence.getActiveBuild(id) || persistence.listBuilds(id)[0] || null;
        setDraft(savedBuild || initialBuild(id), { resetHistory: true, recordHistory: false });
    }

    function installWithPair(build, partId, slotId) {
        const part = resolveHangarPart(partId);
        return installHangarPart(build, partId, slotId, { pair: pairToggle.checked && part?.symmetric === true });
    }

    function evaluateInstall(partId, slotId) {
        return validateHangarDrop(draft, partId, slotId, profileFor(draft.vehicleId).level, installWithPair);
    }

    function applyInstall(partId, slotId) {
        const result = evaluateInstall(partId, slotId);
        if (!result.ok) {
            toast(describeDropFailure(result), 'warning');
            return false;
        }
        selectedSlotId = slotId;
        setDraft(result.build);
        toast(`${resolveHangarPart(partId)?.label || partId} montiert`, 'success');
        return true;
    }

    function evaluateRemoval(slotId) {
        const removal = removeHangarPart(draft, slotId, { pair: pairToggle.checked });
        if (!removal.ok) return removal;
        const validation = validateHangarBuild(removal.build, profileFor(draft.vehicleId).level);
        return validation.ok
            ? { ...validation, ok: true, build: removal.build }
            : { ...validation, ok: false, code: validation.errors[0]?.code, message: validation.errors[0]?.message };
    }

    function applyRemoval(slotId) {
        const result = evaluateRemoval(slotId);
        if (!result.ok) {
            toast(describeDropFailure(result), 'warning');
            return false;
        }
        setDraft(result.build);
        toast('Bauteil entfernt');
        return true;
    }

    function quickUpgrade(slotId) {
        const part = resolveHangarPart(draft.slots[slotId]);
        if (part && part.tier !== 'T3') applyInstall(`${part.family}_${part.tier === 'T1' ? 't2' : 't3'}`, slotId);
    }

    function commitProfileForRun(build) {
        const profile = profileFor(build.vehicleId);
        profiles[build.vehicleId] = { ...profile, upgrades: hangarBuildToProfileUpgrades(build), updatedAt: new Date().toISOString() };
        profilePort.save(profiles);
    }

    async function saveCurrent(options = {}) {
        const validation = validateHangarBuild(draft, profileFor(draft.vehicleId).level);
        if (!validation.ok) {
            toast('Ungültige Builds werden nicht gespeichert.', 'warning');
            return { ok: false, validation };
        }
        const name = norm(presetName.value, savedBuild?.name || `${entryFor(draft.vehicleId).label} Build`);
        const result = await persistence.saveBuild(draft, {
            asNew: options.asNew === true || !savedBuild,
            activate: options.activate === true,
            name,
        });
        if (!result.ok) {
            toast('Build konnte nicht gespeichert werden.', 'error');
            return result;
        }
        draft = normalizeHangarBuild(result.build);
        savedBuild = normalizeHangarBuild(result.build);
        history = new HangarBuildHistory(draft);
        presetName.value = '';
        if (options.activate) commitProfileForRun(draft);
        toast(options.activate ? 'Build gespeichert und für den nächsten Run aktiviert.' : `Build gespeichert: ${draft.name}`, 'success');
        syncDisplay();
        return result;
    }

    function prepareRunStart() {
        const validation = validateHangarBuild(draft, profileFor(draft.vehicleId).level);
        if (!validation.ok) {
            toast('Run-Start blockiert: Der angezeigte Build ist ungültig.', 'warning');
            return { ok: false, code: 'invalid_build', validation };
        }
        syncVehicleWriteback(draft.vehicleId);
        commitProfileForRun(draft);
        const needsSave = isDirty() || !savedBuild;
        void persistence.saveBuild(draft, { asNew: !savedBuild, activate: true, name: savedBuild?.name || draft.name }).then((result) => {
            if (!result.ok || disposed) return;
            draft = normalizeHangarBuild(result.build);
            savedBuild = normalizeHangarBuild(result.build);
            history = new HangarBuildHistory(draft);
            syncDisplay();
        });
        toast(needsSave ? 'Angezeigter Build wird gespeichert und für den Run aktiviert.' : 'Aktiver Build ist für den Run synchronisiert.', 'success');
        container.dataset.activeRunVehicleId = draft.vehicleId;
        container.dataset.activeRunBuildId = draft.buildId;
        return { ok: true, vehicleId: draft.vehicleId, build: normalizeHangarBuild(draft), validation };
    }

    renderer = createArcadeHangarWorkshopRenderer({
        shell, settings, catalogEntries, selection, persistence, viewport, getState: state,
        entryFor, profileFor, evaluateInstall, describeFailure: describeDropFailure,
        onQuickUpgrade: quickUpgrade,
        onSelectSlot(slotId) { selectedSlotId = slotId; viewport.setSelectedSlot(slotId); },
        isDirty,
    });

    const dragController = createHangarDragDropController({
        viewport,
        onStart(payload) { syncDisplay({ dragPartId: payload.partId, preserveCatalog: true }); toast(`${payload.label} aufgenommen · Esc zum Abbrechen`); },
        evaluateTarget(payload, target) { return target.type === 'remove' ? evaluateRemoval(payload.sourceSlotId) : evaluateInstall(payload.partId, target.slotId); },
        onDrop(payload, target) { if (target.type === 'remove') applyRemoval(payload.sourceSlotId); else applyInstall(payload.partId, target.slotId); },
        onReject(result) { toast(describeDropFailure(result), 'warning'); syncDisplay(); },
        onCancel(reason) { if (reason === 'escape') toast('Drag abgebrochen'); syncDisplay(); },
    });

    rules.categories.forEach((category) => {
        const node = createButton('arcade-vehicle-tab', category.label);
        node.dataset.category = category.id;
        categoryTabs.appendChild(node);
    });
    ['all', ...rules.filterChips.hitboxKlasse].forEach((value) => {
        const node = createButton('arcade-vehicle-chip', HITBOX_LABELS[value] || value);
        node.dataset.filterValue = value;
        hitboxChips.appendChild(node);
    });
    ['all', ...rules.filterChips.levelBand].forEach((value) => {
        const node = createButton('arcade-vehicle-chip', LEVEL_LABELS[value] || value);
        node.dataset.filterValue = value;
        levelChips.appendChild(node);
    });

    bind(viewSwitch, 'click', (event) => {
        const view = event.target?.closest?.('[data-catalog-view]')?.dataset.catalogView;
        if (!view) return;
        catalogView = view === 'parts' ? 'parts' : 'vehicles';
        search.value = catalogView === 'vehicles' ? selection.getSearchTerm() : '';
        syncDisplay();
    });
    bind(search, 'input', () => { if (catalogView === 'vehicles') selection.setSearchTerm(search.value); syncDisplay(); });
    bind(onlyFavBtn, 'click', () => { selection.setFavoritesOnly(!selection.isFavoritesOnly()); syncDisplay(); });
    bind(categoryTabs, 'click', (event) => { const value = event.target?.closest?.('[data-category]')?.dataset.category; if (value) { selection.setCategory(value); syncDisplay(); } });
    bind(hitboxChips, 'click', (event) => { const value = event.target?.closest?.('[data-filter-value]')?.dataset.filterValue; if (value) { selection.setHitboxFilter(value); syncDisplay(); } });
    bind(levelChips, 'click', (event) => { const value = event.target?.closest?.('[data-filter-value]')?.dataset.filterValue; if (value) { selection.setLevelFilter(value); syncDisplay(); } });
    bind(familySelect, 'change', () => { partFamily = familySelect.value; syncDisplay(); });
    bind(tierSelect, 'change', () => { partTier = tierSelect.value; syncDisplay(); });
    bind(catalogList, 'click', (event) => { const id = event.target?.closest?.('[data-vehicle-id]')?.dataset.vehicleId; if (id) selectVehicle(id); });
    bind(quickRows, 'click', (event) => { const id = event.target?.closest?.('[data-quick-vehicle-id]')?.dataset.quickVehicleId; if (id) selectVehicle(id); });
    bind(catalogList, 'pointerdown', (event) => {
        const card = event.target?.closest?.('[data-part-id]');
        if (card) dragController.begin(event, { partId: card.dataset.partId, label: card.dataset.partLabel, locked: card.dataset.locked === 'true', lockedReason: card.dataset.lockedReason }, card);
    });
    bind(slotGrid, 'pointerdown', (event) => {
        const item = event.target?.closest?.('[data-installed-slot][data-part-id]');
        if (item) dragController.begin(event, { partId: item.dataset.partId, label: item.dataset.partLabel, sourceSlotId: item.dataset.installedSlot }, item);
    });
    bind(slotGrid, 'click', (event) => {
        const selected = event.target?.closest?.('[data-select-slot]')?.dataset.selectSlot;
        const upgrade = event.target?.closest?.('[data-quick-upgrade]')?.dataset.quickUpgrade;
        const remove = event.target?.closest?.('[data-remove-slot]')?.dataset.removeSlot;
        if (selected) { selectedSlotId = selected; syncDisplay(); } else if (upgrade) quickUpgrade(upgrade); else if (remove) applyRemoval(remove);
    });
    bind(favoriteBtn, 'click', () => { selection.toggleFavorite(draft.vehicleId); syncDisplay(); });
    bind(compareSelect, 'change', () => { selection.setCompareVehicleId(compareSelect.value); syncDisplay(); });
    bind(cameraToolbar, 'click', (event) => { const preset = event.target?.closest?.('[data-camera-preset]')?.dataset.cameraPreset; if (preset) viewport.setCameraPreset(preset); });
    bind(cameraReset, 'click', () => viewport.resetCamera());
    bind(undoButton, 'click', () => { const value = history.undo(); if (value) { draft = value; syncDisplay(); } });
    bind(redoButton, 'click', () => { const value = history.redo(); if (value) { draft = value; syncDisplay(); } });
    bind(revertButton, 'click', () => { if (savedBuild) setDraft(savedBuild, { resetHistory: true, recordHistory: false }); });
    bind(defaultButton, 'click', () => setDraft(createDefaultHangarBuild(draft.vehicleId, { hitboxClass: mapHitboxClass(entryFor(draft.vehicleId)) }), { resetHistory: true }));
    bind(presetSave, 'click', () => { void saveCurrent(); });
    bind(presetSaveAs, 'click', () => { void saveCurrent({ asNew: true }); });
    bind(presetLoad, 'click', () => { const value = persistence.getBuild(presetSelect.value); if (value) { savedBuild = value; setDraft(value, { resetHistory: true, recordHistory: false }); } });
    bind(presetRename, 'click', async () => { const name = norm(presetName.value); if (!name) return; const result = await persistence.renameBuild(presetSelect.value, name); if (result.ok && savedBuild?.buildId === result.build.buildId) savedBuild = result.build; presetName.value = ''; syncDisplay(); });
    bind(presetDuplicate, 'click', async () => { const value = persistence.getBuild(presetSelect.value); if (value) await persistence.duplicateBuild(value, norm(presetName.value, `${value.name} Kopie`)); presetName.value = ''; syncDisplay(); });
    bind(presetDelete, 'click', async () => { if (!presetSelect.value || (window.confirm && !window.confirm('Diesen Build wirklich löschen?'))) return; const id = presetSelect.value; await persistence.deleteBuild(id); if (savedBuild?.buildId === id) savedBuild = null; syncDisplay(); });
    bind(activateButton, 'click', () => { void saveCurrent({ activate: true }); });
    bind(container, 'keydown', (event) => {
        const editing = ['input', 'select', 'textarea'].includes(String(event.target?.tagName || '').toLowerCase());
        if (event.key === 'Delete' && !editing) { event.preventDefault(); applyRemoval(selectedSlotId); }
        else if (event.ctrlKey && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); const value = history.undo(); if (value) { draft = value; syncDisplay(); } }
        else if (event.ctrlKey && event.key.toLowerCase() === 'y' && !editing) { event.preventDefault(); const value = history.redo(); if (value) { draft = value; syncDisplay(); } }
        else if (!editing && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); selectVehicle(selection.getNextVisibleVehicleId(event.key === 'ArrowRight' ? 1 : -1, profiles)); }
    });
    if (ui.vehicleSelectP1) bind(ui.vehicleSelectP1, 'change', () => { const id = norm(ui.vehicleSelectP1.value).toLowerCase(); if (id && draft && id !== draft.vehicleId) selectVehicle(id, { skipRecent: true }); });

    const initialVehicleId = syncVehicleWriteback(selection.getSelectedVehicleId());
    draft = initialBuild(initialVehicleId);
    savedBuild = persistence.getActiveBuild(initialVehicleId) || persistence.listBuilds(initialVehicleId)[0] || null;
    history = new HangarBuildHistory(draft);
    toast('Gespeicherte Builds werden geladen …');
    syncDisplay();
    void persistence.hydrate().then(() => {
        if (disposed) return;
        hydrated = true;
        if (!isDirty()) {
            const loaded = persistence.getActiveBuild(draft.vehicleId) || persistence.listBuilds(draft.vehicleId)[0];
            if (loaded) { savedBuild = loaded; draft = loaded; history = new HangarBuildHistory(draft); }
        }
        toast('Hangar bereit', 'success');
        syncDisplay();
    });

    return Object.freeze({
        container,
        syncDisplay,
        getSelectedVehicleId: () => draft.vehicleId,
        getDraftBuild: () => normalizeHangarBuild(draft),
        getActiveBuild: () => persistence.getActiveBuild(draft.vehicleId),
        prepareRunStart,
        dispose() {
            if (disposed) return;
            disposed = true;
            dragController.dispose();
            viewport.dispose();
            container.dataset.lifecycle = 'disposed';
        },
    });
}
