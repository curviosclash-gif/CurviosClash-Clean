import { getVehicleManagerInteractionRules, listArcadeVehicleManagerCatalogEntries, listVehicleManagerCatalogEntries } from '../arcade/VehicleManagerCatalog.js';
import { createVehicleManagerSelectionState } from '../arcade/vehicle-manager/VehicleManagerSelectionState.js';
import { registerPublishedHangarParts } from './HangarPartCatalog.js';
import { VEHICLE_LAB_HANGAR_PUBLISH_STORAGE_KEY } from '../../shared/contracts/VehicleLabHangarPublishContract.js';
import { createHangarBuildPersistenceAdapter } from './HangarBuildPersistence.js';
import { createHangarDraftPersistence } from './HangarDraftPersistence.js';
import { createHangarWorkshopAudio } from './HangarWorkshopAudio.js';
import { createFallbackProfilePort } from './HangarWorkshopProfileSupport.js';

/**
 * The state every part of the hangar workshop shares (the controller, the display sync, the
 * profile, build and save actions and the event wiring).
 *
 * The first block never changes after this function returns. The second block is filled by
 * the controller while it builds the DOM and the panels; the factories of the other modules are
 * called only after that, so they may read these fields when they are created. The last block is
 * the mutable workshop state: modules write it as `st.draft = ...`, never through a copy.
 *
 * Returns null when the workshop cannot run (no `bind` port or an empty catalog).
 */
export function createWorkshopState(ctx) {
    const settings = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : {};
    const runtimeAccess = ctx.runtimeAccess && typeof ctx.runtimeAccess === 'object' ? ctx.runtimeAccess : null;
    const bind = typeof ctx.bind === 'function' ? ctx.bind : null;
    if (!bind) return null;
    const hangarMode = ctx.mode === 'fight' ? 'fight' : 'arcade';
    const store = runtimeAccess?.getSettingsStore?.() || ctx.settingsManager?.getSettingsRecordStorePort?.() || null;
    registerPublishedHangarParts(store?.loadJsonRecord?.(VEHICLE_LAB_HANGAR_PUBLISH_STORAGE_KEY, null));
    const profilePort = runtimeAccess?.arcadeVehicleProfileWorkshop || createFallbackProfilePort(store);
    const rules = getVehicleManagerInteractionRules(hangarMode);
    // Arcade flies only the factory ships (with their fixed role); the Fight hangar keeps Lab builds.
    const catalogEntries = hangarMode === 'arcade' ? listArcadeVehicleManagerCatalogEntries() : listVehicleManagerCatalogEntries();
    if (!catalogEntries.length) return null;
    const byVehicleId = new Map(catalogEntries.map((entry) => [entry.vehicleId, entry]));
    const selection = createVehicleManagerSelectionState({ settings, catalogEntries, mode: hangarMode });
    const persistence = createHangarBuildPersistenceAdapter({ mode: hangarMode, store, invokeCapability: runtimeAccess?.invokeHangarCapability });
    const draftPersistence = createHangarDraftPersistence({ mode: hangarMode, store });
    const audio = createHangarWorkshopAudio(ctx.audio || null);
    const slotView = hangarMode === 'arcade' ? 'upgrade' : 'workshop'; // Arcade: stone slots live in "Ausbau"
    return {
        ctx,
        ui: ctx.ui || {},
        settings,
        runtimeAccess,
        bind,
        emit: typeof ctx.emit === 'function' ? ctx.emit : null,
        eventTypes: ctx.eventTypes || {},
        hangarMode,
        store,
        profilePort,
        rules,
        catalogEntries,
        byVehicleId,
        selection,
        persistence,
        draftPersistence,
        audio,
        slotView,

        shell: null,
        viewport: null,
        catalogPreview: null,
        renderer: null,
        stonePanel: null,
        weaponPanel: null,
        formTab: null,
        guide: null,
        dragController: null,

        profiles: profilePort.load(),
        catalogView: 'vehicles',
        buildView: slotView,
        partFamily: 'all',
        partTier: 'ALL',
        partTrait: 'all',
        partAvailability: 'all',
        selectedSlotId: 'core',
        selectedPartId: '',
        previewPartId: '',
        draft: null,
        savedBuild: null,
        baselineBuild: null,
        history: null,
        hydrated: false,
        disposed: false,
        draftSaveTimer: 0,
        persistDraftChanges: false,
        lastReportedDirty: null,
        unsavedProfileEdits: false,
        bankConflict: false,
    };
}
