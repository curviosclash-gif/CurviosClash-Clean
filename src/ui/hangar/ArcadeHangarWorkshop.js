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
import { registerPublishedHangarParts, resolveHangarPart } from './HangarPartCatalog.js';
import { VEHICLE_LAB_HANGAR_PUBLISH_STORAGE_KEY } from '../../shared/contracts/VehicleLabHangarPublishContract.js';
import {
    HangarBuildHistory,
    areHangarBuildsEqual,
    createDefaultHangarBuild,
    installHangarPart,
    normalizeHangarBuild,
    removeHangarPart,
} from './HangarBuildDraftState.js';
import { describeHangarDropFailure as describeDropFailure, hangarBuildToProfileBonuses, hangarBuildToProfileUpgrades, validateHangarBuild, validateHangarDrop } from './HangarBuildValidation.js';
import { createHangarBuildPersistenceAdapter } from './HangarBuildPersistence.js';
import { createHangarViewport3d } from './HangarViewport3d.js';
import { createHangarDragDropController } from './HangarDragDropController.js';
import { createArcadeHangarWorkshopShell } from './ArcadeHangarWorkshopShell.js';
import { createArcadeHangarWorkshopRenderer } from './ArcadeHangarWorkshopRenderer.js';
import { createHangarDraftPersistence } from './HangarDraftPersistence.js';
import { createHangarWorkshopAudio } from './HangarWorkshopAudio.js';
import { createHangarStarterBuild } from './HangarStarterBuildCatalog.js';
import { createFallbackProfilePort, createHangarBuildFromProfile as buildFromProfile, mapHangarHitboxClass } from './HangarWorkshopProfileSupport.js';

function createButton(className, text) {
    const button = el('button', className, text);
    button.type = 'button';
    return button;
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
    registerPublishedHangarParts(store?.loadJsonRecord?.(VEHICLE_LAB_HANGAR_PUBLISH_STORAGE_KEY, null));
    const profilePort = runtimeAccess?.arcadeVehicleProfileWorkshop || createFallbackProfilePort(store);
    const rules = getVehicleManagerInteractionRules();
    const catalogEntries = listVehicleManagerCatalogEntries();
    if (!catalogEntries.length) return null;
    const byVehicleId = new Map(catalogEntries.map((entry) => [entry.vehicleId, entry]));
    const selection = createVehicleManagerSelectionState({ settings, catalogEntries });
    const persistence = createHangarBuildPersistenceAdapter({ mode: 'arcade', store, invokeCapability: runtimeAccess?.invokeHangarCapability });
    const draftPersistence = createHangarDraftPersistence({ mode: 'arcade', store });
    const audio = createHangarWorkshopAudio();
    let profiles = profilePort.load();
    let catalogView = 'vehicles';
    let partFamily = 'all';
    let partTier = 'ALL';
    let partTrait = 'all';
    let partAvailability = 'all';
    let selectedSlotId = 'core';
    let selectedPartId = '';
    let previewPartId = '';
    let draft = null;
    let savedBuild = null;
    let history = null;
    let hydrated = false;
    let disposed = false;
    let draftSaveTimer = 0;
    let persistDraftChanges = false;

    const shell = createArcadeHangarWorkshopShell(rules);
    const {
        container, viewSwitch, search, onlyFavBtn, categoryTabs, hitboxChips, levelChips,
        familySelect, tierSelect, traitSelect, availabilitySelect, quickRows, catalogList, cameraToolbar, cameraReset, previewStage,
        previewOverlay, pairToggle, favoriteBtn, compareSelect, slotGrid, undoButton, redoButton,
        revertButton, defaultButton, presetName, presetSelect, presetSave, presetSaveAs, presetLoad,
        presetRename, presetDuplicate, presetDelete, presetSort, presetTags, presetFavorite,
        presetExport, presetImport, buildCompareSelect, starterBuilds, activateButton, statusMessage,
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
        runtimeAccess?.saveSettings?.(settings);
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
            partTrait, partAvailability, selectedSlotId, selectedPartId, previewPartId, buildFromProfile,
            xpToNextLevel: profilePort.xpToNextLevel,
            xpForLevel: profilePort.xpForLevel,
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
        if (persistDraftChanges && options.persist !== false) {
            if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
            draftSaveTimer = window.setTimeout(() => {
                draftSaveTimer = 0;
                if (savedBuild && areHangarBuildsEqual(draft, savedBuild)) draftPersistence.clear(draft.vehicleId);
                else draftPersistence.save(draft);
            }, 180);
        }
        syncDisplay(options);
    }

    function selectVehicle(vehicleId, options = {}) {
        const id = syncVehicleWriteback(vehicleId);
        selection.setSelectedVehicleId(id, options);
        selectedPartId = '';
        previewPartId = '';
        savedBuild = persistence.getActiveBuild(id) || persistence.listBuilds(id)[0] || null;
        setDraft(draftPersistence.load(id) || savedBuild || initialBuild(id), { resetHistory: true, recordHistory: false, persist: false });
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
        selectedPartId = '';
        previewPartId = '';
        setDraft(result.build, { changedSlots: result.changedSlots });
        audio.play('drop');
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
        setDraft(result.build, { changedSlots: result.changedSlots });
        audio.play('drop');
        toast('Bauteil entfernt');
        return true;
    }

    function quickUpgrade(slotId) {
        const part = resolveHangarPart(draft.slots[slotId]);
        if (part?.upgradeTo) applyInstall(part.upgradeTo, slotId);
    }

    function selectPart(partId) {
        const part = resolveHangarPart(partId);
        if (!part) return;
        selectedPartId = selectedPartId === part.id ? '' : part.id;
        previewPartId = selectedPartId;
        if (selectedPartId && !part.compatibleSlots.includes(selectedSlotId)) selectedSlotId = part.compatibleSlots[0];
        toast(selectedPartId ? `${part.label} ausgewählt · jetzt Hardpoint anklicken` : 'Teileauswahl aufgehoben');
        syncDisplay();
    }

    function handleSlotSelection(slotId) {
        if (selectedPartId) {
            applyInstall(selectedPartId, slotId);
            return;
        }
        selectedSlotId = slotId;
        viewport.setSelectedSlot(slotId);
        syncDisplay();
    }

    function applyStarterBuild(presetId) {
        const level = profileFor(draft.vehicleId).level;
        const starter = createHangarStarterBuild(draft, presetId, level);
        if (!starter) return;
        const validation = validateHangarBuild(starter, level);
        if (!validation.ok) {
            toast(`Starter-Build ist noch gesperrt: ${validation.errors[0]?.message || ''}`, 'warning');
            return;
        }
        selectedPartId = '';
        previewPartId = '';
        setDraft(starter, { changedSlots: Object.keys(starter.slots) });
        toast(`${starter.name} geladen`, 'success');
    }

    function commitProfileForRun(build) {
        const profile = profileFor(build.vehicleId);
        profiles[build.vehicleId] = {
            ...profile,
            upgrades: hangarBuildToProfileUpgrades(build),
            hangarBonuses: hangarBuildToProfileBonuses(build),
            updatedAt: new Date().toISOString(),
        };
        profilePort.save(profiles);
    }

    async function saveCurrent(options = {}) {
        const validation = validateHangarBuild(draft, profileFor(draft.vehicleId).level);
        if (!validation.ok) {
            toast('Ungültige Builds werden nicht gespeichert.', 'warning');
            return { ok: false, validation };
        }
        const name = norm(presetName.value, savedBuild?.name || `${entryFor(draft.vehicleId).label} Build`);
        const selectedPreset = persistence.getBuild(presetSelect.value);
        const buildToSave = normalizeHangarBuild({
            ...draft,
            favorite: selectedPreset?.buildId === draft.buildId ? selectedPreset.favorite : draft.favorite,
            tags: presetTags.value.split(','),
        });
        const result = await persistence.saveBuild(buildToSave, {
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
        draftPersistence.clear(draft.vehicleId);
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
        onSelectSlot: handleSlotSelection,
        isDirty,
    });

    const dragController = createHangarDragDropController({
        viewport,
        onStart(payload) { audio.play('pickup'); syncDisplay({ dragPartId: payload.partId, preserveCatalog: true }); toast(`${payload.label} aufgenommen · Esc zum Abbrechen`); },
        evaluateTarget(payload, target) { return target.type === 'remove' ? evaluateRemoval(payload.sourceSlotId) : evaluateInstall(payload.partId, target.slotId); },
        onDrop(payload, target) { if (target.type === 'remove') applyRemoval(payload.sourceSlotId); else applyInstall(payload.partId, target.slotId); },
        onReject(result) { audio.play('reject'); toast(describeDropFailure(result), 'warning'); syncDisplay(); },
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
        if (catalogView === 'vehicles') { selectedPartId = ''; previewPartId = ''; }
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
    bind(traitSelect, 'change', () => { partTrait = traitSelect.value; syncDisplay(); });
    bind(availabilitySelect, 'change', () => { partAvailability = availabilitySelect.value; syncDisplay(); });
    bind(catalogList, 'click', (event) => {
        const vehicleId = event.target?.closest?.('[data-vehicle-id]')?.dataset.vehicleId;
        if (vehicleId) { selectVehicle(vehicleId); return; }
        const card = event.target?.closest?.('[data-part-id]');
        if (!card) return;
        if (card.dataset.hangarSuppressClick === 'true') return;
        if (card.dataset.locked === 'true') {
            toast(card.dataset.lockedReason || 'Dieses Bauteil ist noch gesperrt.', 'warning');
            return;
        }
        selectPart(card.dataset.partId);
    });
    bind(catalogList, 'pointerover', (event) => {
        const card = event.target?.closest?.('[data-part-id]');
        if (!card || card.dataset.locked === 'true' || previewPartId === card.dataset.partId) return;
        previewPartId = card.dataset.partId;
        syncDisplay({ preserveCatalog: true });
    });
    bind(catalogList, 'pointerout', (event) => {
        const card = event.target?.closest?.('[data-part-id]');
        if (!card || card.contains(event.relatedTarget)) return;
        previewPartId = selectedPartId;
        syncDisplay({ preserveCatalog: true });
    });
    bind(quickRows, 'click', (event) => { const id = event.target?.closest?.('[data-quick-vehicle-id]')?.dataset.quickVehicleId; if (id) selectVehicle(id); });
    bind(catalogList, 'pointerdown', (event) => {
        const card = event.target?.closest?.('[data-part-id]');
        if (card && card.dataset.locked !== 'true') dragController.begin(event, { partId: card.dataset.partId, label: card.dataset.partLabel }, card);
    });
    bind(slotGrid, 'pointerdown', (event) => {
        const item = event.target?.closest?.('[data-installed-slot][data-part-id]');
        if (item) dragController.begin(event, { partId: item.dataset.partId, label: item.dataset.partLabel, sourceSlotId: item.dataset.installedSlot }, item);
    });
    bind(slotGrid, 'click', (event) => {
        if (event.target?.closest?.('[data-hangar-suppress-click="true"]')) return;
        const selected = event.target?.closest?.('[data-select-slot]')?.dataset.selectSlot
            || event.target?.closest?.('[data-installed-slot]')?.dataset.installedSlot;
        const upgrade = event.target?.closest?.('[data-quick-upgrade]')?.dataset.quickUpgrade;
        const remove = event.target?.closest?.('[data-remove-slot]')?.dataset.removeSlot;
        if (selected) handleSlotSelection(selected); else if (upgrade) quickUpgrade(upgrade); else if (remove) applyRemoval(remove);
    });
    bind(pairToggle, 'change', () => syncDisplay({ preserveCatalog: true }));
    bind(starterBuilds, 'click', (event) => {
        const presetId = event.target?.closest?.('[data-starter-build]')?.dataset.starterBuild;
        if (presetId) applyStarterBuild(presetId);
    });
    bind(favoriteBtn, 'click', () => { selection.toggleFavorite(draft.vehicleId); syncDisplay(); });
    bind(compareSelect, 'change', () => { selection.setCompareVehicleId(compareSelect.value); syncDisplay(); });
    bind(buildCompareSelect, 'change', () => syncDisplay());
    bind(cameraToolbar, 'click', (event) => { const preset = event.target?.closest?.('[data-camera-preset]')?.dataset.cameraPreset; if (preset) viewport.setCameraPreset(preset); });
    bind(cameraReset, 'click', () => viewport.resetCamera());
    bind(undoButton, 'click', () => { const value = history.undo(); if (value) setDraft(value, { recordHistory: false }); });
    bind(redoButton, 'click', () => { const value = history.redo(); if (value) setDraft(value, { recordHistory: false }); });
    bind(revertButton, 'click', () => { if (savedBuild) setDraft(savedBuild, { resetHistory: true, recordHistory: false }); });
    bind(defaultButton, 'click', () => {
        selectedPartId = '';
        previewPartId = '';
        setDraft(createDefaultHangarBuild(draft.vehicleId, { hitboxClass: mapHangarHitboxClass(entryFor(draft.vehicleId)) }), { resetHistory: true });
    });
    bind(presetSave, 'click', () => { void saveCurrent(); });
    bind(presetSaveAs, 'click', () => { void saveCurrent({ asNew: true }); });
    bind(presetSelect, 'change', () => syncDisplay());
    bind(presetLoad, 'click', () => {
        const value = persistence.getBuild(presetSelect.value);
        if (!value) return;
        const validation = validateHangarBuild(value, profileFor(value.vehicleId).level);
        savedBuild = value;
        setDraft(value, { resetHistory: true, recordHistory: false, persist: false });
        if (!validation.ok) toast(`Preset ist mit dem aktuellen Fortschritt ungültig: ${validation.errors[0]?.message}`, 'warning');
    });
    bind(presetRename, 'click', async () => { const name = norm(presetName.value); if (!name) return; const result = await persistence.renameBuild(presetSelect.value, name); if (result.ok && savedBuild?.buildId === result.build.buildId) savedBuild = result.build; presetName.value = ''; syncDisplay(); });
    bind(presetDuplicate, 'click', async () => { const value = persistence.getBuild(presetSelect.value); if (value) await persistence.duplicateBuild(value, norm(presetName.value, `${value.name} Kopie`)); presetName.value = ''; syncDisplay(); });
    bind(presetSort, 'change', () => syncDisplay());
    bind(presetFavorite, 'click', async () => {
        const value = persistence.getBuild(presetSelect.value);
        if (!value) return;
        await persistence.updateMetadata(value.buildId, { favorite: !value.favorite, tags: value.tags });
        syncDisplay();
    });
    bind(presetTags, 'change', async () => {
        const value = persistence.getBuild(presetSelect.value);
        if (!value) return;
        await persistence.updateMetadata(value.buildId, { favorite: value.favorite, tags: presetTags.value.split(',') });
        syncDisplay();
    });
    bind(presetExport, 'click', () => {
        const selected = persistence.getBuild(presetSelect.value);
        if (!selected) return;
        const blob = new Blob([JSON.stringify({ schemaVersion: persistence.version, builds: [selected] }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${selected.name.replace(/[^a-z0-9_-]+/gi, '-')}.hangar.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    });
    bind(presetImport, 'click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const result = await persistence.importBuilds(JSON.parse(await file.text()));
                toast(`${result.builds.length} Build(s) importiert`, result.ok ? 'success' : 'warning');
                syncDisplay();
            } catch { toast('Build-Import ist ungültig.', 'warning'); }
        };
        input.click();
    });
    bind(presetDelete, 'click', async () => { if (!presetSelect.value || (window.confirm && !window.confirm('Diesen Build wirklich löschen?'))) return; const id = presetSelect.value; await persistence.deleteBuild(id); if (savedBuild?.buildId === id) savedBuild = null; syncDisplay(); });
    bind(activateButton, 'click', () => { void saveCurrent({ activate: true }); });
    bind(container, 'keydown', (event) => {
        const editing = ['input', 'select', 'textarea'].includes(String(event.target?.tagName || '').toLowerCase());
        if (event.key === 'Escape' && selectedPartId && !editing) { event.preventDefault(); selectedPartId = ''; previewPartId = ''; toast('Teileauswahl aufgehoben'); syncDisplay(); }
        else if (event.key === 'Delete' && !editing) { event.preventDefault(); applyRemoval(selectedSlotId); }
        else if (event.ctrlKey && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); const value = history.undo(); if (value) setDraft(value, { recordHistory: false }); }
        else if (event.ctrlKey && event.key.toLowerCase() === 'y' && !editing) { event.preventDefault(); const value = history.redo(); if (value) setDraft(value, { recordHistory: false }); }
        else if (!editing && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); selectVehicle(selection.getNextVisibleVehicleId(event.key === 'ArrowRight' ? 1 : -1, profiles)); }
    });
    if (ui.vehicleSelectP1) bind(ui.vehicleSelectP1, 'change', () => { const id = norm(ui.vehicleSelectP1.value).toLowerCase(); if (id && draft && id !== draft.vehicleId) selectVehicle(id, { skipRecent: true }); });

    const initialVehicleId = syncVehicleWriteback(selection.getSelectedVehicleId());
    const recoveredDraft = draftPersistence.load(initialVehicleId);
    draft = recoveredDraft || initialBuild(initialVehicleId);
    savedBuild = persistence.getActiveBuild(initialVehicleId) || persistence.listBuilds(initialVehicleId)[0] || null;
    history = new HangarBuildHistory(draft);
    persistDraftChanges = true;
    toast(recoveredDraft ? 'Ungespeicherten Entwurf wiederhergestellt.' : 'Gespeicherte Builds werden geladen …', recoveredDraft ? 'success' : 'info');
    syncDisplay();
    void persistence.hydrate().then(() => {
        if (disposed) return;
        hydrated = true;
        const loaded = persistence.getActiveBuild(draft.vehicleId) || persistence.listBuilds(draft.vehicleId)[0];
        if (recoveredDraft) savedBuild = loaded || null;
        else if (!isDirty()) {
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
            if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
            audio.dispose();
            container.dataset.lifecycle = 'disposed';
        },
    });
}
