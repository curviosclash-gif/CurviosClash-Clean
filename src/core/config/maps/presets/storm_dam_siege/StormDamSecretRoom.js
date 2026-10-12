import { createVaultRoom } from '../siege_shared/VaultRoom.js';

const VAULT = createVaultRoom({
    id: 'dam_vault',
    half: 18,
    floor: -30,
    ceiling: -6,
    destructible: 'storm_dam',
    delaySeconds: 4,
    entryPortal: { pos: [0, 12, -62], color: 0x5ee5ff },
    ejectPos: [0, 18, -70],
    ejectYawDeg: 180,
});

export const STORM_DAM_SECRET_ROOM_OBSTACLES = VAULT.obstacles;
export const STORM_DAM_SECRET_ROOM = VAULT.room;
