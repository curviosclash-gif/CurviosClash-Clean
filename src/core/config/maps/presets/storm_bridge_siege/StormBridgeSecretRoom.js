import { createVaultRoom } from '../siege_shared/VaultRoom.js';

const VAULT = createVaultRoom({
    id: 'bridge_vault',
    half: 18,
    floor: -30,
    ceiling: -6,
    destructible: 'storm_bridge',
    delaySeconds: 4,
    entryPortal: { pos: [0, 10, -62], color: 0x45d8ff },
    ejectPos: [0, 16, -70],
    ejectYawDeg: 180,
});

export const STORM_BRIDGE_SECRET_ROOM_OBSTACLES = VAULT.obstacles;
export const STORM_BRIDGE_SECRET_ROOM = VAULT.room;
