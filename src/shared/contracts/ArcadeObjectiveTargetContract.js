import { isArcadeCompanion } from './ArcadeCompanionContract.js';

/** @param {any} arcade @param {any} definition */
export function isWormHuntObjectiveUnit(arcade, definition) {
    return arcade?.enabled === true && arcade.scenarioId === 'worm_hunt'
        && definition?.kind === 'creature' && String(definition.id || '').startsWith('worm_hunt_creature_');
}

/** Player objectives remain available to humans and their companions, including after stray hits.
 * @param {any} target @param {any} source
 */
export function isProtectedArcadeObjectiveTarget(target, source) {
    return target?.playerObjective === true && source?.isBot === true && !isArcadeCompanion(source);
}
