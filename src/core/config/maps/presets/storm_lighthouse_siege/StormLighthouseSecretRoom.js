import { createVaultRoom } from '../siege_shared/VaultRoom.js';

const VAULT = createVaultRoom({
    id: 'lighthouse_vault',
    half: 17,
    floor: -29,
    ceiling: -5,
    destructible: 'storm_lighthouse',
    delaySeconds: 5.5,
    entryPortal: { pos: [42, 11, 0], color: 0xffd35a },
    ejectPos: [46, 17, -18],
    ejectYawDeg: 135,
});

export const STORM_LIGHTHOUSE_SECRET_ROOM_OBSTACLES = VAULT.obstacles;
export const STORM_LIGHTHOUSE_SECRET_ROOM = VAULT.room;
