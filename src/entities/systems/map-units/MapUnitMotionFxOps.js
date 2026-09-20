/**
 * The two signs of life on a driving tank (B3): dust off the tracks and a gun that kicks.
 *
 * Both are picture only and both run on a client as well, because they are driven by things the
 * client already knows: how far the unit drove this tick, and that a shot went off.
 *
 * There is deliberately no scrolling track texture. The tracks of the authored model carry no
 * texture to scroll, and in a game played from the air a track run is not what a player looks at -
 * the dust trail behind the tank is.
 */

/** How far a unit drives between two puffs of dust, in authored units. */
export const MAP_UNIT_DUST_INTERVAL = 6;

/** How long the gun takes to come back, and how far it goes back. */
export const MAP_UNIT_RECOIL_SECONDS = 0.35;
export const MAP_UNIT_RECOIL_DISTANCE = 0.55;

const DUST_COLOR = 0xb3a184;
const DUST_COUNT = 3;
const DUST_SPEED = 1.8;
const DUST_LIFETIME = 0.9;
const DUST_SIZE = 0.5;
const DUST_GRAVITY = -1.1;

/** Marks that a gun went off, so the model can kick the barrel back. */
export function triggerMapUnitRecoil(unit) {
    if (unit) unit.recoilRemaining = MAP_UNIT_RECOIL_SECONDS;
}

/** How far the barrel sits back right now, in model units. */
export function resolveMapUnitRecoil(unit) {
    const remaining = Number(unit?.recoilRemaining) || 0;
    if (remaining <= 0) return 0;
    // Straight back on the shot, then eased forward again over the rest of the time.
    return MAP_UNIT_RECOIL_DISTANCE * (remaining / MAP_UNIT_RECOIL_SECONDS);
}

/**
 * Counts the ground a unit covered and drops a puff of dust every `MAP_UNIT_DUST_INTERVAL`. The
 * interval grows with the map scale, so a tank three times the size leaves fewer, bigger marks
 * instead of a solid wall of particles.
 */
export function updateMapUnitDust(entityManager, unit, movedDistance) {
    const particles = entityManager?.particles;
    if (typeof particles?.spawn !== 'function') return false;
    const moved = Math.max(0, Number(movedDistance) || 0);
    if (moved <= 0) return false;
    const scale = Math.max(0.001, Number(unit.scale) || 1);
    unit.dustDistance = (Number(unit.dustDistance) || 0) + moved;
    const interval = MAP_UNIT_DUST_INTERVAL * scale;
    if (unit.dustDistance < interval) return false;
    unit.dustDistance -= interval;
    particles.spawn(unit.groundPosition, DUST_COUNT, DUST_COLOR, DUST_SPEED * scale, DUST_LIFETIME, DUST_SIZE * scale, {
        gravity: DUST_GRAVITY * scale,
        type: 'hit-impact',
    });
    return true;
}

/** Counts the recoil down. Called once per tick for every living ground unit. */
export function tickMapUnitRecoil(unit, dt) {
    if (!unit || !(unit.recoilRemaining > 0)) return;
    unit.recoilRemaining = Math.max(0, unit.recoilRemaining - Math.max(0, Number(dt) || 0));
}
