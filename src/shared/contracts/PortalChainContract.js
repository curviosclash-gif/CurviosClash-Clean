import {
    FIVE_PORTALS_MAPS,
    FIVE_PORTALS_RECORD_KEY,
    FIVE_PORTALS_RECORD_VERSION,
    FIVE_PORTALS_RUN_TYPE,
} from './FivePortalsContract.js';

// A "portal chain" is a fixed sequence of parcours maps linked by exit portals, all run through
// the same "five_portals" runType (rules, Hunt combat profile, rewards and respawn behaviour stay
// identical across chains). "Fünf Portale" was the first and only chain; this table lets a second
// chain ("Himmelsleiter") reuse the exact same runtime without touching Fünf Portale's behaviour
// or its saved records.
//
// The sky_ladder map keys are repeated here as literals (not imported from
// src/core/config/maps/presets/sky_ladder/index.js) because shared/contracts may not import from
// core - see CLAUDE.md "Schichten in src/".
const SKY_LADDER_MAP_KEYS = Object.freeze([
    'sky_ladder_abyss',
    'sky_ladder_foundry',
    'sky_ladder_storm',
    'sky_ladder_star',
]);

export const SKY_LADDER_RECORD_KEY = 'curviosclash.sky-ladder-records.v1';
export const SKY_LADDER_RECORD_VERSION = 'sky-ladder-records.v1';

export const DEFAULT_PORTAL_CHAIN_ID = 'five_portals';

export const PORTAL_CHAINS = Object.freeze({
    five_portals: Object.freeze({
        id: 'five_portals',
        label: 'Fünf Portale',
        description: 'Fünf Parcours-Karten auf Zeit; das Ausgangsportal bringt dich jeweils zur nächsten.',
        maps: FIVE_PORTALS_MAPS,
        recordKey: FIVE_PORTALS_RECORD_KEY,
        recordVersion: FIVE_PORTALS_RECORD_VERSION,
    }),
    sky_ladder: Object.freeze({
        id: 'sky_ladder',
        label: 'Himmelsleiter',
        description: 'Vier Stufen vom Meeresgrund zu den Sternen – durchs Portal geht es eine Etage höher.',
        maps: SKY_LADDER_MAP_KEYS,
        recordKey: SKY_LADDER_RECORD_KEY,
        recordVersion: SKY_LADDER_RECORD_VERSION,
    }),
});

export const PORTAL_CHAIN_RUN_TYPE = FIVE_PORTALS_RUN_TYPE;
// Every chain rides the five_portals run type, so callers can take both checks from here.
export { isFivePortalsConfig, isFivePortalsRunType } from './FivePortalsContract.js';

/** @returns {keyof typeof PORTAL_CHAINS} an id guaranteed to exist in PORTAL_CHAINS */
export function normalizePortalChainId(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PORTAL_CHAINS, normalized)
        ? /** @type {keyof typeof PORTAL_CHAINS} */ (normalized)
        : DEFAULT_PORTAL_CHAIN_ID;
}

/** @returns {typeof PORTAL_CHAINS[keyof typeof PORTAL_CHAINS]} */
export function resolvePortalChain(value) {
    return PORTAL_CHAINS[normalizePortalChainId(value)];
}
