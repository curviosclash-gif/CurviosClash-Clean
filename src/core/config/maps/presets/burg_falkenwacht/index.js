import { FALKENWACHT_MODELS, FALKENWACHT_OBSTACLES } from './FalkenwachtModels.js';
import { FALKENWACHT_CHECKPOINTS, FALKENWACHT_FINISH, FALKENWACHT_PARCOURS_RULES } from './FalkenwachtRoute.js';

const lighting = {
    key: { direction: [-55, 65, 35], color: 0xffe4b8, intensity: 1.4 },
    fill: { direction: [35, 40, -25], color: 0xb5cff0, intensity: 0.48 },
    rim: { direction: [-25, 30, -50], color: 0xffd6a0, intensity: 0.5 },
    hemisphere: { skyColor: 0xaac8e0, groundColor: 0x635440 },
    // Thin valley mist needs a long closure above the castle, not a last-20-unit curtain.
    fog: { color: 0xa6b6b4, near: 450, far: 600, height: 5, heightFalloff: 0.06,
        turbulence: 0.06, skyBlend: 1, colorHigh: 0x9eb8ce, colorLow: 0x8d947d, clipClosureStart: 0.6 },
    skyDome: { zenithColor: 0x447db0, horizonColor: 0xcad4cc, nadirColor: 0x686e53 },
    starsVisible: false,
    exposureOffset: 0.08,
};

function item(id, pickupType, type, x, y, z) {
    return { id: `falkenwacht_${id}`, pickupType, type, x, y, z, weight: 1 };
}

const items = [
    item('west_speed', 'SPEED_UP', 'item_battery', -180, 28, 0),
    item('east_speed', 'SPEED_UP', 'item_battery', 180, 28, 0),
    item('outer_shield', 'SHIELD', 'item_shield', 0, 26, 62),
    item('inner_shield', 'SHIELD', 'item_shield', 0, 32, -45),
    item('stable_ghost', 'GHOST', 'item_coin', -85, 27, 45),
    item('palas_ghost', 'GHOST', 'item_coin', 80, 34, -56),
    item('keep_reward', 'SHIELD', 'item_crystal', -64, 117, -42),
    item('gallery_reward', 'ROCKET_WEAK', 'item_rocket', 70, 61, -102),
];

const spawns = [
    { x: 180, y: 30, z: 70 }, { x: -180, y: 30, z: -70 },
    { x: -180, y: 30, z: 70 }, { x: 180, y: 30, z: -70 },
    { x: -110, y: 56, z: 145 }, { x: 110, y: 56, z: -145 },
    { x: 110, y: 56, z: 145 }, { x: -110, y: 56, z: -145 },
];

const common = {
    size: [460, 150, 360],
    scaleAuthoredAnchors: true,
    preferAuthoredPortals: true,
    portals: [],
    gates: [],
    portalLevels: [26, 58, 95],
    glbModels: [
        ...FALKENWACHT_MODELS,
        { id: 'falkenwacht-cart', url: 'assets/models/downloaded_cc0/pm-medieval-fair/Cart.glb',
            position: [56, 12, 88], rotation: [0, 0.4, 0], targetSize: 10 },
        { id: 'falkenwacht-barrels', url: 'assets/models/downloaded_cc0/pm-medieval-fair/Barrel.glb',
            position: [116, 12, 50], rotation: [0, 0, 0], targetSize: 4 },
    ],
    glbColliderMode: 'scene',
    glbAuthoredObstaclesCollisionOnly: true,
    glbAnimationClock: { beatSeconds: 4 },
    glbLoadConcurrency: 3,
    obstacles: FALKENWACHT_OBSTACLES,
    lighting,
    lights: [
        { id: 'fw_stable', x: -85, y: 39, z: 45, color: 0xffba67, intensity: 2600, distance: 35 },
        { id: 'fw_palas_west', x: 57, y: 46, z: -56, color: 0xffc47b, intensity: 3000, distance: 35 },
        { id: 'fw_palas_east', x: 105, y: 46, z: -56, color: 0xffc47b, intensity: 3000, distance: 35 },
        { id: 'fw_gate', x: 0, y: 43, z: 118, color: 0xffaa55, intensity: 2200, distance: 28 },
        { id: 'fw_arcade', x: 70, y: 43, z: -102, color: 0xffbb66, intensity: 2000, distance: 35 },
    ],
    items,
};

export const FALKENWACHT_MAPS = {
    burg_falkenwacht: {
        ...common,
        name: 'Burg Falkenwacht – Parcours',
        playerSpawn: { x: 0, y: 26, z: 174 },
        botSpawns: spawns,
        missions: [{ type: 'TIME_TRIAL', params: { target: 180 }, weight: 1.8 }],
        parcours: { enabled: true, routeId: 'burg_falkenwacht_v1', rules: FALKENWACHT_PARCOURS_RULES,
            checkpoints: FALKENWACHT_CHECKPOINTS, finish: FALKENWACHT_FINISH },
    },
    burg_falkenwacht_arena: {
        ...common,
        name: 'Burg Falkenwacht – Arena',
        playerSpawn: spawns[0],
        botSpawns: spawns.slice(1),
        missions: [
            { type: 'KILL_COUNT', params: { target: 5 }, weight: 1.2 },
            { type: 'SURVIVE_DURATION', params: { target: 60 }, weight: 1 },
        ],
    },
};
