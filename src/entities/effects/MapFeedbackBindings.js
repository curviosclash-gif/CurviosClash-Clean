import { emitMapDestructibleBreakFeedback } from './MapDestructibleBreakFeedback.js';
import { emitShootablePartReleaseFeedback } from './ShootablePartReleaseFeedback.js';

/**
 * Connects the map's own events to what the players see and hear: a destructible that breaks,
 * and a shootable seed or kernel that is shot off.
 * @param {any} owner Entity manager that owns particles and audio.
 * @param {any} arena
 */
export function bindMapFeedback(owner, arena) {
    owner.onMapDestructibleBreak = (event) => emitMapDestructibleBreakFeedback(owner, event);
    arena?.setShootableReleaseListener?.(
        (position, atSeconds, source) => emitShootablePartReleaseFeedback(owner, position, atSeconds, source),
    );
}
