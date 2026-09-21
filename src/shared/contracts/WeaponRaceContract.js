export const WEAPON_RACE_SCHEMA_VERSION = 'weapon-race.v1';
export const WEAPON_RACE_RUN_TYPE = 'weapon_race';
export const WEAPON_RACE_MAP_KEY = 'parcours_assault';
export const WEAPON_RACE_LOCAL_PLAYER_COUNT = 1;
export const WEAPON_RACE_BOT_COUNT = 4;
export const WEAPON_RACE_RESPAWN_DELAY_SECONDS = 2;
export const WEAPON_RACE_FINISH_GRACE_SECONDS = 15;
export const WEAPON_RACE_CHECKPOINT_XP = 10;
export const WEAPON_RACE_FINISH_XP = 80;
export const WEAPON_RACE_NEW_BEST_XP = 40;
export const WEAPON_RACE_GHOST_ROUTE_ID = 'weapon-race:parcours_assault';

export const WEAPON_RACE_GHOST_POLICY = Object.freeze({
    collides: false,
    invulnerable: true,
    targetable: false,
    armed: false,
    visualOnly: true,
});

export const WEAPON_RACE_CHECKPOINT_ORDER = Object.freeze([
    'CP01_START',
    'CP02_MG',
    'CP03_MG',
    'CP04_TUNNEL',
    'CP05_ROCKET',
    'CP06_CROSSFIRE',
    'CP07_HEAVY',
    'CP08_FINAL',
    'CP09_ESCAPE',
]);

export const WEAPON_RACE_WEAPON_STAGES = Object.freeze([
    Object.freeze({ checkpointId: 'CP02_MG', weaponId: 'machine_gun', ammo: null, durationSeconds: null }),
    Object.freeze({ checkpointId: 'CP03_MG', weaponId: 'flamethrower', ammo: null, durationSeconds: 4 }),
    Object.freeze({ checkpointId: 'CP05_ROCKET', weaponId: 'rocket_medium', ammo: 3, durationSeconds: null }),
    Object.freeze({ checkpointId: 'CP07_HEAVY', weaponId: 'railgun', ammo: 3, durationSeconds: null }),
    Object.freeze({ checkpointId: 'CP08_FINAL', weaponId: 'lightning', ammo: 1, durationSeconds: null }),
]);

/** @type {Map<string, any>} */
const WEAPON_RACE_STAGE_BY_CHECKPOINT = new Map(
    WEAPON_RACE_WEAPON_STAGES.map((stage) => [stage.checkpointId, stage])
);

export function isWeaponRaceRunType(value) {
    return String(value || '').trim().toLowerCase() === WEAPON_RACE_RUN_TYPE;
}

export function isWeaponRaceConfig(config = null) {
    const mapKey = String(config?.session?.mapKey || config?.mapKey || '').trim().toLowerCase();
    const sessionType = String(config?.session?.sessionType || config?.sessionType || 'single').trim().toLowerCase();
    return config?.arcade?.enabled === true
        && isWeaponRaceRunType(config?.arcade?.runType)
        && mapKey === WEAPON_RACE_MAP_KEY
        && sessionType === 'single';
}

export function resolveWeaponRaceStage(checkpointId) {
    return WEAPON_RACE_STAGE_BY_CHECKPOINT.get(String(checkpointId || '').trim().toUpperCase()) || null;
}
