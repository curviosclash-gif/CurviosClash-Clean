const make = (id, radius, lifetime, fragments) => Object.freeze({ id, radius, lifetime, fragments });
export const CONVENTIONAL_EXPLOSION_PROFILES = Object.freeze({
    'ground-tnt': make('ground-tnt', 4.8, 2.5, 34),
    'ground-grenade': make('ground-grenade', 2.6, 1.7, 20),
    'ground-rocket': make('ground-rocket', 3.1, 2.4, 28),
    'ground-fuel': make('ground-fuel', 5.2, 3, 30),
    'ground-breach': make('ground-breach', 3.1, 2, 24),
    'air-compact': make('air-compact', 3.1, 2.1, 24),
    'air-fragment': make('air-fragment', 2.6, 1.4, 32),
    'air-elongated': make('air-elongated', 3.1, 1.8, 24),
    'air-fuel': make('air-fuel', 5.2, 2.8, 28),
    'air-secondary': make('air-secondary', 6.5, 3, 34),
});

export function selectConventionalExplosionProfile(event = {}) {
    if (CONVENTIONAL_EXPLOSION_PROFILES[event.profile]) return CONVENTIONAL_EXPLOSION_PROFILES[event.profile];
    const type = String(event.projectileType || '').toUpperCase();
    const contact = event.contact?.hit === true;
    const normal = event.contact?.normal;
    const floor = contact && Number(normal?.y) > .45;
    let id;
    if (event.kind === 'intercept') {
        // A projectile interceptor leaves an elongated burst along the incoming flight;
        // a gun interception has the compact, brighter fragmentation flash.
        id = event.interceptor === 'rocket' && event.direction ? 'air-elongated' : 'air-fragment';
    } else if (event.kind === 'bomb') id = 'ground-tnt';
    else if (event.kind === 'bomber-crash') id = 'ground-fuel';
    else if (event.kind === 'ground-unit') id = event.large === true ? 'ground-fuel' : 'ground-grenade';
    else if (event.kind === 'death') {
        id = contact ? 'ground-fuel' : (type === 'ROCKET_MEGA' || event.large === true ? 'air-secondary' : 'air-fuel');
    } else if (contact && !floor) id = 'ground-breach';
    else if (floor) id = type === 'ROCKET_WEAK' ? 'ground-grenade' : 'ground-rocket';
    else id = 'air-compact';
    return CONVENTIONAL_EXPLOSION_PROFILES[id];
}

export function rocketVisualScale(type) {
    if (type === 'ROCKET_WEAK') return 2.6/3.1;
    if (type === 'ROCKET_HEAVY') return 3.8/3.1;
    if (type === 'ROCKET_MEGA') return 4.8/3.1;
    return 1;
}

/** Copy only presentation inputs before the arena's shared collision object is queried again. */
export function copyExplosionContact(out, collision, hit = collision?.hit === true) {
    out.hit = hit === true;
    out.normal.set(Number(collision?.normal?.x) || 0, Number(collision?.normal?.y) || 0,
        Number(collision?.normal?.z) || 0);
    if (out.normal.lengthSq() > .000001) out.normal.normalize();
    out.dust = out.hit && out.normal.y > .45 && collision?.kind === 'dust';
    return out;
}
