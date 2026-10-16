// Sparse load-failure collision stays outside the authored flight corridor.
export const SKYSCRAPER_SITE_OBSTACLES = [
    { pos: [0, -1, 0], size: [360, 2, 300], kind: 'foam' },
    { pos: [62, 57.5, -25], size: [12, 115, 30] },
    { pos: [-95, 26.5, 45], size: [8, 53, 8] },
];

export const SKYSCRAPER_SITE_ITEMS = [
    { id: 'ss_shield_street', type: 'item_shield', pickupType: 'SHIELD', x: -120, y: 16.5, z: 100, weight: 1 },
    { id: 'ss_speed_frame', type: 'item_battery', pickupType: 'SPEED_UP', x: -22, y: 58, z: 45, weight: 1 },
    { id: 'ss_shield_shaft', type: 'item_shield', pickupType: 'SHIELD', x: 78, y: 100, z: -60, weight: 1 },
    { id: 'ss_speed_roof', type: 'item_battery', pickupType: 'SPEED_UP', x: -30, y: 130, z: -38, weight: 1 },
];
