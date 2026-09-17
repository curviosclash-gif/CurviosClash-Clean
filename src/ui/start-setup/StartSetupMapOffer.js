import { isParcoursActiveForGameMode } from '../../shared/contracts/MapModeContract.js';

export const SHOWCASE_MAP_FILTER = 'showcase';

/**
 * Whether the map picker offers a map for a mode path. Every map stays valid everywhere,
 * so a stored choice still loads; the picker only leaves out what the mode cannot use.
 * Fight skips the pure race courses - unless a course was built for combat, with a Fight
 * route or a Fight scenario of its own - and keeps the model showcases behind their own
 * collection filter, where item and model checks still find them.
 *
 * @param {{ key?: string, collection?: string }|null} entry Map preview entry.
 * @param {object|null} mapDefinition Runtime map definition.
 * @param {string} modePath
 * @param {string} [mapFilter] Active collection filter of the picker.
 * @returns {boolean}
 */
export function isMapOfferedForModePath(entry, mapDefinition, modePath, mapFilter = 'all') {
    if (String(modePath || '').trim().toLowerCase() !== 'fight') return true;
    const collection = String(entry?.collection || '').trim().toLowerCase();
    if (collection === 'showcase') return mapFilter === SHOWCASE_MAP_FILTER;
    if (collection !== 'parcours') return true;
    return isParcoursActiveForGameMode(mapDefinition, 'HUNT')
        || mapDefinition?.singlePlayerScenario?.modePath === 'fight';
}
