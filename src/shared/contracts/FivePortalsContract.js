export const FIVE_PORTALS_RUN_TYPE = 'five_portals';
export const FIVE_PORTALS_COMBAT_PROFILE = 'hunt';
export const FIVE_PORTALS_RECORD_KEY = 'curviosclash.five-portals-records.v1';
export const FIVE_PORTALS_RECORD_VERSION = 'five-portals-records.v1';
export const FIVE_PORTALS_MAPS = Object.freeze([
    'micro_maw',
    'mirror_docks',
    'glass_serpent',
    'storm_switchyard',
    'wind_cathedral',
]);

export function isFivePortalsRunType(value) {
    return String(value || '').trim().toLowerCase() === FIVE_PORTALS_RUN_TYPE;
}

export function isFivePortalsConfig(config) {
    return config?.arcade?.enabled === true && isFivePortalsRunType(config?.arcade?.runType);
}
