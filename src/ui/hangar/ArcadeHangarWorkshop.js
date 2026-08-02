import { persistHangarVehicleSelection } from './HangarWindowSettingsSync.js';
/* eslint-disable max-lines -- Hangar lifecycle wiring stays in one controller. */
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
import { purchaseHangarStone } from './HangarStoneInventory.js';
import { createFallbackProfilePort, createHangarBuildFromProfile as buildFromProfile, mapHangarHitboxClass } from './HangarWorkshopProfileSupport.js';
import { validateFightHangarBuild, validateFightHangarDrop } from './FightHangarValidation.js';
import { normalizeFightMachineGunId, resolveFightMachineGunModel } from '../../shared/contracts/FightMachineGunContract.js';

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
    const hangarMode = ctx.mode === 'fight' ? 'fight' : 'arcade';
    const store = runtimeAccess?.getSettingsStore?.() || ctx.settingsManager?.getSettingsRecordStorePort?.() || null;
    registerPublishedHangarParts(store?.loadJsonRecord?.(VEHICLE_LAB_HANGAR_PUBLISH_STORAGE_KEY, null));
    const profilePort = runtimeAccess?.arcadeVehicleProfileWorkshop || createFallbackProfilePort(store);
    const rules = getVehicleManagerInteractionRules();
    const catalogEntries = listVehicleManagerCatalogEntries();
    if (!catalogEntries.length) return null;
    const byVehicleId = new Map(catalogEntries.map((entry) => [entry.vehicleId, entry]));
    const selection = createVehicleManagerSelectionState({ settings, catalogEntries });
    const persistence = createHangarBuildPersistenceAdapter({ mode: hangarMode, store, invokeCapability: runtimeAccess?.invokeHangarCapability });
    const draftPersistence = createHangarDraftPersistence({ mode: hangarMode, store });
    const audio = createHangarWorkshopAudio();
    let profiles = profilePort.load();
    let catalogView = 'vehicles';
    let buildView = 'workshop';
    let partFamily = 'all';
    let partTier = 'ALL';
    let partTrait = 'all';
    let partAvailability = 'all';
    let selectedSlotId = 'core';
    let selectedPartId = '';
    let previewPartId = '';
    let draft = null;
    let savedBuild = null;
    let baselineBuild = null;
    let history = null;
    let hydrated = false;
    let disposed = false;
    let draftSaveTimer = 0;
    let persistDraftChanges = false;
    let lastReportedDirty = null;

    const shell = createArcadeHangarWorkshopShell(rules, { mode: hangarMode });
    const {
        container, viewSwitch, search, onlyFavBtn, categoryTabs, hitboxChips, levelChips,
        familySelect, tierSelect, traitSelect, availabilitySelect, partFilterReset, quickRows, catalogList, cameraToolbar, cameraReset, previewStage,
        vehiclePreviousButton, vehicleNextButton,
        previewOverlay, pairToggle, favoriteBtn, compareSelect, slotGrid, undoButton, redoButton,
        revertButton, defaultButton, presetName, presetSelect, presetSave, presetSaveAs, presetLoad,
        presetRename, presetDuplicate, presetDelete, presetSort, presetTags, presetFavorite,
        presetExport, presetImport, buildCompareSelect, starterBuilds, machineGunSelect, activateButton, statusMessage,
        buildViewSwitch,
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
        if (hangarMode === 'fight') {
            return {
                vehicleId: id,
                level: 30,
                xp: 0,
                xpBank: 0,
                masteryMilestones: [],
                fightUnlimitedInventory: true,
            };
        }
        profiles[id] = profilePort.getOrCreate(profiles, id);
        return profiles[id];
    }

    function syncVehicleWriteback(vehicleId) {
        const id = norm(vehicleId, 'ship5').toLowerCase();
        persistHangarVehicleSelection({ settings, runtimeAccess, vehicleId: id, mode: hangarMode });
        const hasOption = Array.from(ui.vehicleSelectP1?.options || []).some((option) => option.value === id);
        if (hasOption && ui.vehicleSelectP1.value !== id) {
            ui.vehicleSelectP1.value = id;
            ui.vehicleSelectP1.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return id;
    }

    function initialBuild(vehicleId) {
        const build = persistence.getActiveBuild(vehicleId)
            || persistence.listBuilds(vehicleId)[0]
            || buildFromProfile(vehicleId, entryFor(vehicleId), profileFor(vehicleId));
        return normalizeHangarBuild({ ...build, mode: hangarMode });
    }

    function validateForMode(build, level = 1, profile = null) {
        return hangarMode === 'fight'
            ? validateFightHangarBuild(build)
            : validateHangarBuild(build, level, profile);
    }

    function isDirty() {
        return !!draft && !!baselineBuild && !areHangarBuildsEqual(draft, baselineBuild);
    }

    function state() {
        return {
            draft, savedBuild, baselineBuild, history, hydrated, profiles, catalogView, buildView, partFamily, partTier,
            partTrait, partAvailability, selectedSlotId, selectedPartId, previewPartId, buildFromProfile,
            xpToNextLevel: profilePort.xpToNextLevel,
            xpForLevel: profilePort.xpForLevel,
            getSpendableUpgradeXp: profilePort.getSpendableUpgradeXp,
        };
    }

    function syncDisplay(options = {}) {
        if (disposed) return;
        renderer?.sync(options);
        const dirty = isDirty();
        if (dirty !== lastReportedDirty) {
            lastReportedDirty = dirty;
            ctx.onDirtyChange?.(dirty);
        }
    }

    function flushDraft() {
        if (draftSaveTimer) {
            window.clearTimeout(draftSaveTimer);
            draftSaveTimer = 0;
        }
        if (!draft) return false;
        if (isDirty()) return draftPersistence.save(draft) !== false;
        draftPersistence.clear(draft.vehicleId);
        return true;
    }

    function setDraft(nextBuild, options = {}) {
        draft = normalizeHangarBuild(nextBuild);
        if (!history || options.resetHistory) history = new HangarBuildHistory(draft);
        else if (options.recordHistory !== false) history.push(draft);
        if (options.saved) {
            savedBuild = normalizeHangarBuild(draft);
            baselineBuild = normalizeHangarBuild(draft);
        }
        if (persistDraftChanges && options.persist !== false) {
            if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
            draftSaveTimer = window.setTimeout(() => {
                draftSaveTimer = 0;
                if (!isDirty()) draftPersistence.clear(draft.vehicleId);
                else draftPersistence.save(draft);
            }, 180);
        }
        syncDisplay(options);
    }

    function selectVehicle(vehicleId, options = {}) {
        if (draft && norm(vehicleId, 'ship5').toLowerCase() !== draft.vehicleId) flushDraft();
        const id = syncVehicleWriteback(vehicleId);
        selection.setSelectedVehicleId(id, options);
        selectedPartId = '';
        previewPartId = '';
        savedBuild = persistence.getActiveBuild(id) || persistence.listBuilds(id)[0] || null;
        baselineBuild = savedBuild || initialBuild(id);
        setDraft(draftPersistence.load(id) || baselineBuild, { resetHistory: true, recordHistory: false, persist: false });
    }

    function installWithPair(build, partId, slotId) {
        const part = resolveHangarPart(partId);
        return installHangarPart(build, partId, slotId, { pair: pairToggle.checked && part?.symmetric === true });
    }

    function evaluateInstall(partId, slotId) {
        const profile = profileFor(draft.vehicleId);
        return hangarMode === 'fight'
            ? validateFightHangarDrop(draft, partId, slotId, installWithPair)
            : validateHangarDrop(draft, partId, slotId, profile.level, installWithPair, profile);
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
        toast(`${resolveHangarPart(partId)?.label || partId} eingesetzt`, 'success');
        return true;
    }

    function evaluateRemoval(slotId) {
        const removal = removeHangarPart(draft, slotId, { pair: pairToggle.checked });
        if (!removal.ok) return removal;
        const profile = profileFor(draft.vehicleId);
        const validation = validateForMode(removal.build, profile.level, profile);
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
        toast('Stein entfernt');
        return true;
    }

    function quickUpgrade(slotId) {
        const part = resolveHangarPart(draft.slots[slotId]);
        if (part?.upgradeTo) applyInstall(part.upgradeTo, slotId);
    }

    function selectPart(partId) {
        const part = resolveHangarPart(partId);
        if (!part) return;
        buildView = 'workshop';
        selectedPartId = selectedPartId === part.id ? '' : part.id;
        previewPartId = selectedPartId;
        if (selectedPartId && !part.compatibleSlots.includes(selectedSlotId)) selectedSlotId = part.compatibleSlots[0];
        toast(selectedPartId ? `${part.label} ausgewählt · jetzt Fassung anklicken` : 'Steinauswahl aufgehoben');
        syncDisplay();
    }

    function selectMachineGun(machineGunId) {
        if (hangarMode !== 'fight') return;
        const id = normalizeFightMachineGunId(machineGunId);
        if (draft.machineGunId === id) return;
        setDraft({ ...draft, machineGunId: id, updatedAtMs: Math.max(draft.updatedAtMs + 1, Date.now()) });
        toast(`${resolveFightMachineGunModel(id).label} ausgewählt`, 'success');
    }

    function handleSlotSelection(slotId) {
        buildView = 'workshop';
        if (selectedPartId) {
            applyInstall(selectedPartId, slotId);
            return;
        }
        selectedSlotId = slotId;
        viewport.setSelectedSlot(slotId);
        syncDisplay();
    }

    function applyStarterBuild(presetId) {
        const profile = profileFor(draft.vehicleId);
        const level = profile.level;
        const starter = createHangarStarterBuild(draft, presetId, level);
        if (!starter) return;
        const validation = validateForMode(starter, level, profile);
        if (!validation.ok) {
            toast(`Starter-Build ist noch gesperrt: ${validation.errors[0]?.message || ''}`, 'warning');
            return;
        }
        selectedPartId = '';
        previewPartId = '';
        setDraft(starter, { changedSlots: Object.keys(starter.slots) });
        toast(`${starter.name} geladen`, 'success');
    }

    function purchaseStone(stoneId) {
        if (hangarMode === 'fight') {
            toast('Fight-Bauteile sind frei verfügbar und werden über Nachteile ausbalanciert.', 'info');
            return false;
        }
        const vehicleId = draft.vehicleId;
        const result = purchaseHangarStone(profileFor(vehicleId), stoneId);
        if (!result.ok) {
            const message = result.code === 'insufficient_xrp'
                ? `Nicht genug XRP · benötigt ${result.priceXrp}`
                : (result.code === 'level_locked' ? `Kauf ab Level ${result.requiredLevel}` : 'Stein kann nicht gekauft werden');
            toast(message, 'warning');
            return false;
        }
        profiles[vehicleId] = result.profile;
        profilePort.save(profiles);
        audio.play('pickup');
        toast(`${result.stone.label} gekauft · ${result.remainingXrp} XRP übrig`, 'success');
        syncDisplay();
        return true;
    }

    function commitProfileForRun(build) {
        if (hangarMode === 'fight') {
            const validation = validateFightHangarBuild(build);
            if (!validation.ok) return false;
            const latestSettings = runtimeAccess?.loadSettings?.() || settings;
            if (!latestSettings.localSettings || typeof latestSettings.localSettings !== 'object') latestSettings.localSettings = {};
            const local = latestSettings.localSettings;
            if (!local.fightHangar || typeof local.fightHangar !== 'object') local.fightHangar = {};
            if (!local.fightHangar.activeBonusesByVehicle || typeof local.fightHangar.activeBonusesByVehicle !== 'object') {
                local.fightHangar.activeBonusesByVehicle = {};
            }
            local.fightHangar.activeBonusesByVehicle[build.vehicleId] = {
                ...validation.bonuses,
                machineGunId: normalizeFightMachineGunId(build.machineGunId),
            };
            runtimeAccess?.saveSettings?.(latestSettings);
            if (latestSettings !== settings) Object.assign(settings, latestSettings);
            return true;
        }
        const profile = profileFor(build.vehicleId);
        profiles[build.vehicleId] = {
            ...profile,
            upgrades: hangarBuildToProfileUpgrades(build),
            hangarBonuses: hangarBuildToProfileBonuses(build),
            updatedAt: new Date().toISOString(),
        };
        profilePort.save(profiles);
        return true;
    }

    async function saveCurrent(options = {}) {
        const profile = profileFor(draft.vehicleId);
        const validation = validateForMode(draft, profile.level, profile);
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
        baselineBuild = normalizeHangarBuild(result.build);
        history = new HangarBuildHistory(draft);
        presetName.value = '';
        if (options.activate) commitProfileForRun(draft);
        draftPersistence.clear(draft.vehicleId);
        toast(options.activate ? 'Build gespeichert und für den nächsten Run aktiviert.' : `Build gespeichert: ${draft.name}`, 'success');
        syncDisplay();
        return result;
    }

    function prepareRunStart() {
        const profile = profileFor(draft.vehicleId);
        const validation = validateForMode(draft, profile.level, profile);
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
            baselineBuild = normalizeHangarBuild(result.build);
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
        mode: hangarMode,
        validateBuild: validateForMode,
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
    bind(viewSwitch, 'keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const tabs = Array.from(viewSwitch.querySelectorAll('[data-catalog-view]'));
        const currentIndex = tabs.findIndex((node) => node === event.target);
        if (currentIndex < 0) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(currentIndex + step + tabs.length) % tabs.length];
        catalogView = next.dataset.catalogView === 'parts' ? 'parts' : 'vehicles';
        if (catalogView === 'vehicles') { selectedPartId = ''; previewPartId = ''; }
        search.value = catalogView === 'vehicles' ? selection.getSearchTerm() : '';
        syncDisplay();
        next.focus();
    });
    bind(buildViewSwitch, 'click', (event) => {
        const view = event.target?.closest?.('[data-build-view]')?.dataset.buildView;
        if (!['workshop', 'stats', 'presets'].includes(view)) return;
        buildView = view;
        syncDisplay({ preserveCatalog: true });
    });
    bind(buildViewSwitch, 'keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const tabs = Array.from(buildViewSwitch.querySelectorAll('[data-build-view]'));
        const currentIndex = tabs.findIndex((node) => node === event.target);
        if (currentIndex < 0) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(currentIndex + step + tabs.length) % tabs.length];
        buildView = next.dataset.buildView;
        syncDisplay({ preserveCatalog: true });
        next.focus();
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
    bind(partFilterReset, 'click', () => {
        partFamily = 'all';
        partTier = 'ALL';
        partTrait = 'all';
        partAvailability = 'all';
        search.value = '';
        familySelect.value = partFamily;
        tierSelect.value = partTier;
        traitSelect.value = partTrait;
        availabilitySelect.value = partAvailability;
        syncDisplay();
    });
    bind(catalogList, 'click', (event) => {
        const vehicleId = event.target?.closest?.('[data-vehicle-id]')?.dataset.vehicleId;
        if (vehicleId) { selectVehicle(vehicleId); return; }
        const purchaseButton = event.target?.closest?.('[data-purchase-stone-id]');
        if (purchaseButton) {
            purchaseStone(purchaseButton.dataset.purchaseStoneId);
            return;
        }
        const card = event.target?.closest?.('[data-part-id]');
        if (!card) return;
        if (card.dataset.hangarSuppressClick === 'true') return;
        if (card.dataset.locked === 'true') {
            toast(card.dataset.lockedReason || 'Dieser Stein ist noch gesperrt.', 'warning');
            return;
        }
        if (card.querySelector('[data-purchase-stone-id]')) {
            buildView = 'workshop';
            selectedPartId = '';
            previewPartId = card.dataset.partId;
            toast(`${card.dataset.partLabel} als Vorschau geöffnet · Kauf separat bestätigen`);
            syncDisplay({ preserveCatalog: true });
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
    bind(catalogList, 'keydown', (event) => {
        const card = event.target?.closest?.('[data-vehicle-id]');
        if (!card || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const id = selection.getNextVisibleVehicleId(event.key === 'ArrowDown' ? 1 : -1, profiles);
        selectVehicle(id);
        const nextCard = Array.from(catalogList.querySelectorAll('[data-vehicle-id]'))
            .find((node) => node.dataset.vehicleId === id);
        nextCard?.focus();
    });
    bind(catalogList, 'pointerdown', (event) => {
        const selectButton = event.target?.closest?.('[data-part-select]');
        const card = selectButton?.closest?.('[data-part-id]');
        if (card && card.dataset.locked !== 'true' && !card.querySelector('[data-purchase-stone-id]')) {
            dragController.begin(event, { partId: card.dataset.partId, label: card.dataset.partLabel }, card);
        }
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
    bind(machineGunSelect, 'change', () => selectMachineGun(machineGunSelect.value));
    bind(vehiclePreviousButton, 'click', () => selectVehicle(selection.getNextVisibleVehicleId(-1, profiles))); bind(vehicleNextButton, 'click', () => selectVehicle(selection.getNextVisibleVehicleId(1, profiles)));
    bind(cameraToolbar, 'click', (event) => { const preset = event.target?.closest?.('[data-camera-preset]')?.dataset.cameraPreset; if (preset) viewport.setCameraPreset(preset); });
    bind(cameraReset, 'click', () => viewport.resetCamera());
    bind(undoButton, 'click', () => { const value = history.undo(); if (value) setDraft(value, { recordHistory: false }); });
    bind(redoButton, 'click', () => { const value = history.redo(); if (value) setDraft(value, { recordHistory: false }); });
    bind(revertButton, 'click', () => { if (baselineBuild) setDraft(baselineBuild, { resetHistory: true, recordHistory: false }); });
    bind(defaultButton, 'click', () => {
        selectedPartId = '';
        previewPartId = '';
        setDraft(createDefaultHangarBuild(draft.vehicleId, { mode: hangarMode, hitboxClass: mapHangarHitboxClass(entryFor(draft.vehicleId)) }), { resetHistory: true });
    });
    bind(presetSave, 'click', () => { void saveCurrent(); });
    bind(presetSaveAs, 'click', () => { void saveCurrent({ asNew: true }); });
    bind(presetSelect, 'change', () => syncDisplay());
    bind(presetLoad, 'click', () => {
        const value = persistence.getBuild(presetSelect.value);
        if (!value) return;
        const profile = profileFor(value.vehicleId);
        const validation = validateForMode(value, profile.level, profile);
        savedBuild = value;
        baselineBuild = value;
        setDraft(value, { resetHistory: true, recordHistory: false, persist: false });
        if (!validation.ok) toast(`Preset ist mit dem aktuellen Fortschritt ungültig: ${validation.errors[0]?.message}`, 'warning');
    });
    bind(presetRename, 'click', async () => {
        const name = norm(presetName.value);
        if (!name) return;
        const wasDirty = isDirty();
        const result = await persistence.renameBuild(presetSelect.value, name);
        if (result.ok && savedBuild?.buildId === result.build.buildId) {
            savedBuild = result.build;
            baselineBuild = result.build;
            if (!wasDirty) {
                draft = normalizeHangarBuild(result.build);
                history = new HangarBuildHistory(draft);
            }
        }
        presetName.value = '';
        syncDisplay();
    });
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
    bind(presetDelete, 'click', async () => {
        if (!presetSelect.value || (window.confirm && !window.confirm('Diesen Build wirklich löschen?'))) return;
        const id = presetSelect.value;
        const result = await persistence.deleteBuild(id);
        if (result.ok && savedBuild?.buildId === id) {
            savedBuild = null;
            baselineBuild = buildFromProfile(draft.vehicleId, entryFor(draft.vehicleId), profileFor(draft.vehicleId));
        }
        syncDisplay();
    });
    bind(activateButton, 'click', () => { void saveCurrent({ activate: true }); });
    bind(container, 'keydown', (event) => {
        const editing = ['input', 'select', 'textarea'].includes(String(event.target?.tagName || '').toLowerCase());
        const shortcutSurface = event.target === container || previewStage.contains(event.target) || slotGrid.contains(event.target);
        if (event.key === 'Escape' && selectedPartId && !editing) { event.preventDefault(); selectedPartId = ''; previewPartId = ''; toast('Teileauswahl aufgehoben'); syncDisplay(); }
        else if (event.key === 'Delete' && !editing && shortcutSurface) { event.preventDefault(); applyRemoval(selectedSlotId); }
        else if (event.ctrlKey && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); const value = history.undo(); if (value) setDraft(value, { recordHistory: false }); }
        else if (event.ctrlKey && event.key.toLowerCase() === 'y' && !editing) { event.preventDefault(); const value = history.redo(); if (value) setDraft(value, { recordHistory: false }); }
        else if (!editing && ['ArrowLeft', 'ArrowRight'].includes(event.key)
            && (event.target === container || previewStage.contains(event.target))) {
            event.preventDefault();
            selectVehicle(selection.getNextVisibleVehicleId(event.key === 'ArrowRight' ? 1 : -1, profiles));
        }
    });
    if (ui.vehicleSelectP1) bind(ui.vehicleSelectP1, 'change', () => { const id = norm(ui.vehicleSelectP1.value).toLowerCase(); if (id && draft && id !== draft.vehicleId) selectVehicle(id, { skipRecent: true }); });

    const initialVehicleId = syncVehicleWriteback(selection.getSelectedVehicleId());
    const recoveredDraft = draftPersistence.load(initialVehicleId);
    savedBuild = persistence.getActiveBuild(initialVehicleId) || persistence.listBuilds(initialVehicleId)[0] || null;
    baselineBuild = savedBuild || initialBuild(initialVehicleId);
    draft = recoveredDraft || baselineBuild;
    history = new HangarBuildHistory(draft);
    persistDraftChanges = true;
    toast(recoveredDraft ? 'Ungespeicherten Entwurf wiederhergestellt.' : 'Gespeicherte Builds werden geladen …', recoveredDraft ? 'success' : 'info');
    syncDisplay();
    void persistence.hydrate().then((result) => {
        if (disposed) return;
        hydrated = true;
        const loaded = persistence.getActiveBuild(draft.vehicleId) || persistence.listBuilds(draft.vehicleId)[0];
        if (recoveredDraft) {
            savedBuild = loaded || null;
            baselineBuild = loaded || baselineBuild;
        }
        else if (!isDirty()) {
            if (loaded) {
                savedBuild = loaded;
                baselineBuild = loaded;
                draft = loaded;
                history = new HangarBuildHistory(draft);
            }
        }
        toast(result.ok ? 'Hangar bereit' : 'Gespeicherte Builds konnten nicht geladen werden.', result.ok ? 'success' : 'warning');
        syncDisplay();
    });

    return Object.freeze({
        container,
        syncDisplay,
        getSelectedVehicleId: () => draft.vehicleId,
        getDraftBuild: () => normalizeHangarBuild(draft),
        getActiveBuild: () => persistence.getActiveBuild(draft.vehicleId),
        hasUnsavedChanges: isDirty,
        flushDraft,
        prepareRunStart,
        dispose() {
            if (disposed) return;
            flushDraft();
            disposed = true;
            dragController.dispose();
            viewport.dispose();
            audio.dispose();
            container.dataset.lifecycle = 'disposed';
        },
    });
}
