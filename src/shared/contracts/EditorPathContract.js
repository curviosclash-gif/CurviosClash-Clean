export const EDITOR_VIEW_PATHS = Object.freeze({
    MAP_EDITOR: '/editor/map-editor-3d.html',
    VEHICLE_LAB: '/prototypes/vehicle-lab/index.html',
});

export const EDITOR_DISK_IO_CONTRACT_VERSION = 'editor-disk-io.v1';

export const EDITOR_API_ROUTES = Object.freeze({
    SAVE_MAP_DISK: '/api/editor/save-map-disk',
    SAVE_VEHICLE_DISK: '/api/editor/save-vehicle-disk',
    LIST_VEHICLES_DISK: '/api/editor/list-vehicles-disk',
    GET_VEHICLE_DISK: '/api/editor/get-vehicle-disk',
    RENAME_VEHICLE_DISK: '/api/editor/rename-vehicle-disk',
    DELETE_VEHICLE_DISK: '/api/editor/delete-vehicle-disk',
    SAVE_VIDEO_DISK: '/api/editor/save-video-disk',
});

export const EDITOR_DATA_PATHS = Object.freeze({
    MAPS_DIR: 'data/maps',
    VEHICLES_DIR: 'data/vehicles',
    GENERATED_LOCAL_MAPS_MODULE: 'src/entities/GeneratedLocalMaps.js',
    GENERATED_VEHICLE_CONFIGS_MODULE: 'js/entities/GeneratedVehicleConfigs.js',
});
