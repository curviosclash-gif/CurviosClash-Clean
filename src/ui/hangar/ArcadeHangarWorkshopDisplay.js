import { normalizeVehicleValue as norm } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { resolveVehicleManagerCatalogEntry } from '../arcade/VehicleManagerCatalog.js';
import { HangarBuildHistory, areHangarBuildsEqual, normalizeHangarBuild } from './HangarBuildDraftState.js';
import { createHangarBuildFromProfile as buildFromProfile } from './HangarWorkshopProfileSupport.js';
import { validateFightHangarBuild } from './FightHangarValidation.js';
import { loadArcadeColors } from '../../shared/contracts/ArcadeColorProgressContract.js';

/**
 * Draft, display and status of the hangar workshop: the toast line, the dirty check, the
 * view snapshot for the renderer, the redraw (`syncDisplay`), the draft autosave and the
 * switch to another vehicle.
 *
 * Call it after the shell exists. The functions reach the other modules through `api`, which
 * the controller fills before anything runs.
 */
export function createWorkshopDisplay(st, api) {
    const { hangarMode, ctx, emit, eventTypes, store, profilePort, byVehicleId, selection, persistence, draftPersistence } = st;
    const { statusMessage } = st.shell;

    function toast(message, tone = 'info') {
        statusMessage.textContent = String(message || '');
        statusMessage.dataset.tone = tone;
        if (emit && eventTypes.SHOW_STATUS_TOAST) emit(eventTypes.SHOW_STATUS_TOAST, { message, tone, duration: 1600 });
    }

    function entryFor(vehicleId) {
        return byVehicleId.get(String(vehicleId || '').toLowerCase()) || resolveVehicleManagerCatalogEntry(vehicleId);
    }

    // Saved build + the stones that fly.
    function withActive(build) {
        return st.stonePanel?.withActivePlacement(build) || build;
    }

    function initialBuild(vehicleId) {
        const build = persistence.getActiveBuild(vehicleId)
            || persistence.listBuilds(vehicleId)[0]
            || buildFromProfile(vehicleId, entryFor(vehicleId), api.profileFor(vehicleId));
        return normalizeHangarBuild({ ...build, mode: hangarMode });
    }

    function validateForMode(build, level = 1, profile = null) {
        return hangarMode === 'fight'
            ? validateFightHangarBuild(build)
            : st.stonePanel.validate(build, level, profile);
    }

    function isDirty() {
        return !!st.draft && !!st.baselineBuild && !areHangarBuildsEqual(st.draft, st.baselineBuild);
    }

    function getViewState() {
        return {
            draft: st.draft,
            savedBuild: st.savedBuild,
            baselineBuild: st.baselineBuild,
            history: st.history,
            hydrated: st.hydrated,
            profiles: st.profiles,
            catalogView: st.catalogView,
            buildView: st.buildView,
            partFamily: st.partFamily,
            partTier: st.partTier,
            colorRecord: loadArcadeColors(store),
            partTrait: st.partTrait,
            partAvailability: st.partAvailability,
            selectedSlotId: st.selectedSlotId,
            selectedPartId: st.selectedPartId,
            previewPartId: st.previewPartId,
            buildFromProfile,
            xpToNextLevel: profilePort.xpToNextLevel,
            xpForLevel: profilePort.xpForLevel,
            getSpendableUpgradeXp: profilePort.getSpendableUpgradeXp,
        };
    }

    function syncPartStyle() {
        st.formTab.sync(st.draft.vehicleId, st.buildView);
        st.weaponPanel?.render(st.draft.vehicleId, api.getProfile());
        st.guide?.render();
    }

    function syncDisplay(options = {}) {
        if (st.disposed) return;
        st.renderer?.sync(options);
        if (st.draft) syncPartStyle();
        const dirty = isDirty();
        if (dirty !== st.lastReportedDirty) {
            st.lastReportedDirty = dirty;
            ctx.onDirtyChange?.(dirty);
        }
    }

    function flushDraft() {
        if (st.draftSaveTimer) {
            window.clearTimeout(st.draftSaveTimer);
            st.draftSaveTimer = 0;
        }
        if (!st.draft) return false;
        if (isDirty()) return draftPersistence.save(st.draft) !== false;
        draftPersistence.clear(st.draft.vehicleId);
        return true;
    }

    function scheduleDraftSave() {
        if (st.draftSaveTimer) window.clearTimeout(st.draftSaveTimer);
        st.draftSaveTimer = window.setTimeout(() => {
            st.draftSaveTimer = 0;
            if (!isDirty()) draftPersistence.clear(st.draft.vehicleId);
            else draftPersistence.save(st.draft);
        }, 180);
    }

    function setDraft(nextBuild, options = {}) {
        st.draft = normalizeHangarBuild(nextBuild);
        if (!st.history || options.resetHistory) st.history = new HangarBuildHistory(st.draft);
        else if (options.recordHistory !== false) st.history.push(st.draft);
        if (options.saved) {
            st.savedBuild = normalizeHangarBuild(st.draft);
            st.baselineBuild = normalizeHangarBuild(st.draft);
        }
        if (st.persistDraftChanges && options.persist !== false) scheduleDraftSave();
        syncDisplay(options);
    }

    function selectVehicle(vehicleId, options = {}) {
        const requestedId = norm(vehicleId, 'ship5').toLowerCase();
        if (hangarMode === 'arcade' && !byVehicleId.has(requestedId)) return; // Arcade: factory ships only
        if (st.draft && requestedId !== st.draft.vehicleId) flushDraft();
        const id = api.syncVehicleWriteback(vehicleId);
        selection.setSelectedVehicleId(id, options);
        st.selectedPartId = '';
        st.previewPartId = '';
        st.savedBuild = persistence.getActiveBuild(id) || persistence.listBuilds(id)[0] || null;
        st.baselineBuild = withActive(st.savedBuild || initialBuild(id));
        setDraft(draftPersistence.load(id) || st.baselineBuild, { resetHistory: true, recordHistory: false, persist: false });
    }

    return {
        toast,
        entryFor,
        withActive,
        initialBuild,
        validateForMode,
        isDirty,
        getViewState,
        syncPartStyle,
        syncDisplay,
        flushDraft,
        setDraft,
        selectVehicle,
    };
}
