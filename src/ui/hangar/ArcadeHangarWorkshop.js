import { isArcadeTestFlightBuildActive } from '../../shared/contracts/ArcadeTestFlightContract.js';
import {
    normalizeVehicleValue as norm,
    resolvePlayerColor,
} from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { renderHangarVehicleFilterChips } from './HangarVehicleFilterChips.js';
import { HangarBuildHistory, normalizeHangarBuild } from './HangarBuildDraftState.js';
import { describeHangarDropFailure as describeDropFailure } from './HangarBuildValidation.js';
import { createHangarViewport3d } from './HangarViewport3d.js';
import { createHangarDragDropController } from './HangarDragDropController.js';
import { createArcadeHangarWorkshopShell } from './ArcadeHangarWorkshopShell.js';
import { createArcadeHangarWorkshopRenderer } from './ArcadeHangarWorkshopRenderer.js';
import { createVehicleCatalogPreview3d } from '../arcade/vehicle-manager/VehicleCatalogPreview3d.js';
import { createArcadeStonePanel } from './ArcadeStonePanel.js';
import { createArcadeWeaponPanel } from './ArcadeWeaponPanel.js';
import { createHangarFormTab } from './HangarFormTab.js';
import { loadArcadeColors } from '../../shared/contracts/ArcadeColorProgressContract.js';
import { createHangarGuideCard } from './HangarGuideCard.js';
import { createWorkshopState } from './ArcadeHangarWorkshopState.js';
import { createWorkshopDisplay } from './ArcadeHangarWorkshopDisplay.js';
import { createWorkshopProfileActions } from './ArcadeHangarWorkshopProfile.js';
import { createWorkshopBuildActions } from './ArcadeHangarWorkshopBuildActions.js';
import { createWorkshopSaveActions } from './ArcadeHangarWorkshopSave.js';
import { bindWorkshopCatalogEvents } from './ArcadeHangarWorkshopCatalogEvents.js';
import { bindWorkshopBuildEvents } from './ArcadeHangarWorkshopBuildEvents.js';

/**
 * Controller of the hangar workshop window. It builds the DOM shell and the panels, then hands
 * the work to the parts below, which all share one state object (`st`) and reach each other's
 * functions through one table (`api`):
 *   ArcadeHangarWorkshopState        the shared state
 *   ArcadeHangarWorkshopDisplay      draft, redraw, toast, vehicle switch
 *   ArcadeHangarWorkshopProfile      arcade profile, cosmetic styles, commit for the run
 *   ArcadeHangarWorkshopBuildActions install, remove, select, starter builds
 *   ArcadeHangarWorkshopSave         save, activate, run start
 *   ArcadeHangarWorkshopCatalogEvents / ArcadeHangarWorkshopBuildEvents   event wiring
 */
export function setupArcadeHangarWorkshop(ctx = {}) {
    const st = createWorkshopState(ctx);
    if (!st) return null;
    const { hangarMode, settings, store, bind, rules, catalogEntries, selection, persistence, draftPersistence, audio } = st;

    const shell = createArcadeHangarWorkshopShell(rules, { mode: hangarMode });
    st.shell = shell;
    shell.search.value = selection.getSearchTerm();
    st.viewport = createHangarViewport3d({ mount: shell.previewStage, overlay: shell.previewOverlay, color: resolvePlayerColor(settings) });
    st.catalogPreview = createVehicleCatalogPreview3d({ color: resolvePlayerColor(settings) });

    // The parts reach each other only through this table, which is complete before the first call.
    const api = {};
    Object.assign(
        api,
        createWorkshopDisplay(st, api),
        createWorkshopProfileActions(st, api),
        createWorkshopBuildActions(st, api),
        createWorkshopSaveActions(st, api),
    );

    api.bindProfileStorageSync();

    st.guide = hangarMode === 'arcade' ? createHangarGuideCard({ shell, bind, store, getState: api.getViewState, getProfile: api.getProfile }) : null;
    // Arcade: stones of the workshop pool (Paket 3) with their slots, docked in "Ausbau" beside the size build.
    st.stonePanel = hangarMode === 'arcade' ? createArcadeStonePanel({
        bind,
        toast: api.toast,
        store,
        shell,
        getProfile: api.getProfile,
        saveProfile: api.saveProfile,
        profileFor: api.profileFor,
        getDraft: () => st.draft,
        vehicleLabel: (id) => api.entryFor(id).label,
        onSelectStone: api.selectPart,
        onChange: () => api.syncDisplay({ preserveCatalog: true }),
    }) : null;
    st.weaponPanel = hangarMode === 'arcade' ? createArcadeWeaponPanel({
        bind,
        toast: api.toast,
        getProfile: api.getProfile,
        saveProfile: api.saveProfile,
        getPool: st.stonePanel?.getPool,
    }) : null;
    // Tabs "Form" (colours) and, arcade only, "Ausbau" (size build and stones), stored per vehicle in the arcade profile.
    st.formTab = createHangarFormTab({
        bind,
        toast: api.toast,
        viewport: st.viewport,
        enabled: hangarMode === 'arcade',
        panel: shell.formViewPanel,
        tabButton: shell.formViewButton,
        getProfile: api.getProfile,
        saveProfile: api.saveProfile,
        getColors: () => loadArcadeColors(store),
        upgradePanel: shell.upgradeViewPanel,
        upgradeTabButton: shell.upgradeViewButton,
        upgradeSections: st.stonePanel ? [st.stonePanel.root, st.weaponPanel.root] : [],
        getPool: st.stonePanel?.getPool,
        onChange: () => api.syncDisplay({ preserveCatalog: true }),
    });

    st.renderer = createArcadeHangarWorkshopRenderer({
        shell,
        settings,
        catalogEntries,
        selection,
        persistence,
        viewport: st.viewport,
        catalogPreview: st.catalogPreview,
        getState: api.getViewState,
        entryFor: api.entryFor,
        profileFor: api.profileFor,
        evaluateInstall: api.evaluateInstall,
        describeFailure: describeDropFailure,
        onQuickUpgrade: api.quickUpgrade,
        onSelectSlot: api.handleSlotSelection,
        isDirty: api.isDirty,
        mode: hangarMode,
        validateBuild: api.validateForMode,
        arcadeView: st.stonePanel?.arcadeView,
    });

    st.dragController = createHangarDragDropController({
        viewport: st.viewport,
        onStart(payload) {
            audio.play('pickup');
            api.syncDisplay({ dragPartId: payload.partId, preserveCatalog: true });
            api.toast(`${payload.label} aufgenommen · Esc zum Abbrechen`);
        },
        evaluateTarget(payload, target) {
            return target.type === 'remove' ? api.evaluateRemoval(payload.sourceSlotId) : api.evaluateInstall(payload.partId, target.slotId);
        },
        onDrop(payload, target) {
            if (target.type === 'remove') api.applyRemoval(payload.sourceSlotId);
            else api.applyInstall(payload.partId, target.slotId);
        },
        onReject(result) {
            audio.play('reject');
            api.toast(describeDropFailure(result), 'warning');
            api.syncDisplay();
        },
        onCancel(reason) {
            if (reason === 'escape') api.toast('Drag abgebrochen');
            api.syncDisplay();
        },
    });

    renderHangarVehicleFilterChips({ rules, mode: hangarMode, categoryTabs: shell.categoryTabs, hitboxChips: shell.hitboxChips, levelChips: shell.levelChips, catalogEntries, levelOf: (vehicleId) => api.profileFor(vehicleId).level });

    bindWorkshopCatalogEvents(st, api);
    const { presetDeleteConfirmation } = bindWorkshopBuildEvents(st, api);

    // A stored choice outside the Arcade catalog (a Classic Lab build) stays until the player picks a ship here.
    const initialVehicleId = hangarMode === 'arcade' && !st.byVehicleId.has(norm(settings.vehicles?.PLAYER_1).toLowerCase())
        ? selection.getSelectedVehicleId() : api.syncVehicleWriteback(selection.getSelectedVehicleId());
    const recoveredDraft = draftPersistence.load(initialVehicleId);
    st.savedBuild = persistence.getActiveBuild(initialVehicleId) || persistence.listBuilds(initialVehicleId)[0] || null;
    st.baselineBuild = api.withActive(st.savedBuild || api.initialBuild(initialVehicleId));
    st.draft = recoveredDraft || st.baselineBuild;
    st.history = new HangarBuildHistory(st.draft);
    st.persistDraftChanges = true;
    api.toast(recoveredDraft ? 'Ungespeicherten Entwurf wiederhergestellt.' : 'Gespeicherte Builds werden geladen …', recoveredDraft ? 'success' : 'info');
    api.syncDisplay();
    void persistence.hydrate().then((result) => {
        if (st.disposed) return;
        st.hydrated = true;
        const loaded = persistence.getActiveBuild(st.draft.vehicleId) || persistence.listBuilds(st.draft.vehicleId)[0];
        if (recoveredDraft) {
            st.savedBuild = loaded || null;
            st.baselineBuild = api.withActive(loaded) || st.baselineBuild;
        } else if (!api.isDirty() && loaded) {
            st.savedBuild = loaded;
            st.baselineBuild = api.withActive(loaded);
            st.draft = st.baselineBuild;
            st.history = new HangarBuildHistory(st.draft);
        }
        api.toast(result.ok ? 'Hangar bereit' : 'Gespeicherte Builds konnten nicht geladen werden.', result.ok ? 'success' : 'warning');
        api.syncDisplay();
    });

    return Object.freeze({
        container: shell.container,
        syncDisplay: api.syncDisplay,
        getSelectedVehicleId: () => st.draft.vehicleId,
        getDraftBuild: () => normalizeHangarBuild(st.draft),
        getActiveBuild: () => persistence.getActiveBuild(st.draft.vehicleId),
        hasUnsavedChanges: api.isDirty,
        hasInactiveDraft: () => !isArcadeTestFlightBuildActive(st.draft, api.withActive(persistence.getActiveBuild(st.draft.vehicleId) || api.initialBuild(st.draft.vehicleId))),
        flushDraft: api.flushDraft,
        prepareRunStart: api.prepareRunStart,
        dispose() {
            if (st.disposed) return;
            presetDeleteConfirmation.dispose();
            api.flushDraft();
            st.disposed = true;
            st.dragController.dispose();
            st.catalogPreview.dispose();
            st.viewport.dispose();
            audio.dispose();
            st.guide?.dispose();
            shell.container.dataset.lifecycle = 'disposed';
        },
    });
}
