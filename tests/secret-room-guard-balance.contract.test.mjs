import assert from 'node:assert/strict';
import test from 'node:test';

import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { normalizeStaticTurretDefinition } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import { EIFFEL_SIEGE_SECRET_ROOM_TURRETS } from '../src/core/config/maps/presets/eiffel_tower_siege/EiffelTowerSiegeSecretRoom.js';
import { REACTOR_SITE_SECRET_ROOM_TURRETS } from '../src/core/config/maps/presets/reactor_site/ReactorSiteSecretRoom.js';

// User decision 18.09.2026: a vehicle that just sits in the vault must last about twelve seconds
// against its three guards - long enough to grab items and fight back, short enough to stay a risk.
// Measured in the running game before the change: 4.3 s (two machine guns at 10 hp/s together and
// a 30 hp rocket every 3.4 s).
const TARGET_SECONDS = 12;
const TOLERANCE_SECONDS = 1;
const PLAYER_HP = 100;
// First shots as measured in the Electron window: the guns need about a quarter second to
// acquire, the rocket lands about 0.8 s after the visitor appears.
const FIRST_MG_HIT = 0.27;
const FIRST_ROCKET_HIT = 0.8;

function secondsToKill(turrets) {
    const guards = turrets.map((entry, index) => normalizeStaticTurretDefinition(entry, index));
    const hits = [];
    for (const guard of guards) {
        const rocket = guard.weapon === 'rocket';
        const damage = rocket ? HUNT_CONFIG.ROCKET_TIERS.WEAK.damage : guard.damage;
        for (let t = rocket ? FIRST_ROCKET_HIT : FIRST_MG_HIT; t < 60; t += guard.cooldown) hits.push({ t, damage });
    }
    hits.sort((a, b) => a.t - b.t);
    let hp = PLAYER_HP;
    for (const hit of hits) {
        hp -= hit.damage;
        if (hp <= 0) return hit.t;
    }
    return Infinity;
}

for (const [name, turrets] of [
    ['eiffel tower siege', EIFFEL_SIEGE_SECRET_ROOM_TURRETS],
    ['reactor site', REACTOR_SITE_SECRET_ROOM_TURRETS],
]) {
    test(`${name}: the vault guards need about twelve seconds for a standing vehicle`, () => {
        const seconds = secondsToKill(turrets);
        assert.ok(
            Math.abs(seconds - TARGET_SECONDS) <= TOLERANCE_SECONDS,
            `a standing ${PLAYER_HP} hp vehicle lasts ${seconds.toFixed(1)} s, wanted ${TARGET_SECONDS} +- ${TOLERANCE_SECONDS}`,
        );
    });

    test(`${name}: the guards stay two machine guns and one weak rocket`, () => {
        const guards = turrets.map((entry, index) => normalizeStaticTurretDefinition(entry, index));
        assert.deepEqual(guards.map((guard) => guard.weapon).sort(), ['mg', 'mg', 'rocket']);
        assert.equal(guards.find((guard) => guard.weapon === 'rocket').rocketType, 'ROCKET_WEAK');
    });
}
