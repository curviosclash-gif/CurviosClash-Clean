import { saveBlobAsUserFile } from '../../platform/browser/BrowserFileExport.js';
import { normalizeVehicleValue as norm } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { HangarBuildHistory, createDefaultHangarBuild, normalizeHangarBuild } from './HangarBuildDraftState.js';
import { createHangarBuildFromProfile as buildFromProfile, mapHangarHitboxClass } from './HangarWorkshopProfileSupport.js';
import { armConfirmButton } from '../ConfirmButtonArming.js';

/**
 * Event wiring of the build side of the hangar workshop: slot grid, pair toggle, starter builds,
 * favourite and compare, machine gun and cosmetic styles, vehicle buttons, camera, undo/redo,
 * the preset buttons, the keyboard shortcuts and the vehicle select of the host menu.
 *
 * Call it after the shell, the renderer and the drag controller exist. The handlers reach the
 * other modules through `api`, which the controller fills before anything runs.
 *
 * @returns {{ presetDeleteConfirmation: { disarm: Function, dispose: Function } }}
 */
export function bindWorkshopBuildEvents(st, api) {
    const { bind, ui, hangarMode, selection, persistence, dragController, viewport } = st;
    const {
        container, previewStage, cameraToolbar, cameraReset, vehiclePreviousButton, vehicleNextButton,
        pairToggle, favoriteBtn, compareSelect, slotGrid, undoButton, redoButton,
        revertButton, defaultButton, presetName, presetSelect, presetSave, presetSaveAs, presetLoad,
        presetRename, presetDuplicate, presetDelete, presetSort, presetTags, presetFavorite,
        presetExport, presetImport, buildCompareSelect, starterBuilds, machineGunSelect, activateButton,
        trailStyleSelect, weaponStyleSelects,
    } = st.shell;

    function undoDraft() {
        const value = st.history.undo();
        if (value) api.setDraft(value, { recordHistory: false });
    }

    function redoDraft() {
        const value = st.history.redo();
        if (value) api.setDraft(value, { recordHistory: false });
    }

    function exportSelectedPreset() {
        const selected = persistence.getBuild(presetSelect.value);
        if (!selected) return;
        const blob = new Blob([JSON.stringify({ schemaVersion: persistence.version, builds: [selected] }, null, 2)], { type: 'application/json' });
        void saveBlobAsUserFile({ blob, fileName: `${selected.name.replace(/[^a-z0-9_-]+/gi, '-')}.hangar.json` });
    }

    function importPresetFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const result = await persistence.importBuilds(JSON.parse(await file.text()));
                api.toast(`${result.builds.length} Build(s) importiert`, result.ok ? 'success' : 'warning');
                api.syncDisplay();
            } catch {
                api.toast('Build-Import ist ungültig.', 'warning');
            }
        };
        input.click();
    }

    function loadSelectedPreset() {
        const value = persistence.getBuild(presetSelect.value);
        if (!value) return;
        const profile = api.profileFor(value.vehicleId);
        const validation = api.validateForMode(value, profile.level, profile);
        st.savedBuild = value;
        st.baselineBuild = value;
        api.setDraft(value, { resetHistory: true, recordHistory: false, persist: false });
        if (!validation.ok) api.toast(`Preset ist mit dem aktuellen Fortschritt ungültig: ${validation.errors[0]?.message}`, 'warning');
    }

    async function renameSelectedPreset() {
        const name = norm(presetName.value);
        if (!name) return;
        const wasDirty = api.isDirty();
        const result = await persistence.renameBuild(presetSelect.value, name);
        if (result.ok && st.savedBuild?.buildId === result.build.buildId) {
            st.savedBuild = result.build;
            st.baselineBuild = api.withActive(result.build); // renaming changes the name, never the stones that fly
            if (!wasDirty) {
                st.draft = normalizeHangarBuild(st.baselineBuild);
                st.history = new HangarBuildHistory(st.draft);
            }
        }
        presetName.value = '';
        api.syncDisplay();
    }

    async function duplicateSelectedPreset() {
        const value = persistence.getBuild(presetSelect.value);
        if (value) await persistence.duplicateBuild(value, norm(presetName.value, `${value.name} Kopie`));
        presetName.value = '';
        api.syncDisplay();
    }

    function handleContainerKeydown(event) {
        const editing = ['input', 'select', 'textarea'].includes(String(event.target?.tagName || '').toLowerCase());
        const shortcutSurface = event.target === container || previewStage.contains(event.target) || slotGrid.contains(event.target);
        if (event.key === 'Escape' && st.selectedPartId && !editing) {
            event.preventDefault();
            st.selectedPartId = '';
            st.previewPartId = '';
            api.toast('Teileauswahl aufgehoben');
            api.syncDisplay();
        } else if (event.key === 'Delete' && !editing && shortcutSurface) {
            event.preventDefault();
            api.applyRemoval(st.selectedSlotId);
        } else if (event.ctrlKey && event.key.toLowerCase() === 'z' && !editing) {
            event.preventDefault();
            undoDraft();
        } else if (event.ctrlKey && event.key.toLowerCase() === 'y' && !editing) {
            event.preventDefault();
            redoDraft();
        } else if (!editing && ['ArrowLeft', 'ArrowRight'].includes(event.key)
            && (event.target === container || previewStage.contains(event.target))) {
            event.preventDefault();
            api.selectVehicle(selection.getNextVisibleVehicleId(event.key === 'ArrowRight' ? 1 : -1, st.profiles));
        }
    }

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
        if (selected) api.handleSlotSelection(selected);
        else if (upgrade) api.quickUpgrade(upgrade);
        else if (remove) api.applyRemoval(remove);
    });
    bind(pairToggle, 'change', () => api.syncDisplay({ preserveCatalog: true }));
    bind(starterBuilds, 'click', (event) => {
        const presetId = event.target?.closest?.('[data-starter-build]')?.dataset.starterBuild;
        if (presetId) api.applyStarterBuild(presetId);
    });
    bind(favoriteBtn, 'click', () => {
        selection.toggleFavorite(st.draft.vehicleId);
        api.syncDisplay();
    });
    bind(compareSelect, 'change', () => {
        selection.setCompareVehicleId(compareSelect.value);
        api.syncDisplay();
    });
    bind(buildCompareSelect, 'change', () => api.syncDisplay());
    bind(machineGunSelect, 'change', () => api.selectMachineGun(machineGunSelect.value));
    bind(trailStyleSelect, 'change', () => api.selectTrailStyle(trailStyleSelect.value));
    Object.entries(weaponStyleSelects || {}).forEach(([familyId, select]) => {
        bind(select, 'change', () => api.selectWeaponStyle(familyId, select.value));
    });
    bind(vehiclePreviousButton, 'click', () => api.selectVehicle(selection.getNextVisibleVehicleId(-1, st.profiles)));
    bind(vehicleNextButton, 'click', () => api.selectVehicle(selection.getNextVisibleVehicleId(1, st.profiles)));
    bind(cameraToolbar, 'click', (event) => {
        const preset = event.target?.closest?.('[data-camera-preset]')?.dataset.cameraPreset;
        if (preset) viewport.setCameraPreset(preset);
    });
    bind(cameraReset, 'click', () => viewport.resetCamera());
    bind(undoButton, 'click', undoDraft);
    bind(redoButton, 'click', redoDraft);
    bind(revertButton, 'click', () => {
        if (st.baselineBuild) api.setDraft(st.baselineBuild, { resetHistory: true, recordHistory: false });
    });
    bind(defaultButton, 'click', () => {
        st.selectedPartId = '';
        st.previewPartId = '';
        api.setDraft(createDefaultHangarBuild(st.draft.vehicleId, { mode: hangarMode, hitboxClass: mapHangarHitboxClass(api.entryFor(st.draft.vehicleId)) }), { resetHistory: true });
    });
    bind(presetSave, 'click', () => {
        void api.saveCurrent();
    });
    bind(presetSaveAs, 'click', () => {
        void api.saveCurrent({ asNew: true });
    });
    bind(presetSelect, 'change', () => api.syncDisplay());
    bind(presetLoad, 'click', loadSelectedPreset);
    bind(presetRename, 'click', renameSelectedPreset);
    bind(presetDuplicate, 'click', duplicateSelectedPreset);
    bind(presetSort, 'change', () => api.syncDisplay());
    bind(presetFavorite, 'click', async () => {
        const value = persistence.getBuild(presetSelect.value);
        if (!value) return;
        await persistence.updateMetadata(value.buildId, { favorite: !value.favorite, tags: value.tags });
        api.syncDisplay();
    });
    bind(presetTags, 'change', async () => {
        const value = persistence.getBuild(presetSelect.value);
        if (!value) return;
        await persistence.updateMetadata(value.buildId, { favorite: value.favorite, tags: presetTags.value.split(',') });
        api.syncDisplay();
    });
    bind(presetExport, 'click', exportSelectedPreset);
    bind(presetImport, 'click', importPresetFile);
    const presetDeleteConfirmation = armConfirmButton(presetDelete, {
        label: presetDelete.textContent,
        onConfirm: async () => {
            if (!presetSelect.value) return;
            const id = presetSelect.value;
            const result = await persistence.deleteBuild(id);
            if (result.ok && st.savedBuild?.buildId === id) {
                st.savedBuild = null;
                st.baselineBuild = api.withActive(buildFromProfile(st.draft.vehicleId, api.entryFor(st.draft.vehicleId), api.profileFor(st.draft.vehicleId)));
            }
            api.syncDisplay();
        },
    });
    bind(presetSelect, 'change', presetDeleteConfirmation.disarm);
    bind(activateButton, 'click', () => {
        void api.saveCurrent({ activate: true });
    });
    bind(container, 'keydown', handleContainerKeydown);
    if (ui.vehicleSelectP1) {
        bind(ui.vehicleSelectP1, 'change', () => {
            const id = norm(ui.vehicleSelectP1.value).toLowerCase();
            if (id && st.draft && id !== st.draft.vehicleId) api.selectVehicle(id, { skipRecent: true });
        });
    }

    return { presetDeleteConfirmation };
}
