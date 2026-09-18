export const EDITOR_VIEW_PATHS = Object.freeze({
    MAP_EDITOR: '/editor/map-editor-3d.html',
    VEHICLE_LAB: '/prototypes/vehicle-lab/index.html',
});

export const EDITOR_DISK_IO_CONTRACT_VERSION = 'editor-disk-io.v1';

export const EDITOR_API_ROUTES = Object.freeze({
    SAVE_MAP_DISK: '/api/editor/save-map-disk',
    LIST_MAPS_DISK: '/api/editor/list-maps-disk',
    OPEN_MAPS_FOLDER: '/api/editor/open-maps-folder',
    SAVE_VEHICLE_DISK: '/api/editor/save-vehicle-disk',
    LIST_VEHICLES_DISK: '/api/editor/list-vehicles-disk',
    GET_VEHICLE_DISK: '/api/editor/get-vehicle-disk',
    RENAME_VEHICLE_DISK: '/api/editor/rename-vehicle-disk',
    DELETE_VEHICLE_DISK: '/api/editor/delete-vehicle-disk',
    SAVE_VIDEO_DISK: '/api/editor/save-video-disk',
});

/**
 * Ein einziger Kanal fuer alle Dateizugriffe der Autorenwerkzeuge. Die Aktion
 * steht im Nutzlastfeld `action` und wird gegen EDITOR_DISK_ACTIONS geprueft,
 * damit kein unbekannter Befehl durchrutscht.
 */
export const EDITOR_DISK_IPC_CHANNEL = 'editor-disk:request';

export const EDITOR_DISK_ACTIONS = Object.freeze({
    SAVE_MAP: 'save-map',
    LIST_MAPS: 'list-maps',
    OPEN_MAPS_FOLDER: 'open-maps-folder',
    SAVE_VEHICLE: 'save-vehicle',
    LIST_VEHICLES: 'list-vehicles',
    GET_VEHICLE: 'get-vehicle',
    RENAME_VEHICLE: 'rename-vehicle',
    DELETE_VEHICLE: 'delete-vehicle',
});

/** Zuordnung der HTTP-Entwicklungsrouten auf die Aktionen desselben Vertrags. */
export const EDITOR_DISK_ACTION_BY_ROUTE = Object.freeze({
    [EDITOR_API_ROUTES.SAVE_MAP_DISK]: EDITOR_DISK_ACTIONS.SAVE_MAP,
    [EDITOR_API_ROUTES.LIST_MAPS_DISK]: EDITOR_DISK_ACTIONS.LIST_MAPS,
    [EDITOR_API_ROUTES.OPEN_MAPS_FOLDER]: EDITOR_DISK_ACTIONS.OPEN_MAPS_FOLDER,
    [EDITOR_API_ROUTES.SAVE_VEHICLE_DISK]: EDITOR_DISK_ACTIONS.SAVE_VEHICLE,
    [EDITOR_API_ROUTES.LIST_VEHICLES_DISK]: EDITOR_DISK_ACTIONS.LIST_VEHICLES,
    [EDITOR_API_ROUTES.GET_VEHICLE_DISK]: EDITOR_DISK_ACTIONS.GET_VEHICLE,
    [EDITOR_API_ROUTES.RENAME_VEHICLE_DISK]: EDITOR_DISK_ACTIONS.RENAME_VEHICLE,
    [EDITOR_API_ROUTES.DELETE_VEHICLE_DISK]: EDITOR_DISK_ACTIONS.DELETE_VEHICLE,
});

export const EDITOR_DATA_PATHS = Object.freeze({
    MAPS_DIR: 'data/maps',
    VEHICLES_DIR: 'data/vehicles',
    /** Ordner unterhalb des Nutzerdatenordners der Desktop-App. */
    USER_MAPS_DIR: 'maps',
    USER_VEHICLES_DIR: 'vehicles',
    GENERATED_LOCAL_MAPS_MODULE: 'src/entities/GeneratedLocalMaps.js',
    GENERATED_VEHICLE_CONFIGS_MODULE: 'src/entities/GeneratedVehicleConfigs.js',
});
