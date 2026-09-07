const GLB_GALLERY_PACKS = Object.freeze([
    Object.freeze({
        id: 'pm-abm',
        models: Object.freeze([
            'Altar01_Art',
            'BranchFlowers01_Art',
            'CALogo01_Art',
            'Dome01_Art',
            'Dome02_Art',
            'Dome03_Art',
            'Dome04_Art',
            'DomeExtra01_Art',
            'ElevatorTeleport01_Art',
            'EntranceDoor01_Art',
            'EntranceDoor02_Art',
            'FloorPanel01_Art',
        ]),
    }),
    Object.freeze({
        id: 'pm-aero-system',
        models: Object.freeze([
            'Aero_Airship_01',
            'Aero_Door_01',
            'Aero_Ground_Hexagon_Art',
            'Aero_Ground_Hexagons_01_Art',
            'Aero_Ground_Hexagons_02_Art',
            'Aero_Lampost_01',
            'Aero_Station_01_Art',
            'Aero_Station_Mini_Platform_Art',
            'Aero_Station_PinkRing_Art',
            'Aero_Station_Ring_Art',
            'Aero_Station_YellowRing_Art',
            'Floating_Island_01_Art',
        ]),
    }),
    Object.freeze({
        id: 'pm-avatar-garden',
        models: Object.freeze([
            'AvatarPedestal01',
            'BasePalmTree01',
            'BlackHole01',
            'Bridge01',
            'Brush01',
            'Bush01',
            'Bush02',
            'Bush03',
            'Bush04',
            'Bush05',
            'Bush06',
            'Bush07',
        ]),
    }),
    Object.freeze({
        id: 'pm-avatar-show',
        models: Object.freeze([
            'Arm_Chair',
            'Banana_Plant',
            'Book',
            'Camera',
            'Carpet',
            'CoffeeMug',
            'Curved_Pipe',
            'End_Pipe',
            'Extractor',
            'Jar',
            'Lamp_Stand',
            'Lamp_Wall',
        ]),
    }),
    Object.freeze({
        id: 'pm-ca-world',
        models: Object.freeze([
            'AvatarBust_01',
            'Bench_01',
            'Bench_02',
            'Bench_03',
            'Bin_01',
            'CAIO_Whale_01',
            'Carpet_01',
            'Carpet_02',
            'Carpet_03',
            'Column_01',
            'Column_Base_01',
            'Column_Base_02',
        ]),
    }),
    Object.freeze({
        id: 'pm-christmas',
        models: Object.freeze([
            'Candle',
            'CandyCane',
            'Door',
            'ExteriorWall',
            'Fence',
            'Fireplace',
            'Frame',
            'InteriorDoor',
            'InteriorWall',
            'Lamp01',
            'Lights01',
            'Lights02',
        ]),
    }),
    Object.freeze({
        id: 'pm-chromatic-chaos',
        models: Object.freeze([
            'Building_Corner_01',
            'Building_Rect_01',
            'Building_Vapor_Ramp_01',
            'Building_Vapor_Ramp_02',
            'CellPhone_Retro',
            'Column_Vapor_01',
            'Column_Vapor_02',
            'Column_Vapor_03',
            'Computer_Retro',
            'ComputerScreen_Open_Retro',
            'ComputerScreen_Retro',
            'David_Retro',
        ]),
    }),
    Object.freeze({
        id: 'pm-crystal-crossroads',
        models: Object.freeze([
            'Arc',
            'Column_Regular',
            'Column_SmallBroken_01',
            'Crystal_Base',
            'Crystal_Cluster',
            'Crystal_ClusterSurrounded',
            'Crystal_Small_01',
            'Crystal_Small_02',
            'Crystal_Small_03',
            'Crystal_Small_04',
            'Dune_Sand',
            'Floor_Sand_Large',
        ]),
    }),
    Object.freeze({
        id: 'pm-lunar-year',
        models: Object.freeze([
            'ArchBanner',
            'Banner',
            'Bell',
            'BellStructure',
            'BuildingBase',
            'Carpet01',
            'Carpet02',
            'Column',
            'ColumnBase',
            'Cushion',
            'Door',
            'Dragon',
        ]),
    }),
    Object.freeze({
        id: 'pm-medieval-fair',
        models: Object.freeze([
            'Balloon_Interactible_Red',
            'Balloon_Interactible_Yellow',
            'Barrel',
            'Barrel_Beer_Mountain',
            'Beer',
            'BoardCutout',
            'Booth_Food01',
            'Booth_Food02',
            'Booth_Pretzelgame',
            'Booth_Wearables',
            'Cart',
            'CenterPlatform',
        ]),
    }),
]);

const COLUMN_COUNT = 12;
const ROW_COUNT = GLB_GALLERY_PACKS.length;
const SLOT_SPACING = 22;
const MODEL_TARGET_SIZE = 14;
const PEDESTAL_SIZE = 16;
const MODEL_BASE_Y = 1;

function createGalleryContent() {
    const glbModels = [];
    const obstacles = [];
    for (let rowIndex = 0; rowIndex < GLB_GALLERY_PACKS.length; rowIndex += 1) {
        const pack = GLB_GALLERY_PACKS[rowIndex];
        for (let columnIndex = 0; columnIndex < pack.models.length; columnIndex += 1) {
            const modelName = pack.models[columnIndex];
            const x = (columnIndex - (COLUMN_COUNT - 1) * 0.5) * SLOT_SPACING;
            const z = (rowIndex - (ROW_COUNT - 1) * 0.5) * SLOT_SPACING;
            glbModels.push(Object.freeze({
                id: `${pack.id}/${modelName}`,
                url: `assets/models/${pack.id === 'pm-avatar-garden' ? 'optimized_cc0' : 'downloaded_cc0'}/${pack.id}/${modelName}.glb`,
                position: Object.freeze([x, MODEL_BASE_Y, z]),
                rotation: Object.freeze([0, Math.PI, 0]),
                targetSize: MODEL_TARGET_SIZE,
            }));
            obstacles.push(Object.freeze({
                pos: Object.freeze([x, MODEL_BASE_Y * 0.5, z]),
                size: Object.freeze([PEDESTAL_SIZE, MODEL_BASE_Y, PEDESTAL_SIZE]),
            }));
        }
    }
    return {
        glbModels: Object.freeze(glbModels),
        obstacles: Object.freeze(obstacles),
    };
}

const GALLERY_CONTENT = createGalleryContent();

export const GLB_GALLERY_MODEL_COUNT = GALLERY_CONTENT.glbModels.length;

export const GLB_GALLERY_MAPS = Object.freeze({
    glb_gallery: Object.freeze({
        name: `GLB Gallery - Alle ${GLB_GALLERY_MODEL_COUNT} Modelle`,
        size: Object.freeze([270, 38, 230]),
        glbModels: GALLERY_CONTENT.glbModels,
        glbLoadConcurrency: 4,
        glbColliderMode: 'mesh',
        obstacles: GALLERY_CONTENT.obstacles,
        portals: Object.freeze([]),
    }),
});
