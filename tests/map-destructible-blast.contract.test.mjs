import test from 'node:test';
import assert from 'node:assert/strict';

import { MapDestructibleBlastSystem } from '../src/entities/systems/MapDestructibleBlastSystem.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { resolveMapDestructibleFireballSphere } from '../src/shared/contracts/MapDestructibleHazardContract.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { EntityManager } from '../src/entities/EntityManager.js';

/**
 * Stands in for EntityManager: only the two seams MapDestructibleBlastSystem actually touches
 * (the destructible definition/clock, and _applyModeDamage) - see EntityRuntimeSupportAssembly's
 * applyEnvironmentProjectileDamage for the same pattern with a real EntityManager.
 */
function createOwner(definition, elapsedSecondsBox, anchorScale = 1) {
    const calls = [];
    const players = [
        { index: 0, alive: true, position: { x: 5, y: 0, z: 0 } }, // inside the 25m blast radius
        { index: 1, alive: true, position: { x: 50, y: 0, z: 0 } }, // outside the radius
        { index: 2, alive: false, position: { x: 5, y: 0, z: 0 } }, // dead already, never re-damaged
    ];
    const owner = {
        players,
        _mapDestructibleSystem: {
            anchorScale,
            getDefinition: () => definition,
            getElapsedSeconds: () => elapsedSecondsBox.value,
        },
        _applyModeDamage(target, amount, cause, options) {
            calls.push({ target, amount, cause, options });
            return { isDead: false };
        },
    };
    return { owner, calls };
}

function createDefinitionWithBlast() {
    return normalizeMapDestructibles({
        segments: [{
            id: 'reactor_dome', kind: 'leg_lower', hp: 500, meshPrefixes: ['dome'], anchor: [0, 0, 0],
        }],
        breakScenes: [{
            id: 'mushroom_cloud',
            trigger: { segmentId: 'reactor_dome' },
            modelId: 'mushroom_cloud',
            blast: { radius: 25, damage: 80, delaySeconds: 3 },
        }],
    });
}

test('a break scene with a blast damages nearby alive players once its delay has elapsed', () => {
    const definition = createDefinitionWithBlast();
    const elapsedSecondsBox = { value: 10 };
    const { owner, calls } = createOwner(definition, elapsedSecondsBox);
    const system = new MapDestructibleBlastSystem(owner);

    system.schedulePendingBlast(
        { segmentId: 'reactor_dome', kind: 'leg_lower', atSeconds: 10, yaw: 0 },
        { sourcePlayer: null },
    );

    system.update();
    assert.equal(calls.length, 0, 'the blast is not applied before its delay has elapsed');

    elapsedSecondsBox.value = 13;
    system.update();
    assert.equal(calls.length, 1, 'the blast applies exactly once, to the player inside its radius');
    assert.equal(calls[0].target, owner.players[0]);
    assert.equal(calls[0].cause, 'BLAST');
    assert.ok(calls[0].amount > 0 && calls[0].amount <= 80, 'damage falls off from the 80 center value');

    system.update();
    assert.equal(calls.length, 1, 'an already-applied blast is never applied a second time');
});

test('a target exactly at the blast radius takes no minimum damage', () => {
    const definition = createDefinitionWithBlast();
    const elapsedSecondsBox = { value: 10 };
    const { owner, calls } = createOwner(definition, elapsedSecondsBox);
    const edge = { index: 3, alive: true, position: { x: 25, y: 0, z: 0 } };
    owner.players.push(edge);
    const system = new MapDestructibleBlastSystem(owner);

    system.schedulePendingBlast({ segmentId: 'reactor_dome', kind: 'leg_lower', atSeconds: 10, yaw: 0 });
    elapsedSecondsBox.value = 13;
    system.update();

    assert.equal(calls.some((call) => call.target === edge), false);
});

test('a collapse blast skips protected players until their spawn protection expires', () => {
    const definition = createDefinitionWithBlast();
    const elapsedSecondsBox = { value: 10 };
    const { owner, calls } = createOwner(definition, elapsedSecondsBox);
    const protectedTarget = {
        index: 3, alive: true, position: { x: 5, y: 0, z: 0 }, spawnProtectionTimer: 1,
        knockbacks: 0,
        activateSlingshot() { this.knockbacks += 1; },
    };
    const exposedTarget = {
        index: 4, alive: true, position: { x: 10, y: 0, z: 0 },
        knockbacks: 0,
        activateSlingshot() { this.knockbacks += 1; },
    };
    owner.players = [protectedTarget, exposedTarget];
    const system = new MapDestructibleBlastSystem(owner);

    system.schedulePendingBlast({ segmentId: 'reactor_dome', kind: 'leg_lower', atSeconds: 10, yaw: 0 });
    elapsedSecondsBox.value = 13;
    system.update();

    assert.deepEqual(calls.map((call) => call.target), [exposedTarget]);
    assert.equal(protectedTarget.knockbacks, 0);
    assert.equal(exposedTarget.knockbacks, 1);

    protectedTarget.spawnProtectionTimer = 0;
    system.schedulePendingBlast({ segmentId: 'reactor_dome', kind: 'leg_lower', atSeconds: 13, yaw: 0 });
    elapsedSecondsBox.value = 16;
    system.update();

    assert.equal(calls.filter((call) => call.target === protectedTarget).length, 1);
    assert.equal(protectedTarget.knockbacks, 1);
});

test('EntityManager preserves reactor feedback while its break callback schedules and applies the blast', () => {
    const definition = createDefinitionWithBlast();
    const manager = new EntityManager(null, null, null, null, null, null);
    const elapsed = { value: 10 };
    manager.arena = {
        currentMapKey: 'reactor_site',
        currentMapDefinition: { destructibles: definition },
        get glbAnimationElapsedSeconds() { return elapsed.value; },
        resetMapDestructibleScenes() {},
        applyMapDestructibleEvents() {},
    };
    manager.gameModeStrategy = { modeType: 'HUNT' };
    const target = { index: 0, alive: true, position: { x: 5, y: 0, z: 0 } };
    manager.players = [target];
    const damage = [];
    manager._applyModeDamage = (player, amount, cause) => {
        damage.push({ player, amount, cause });
        return { isDead: false };
    };

    manager._mapDestructibleSystem.startRound();
    manager._mapDestructibleSystem.applyMeshHit('dome', 500);
    elapsed.value = 13;
    manager._mapDestructibleBlastSystem.update();

    assert.deepEqual(damage, [{ player: target, amount: 64, cause: 'BLAST' }]);
});

test('a break scene without an authored blast schedules nothing', () => {
    const definition = normalizeMapDestructibles({
        segments: [{
            id: 'tower_leg', kind: 'leg_mid', hp: 300, meshPrefixes: ['leg'], anchor: [0, 0, 0],
        }],
        breakScenes: [{
            id: 'tower_fall',
            trigger: { segmentId: 'tower_leg' },
            modelId: 'tower_fall',
        }],
    });
    const elapsedSecondsBox = { value: 0 };
    const { owner, calls } = createOwner(definition, elapsedSecondsBox);
    const system = new MapDestructibleBlastSystem(owner);

    system.schedulePendingBlast({ segmentId: 'tower_leg', kind: 'leg_mid', atSeconds: 0, yaw: 0 });
    elapsedSecondsBox.value = 100;
    system.update();

    assert.equal(calls.length, 0, 'a fall without an authored blast never damages anyone');
});

// --- The fireball of a reactor breach ------------------------------------------------------------
// The second kind of danger a break scene can carry: not a moment, but the body the clip draws,
// for exactly as long as it is drawn. Shaped like the reactor site's own table but with three rows
// instead of fifteen, so every expected number below can be worked out by hand.
//
//   t=0.0   18.0 m up, no radius     the breach
//   t=1.4   48.8 m up, 62 m across   full size
//   t=4.4  114.8 m up, no radius     swallowed by the cap; everything after this is smoke
//
// The map places it like the reactor site does: axis at authored (0, 8, 0), 0.6 authored units per
// metre, and a map that scales its anchors threefold. So one metre is 1.8 world units, the axis
// stands at world y=24, and at 1.4 s the fireball is a sphere of radius 111.6 around y=111.84.
const FIREBALL_CURVE = [[0.0, 18.0, 0.0], [1.4, 48.8, 62.0], [4.4, 114.8, 0.0]];
const FIREBALL_WORLD = Object.freeze({
    anchorScale: 3, metre: 0.6 * 3, axisY: 8 * 3,
    peakSeconds: 1.4, peakY: 8 * 3 + 48.8 * 0.6 * 3, peakRadius: 62 * 0.6 * 3,
    goneSeconds: 4.4,
});

function createDefinitionWithFireball(extra = {}) {
    return normalizeMapDestructibles({
        segments: [{
            id: 'reactor_dome', kind: 'leg_lower', hp: 900, meshPrefixes: ['dome'], anchor: [0, 33, 0],
        }],
        breakScenes: [{
            id: 'mushroom_cloud',
            trigger: { segmentId: 'reactor_dome' },
            modelId: 'mushroom_cloud',
            fireball: { damage: 50, origin: [0, 8, 0], unitScale: 0.6, samples: FIREBALL_CURVE },
            ...extra,
        }],
    });
}

/** A single ship, so a test says exactly who was burned and how often. */
function createFireballWorld(definition = createDefinitionWithFireball(), at = { value: 0 }) {
    const { owner, calls } = createOwner(definition, at, FIREBALL_WORLD.anchorScale);
    const ship = {
        index: 7, alive: true, position: { x: 0, y: FIREBALL_WORLD.peakY, z: 0 },
        spawnProtectionTimer: 0, knockbacks: 0,
        activateSlingshot() { this.knockbacks += 1; },
    };
    owner.players = [ship];
    const system = new MapDestructibleBlastSystem(owner);
    const breach = (atSeconds = 0) => system.schedulePendingBlast(
        { segmentId: 'reactor_dome', kind: 'leg_lower', atSeconds, yaw: 0 },
        { sourcePlayer: null },
    );
    const tick = (seconds) => { at.value = seconds; system.update(); };
    // Where the fireball stands at a given second, read through the contract's own placement
    // rather than multiplied out again here: a centre hit has to be exactly zero units off centre,
    // because the damage is floored and a last-bit rounding difference would cost a whole point.
    // What that placement actually computes is pinned separately, in the hazard contract test.
    const sphereAt = (seconds) => resolveMapDestructibleFireballSphere(
        definition?.breakScenes?.[0]?.fireball, seconds, FIREBALL_WORLD.anchorScale,
    );
    const parkAtCentre = (seconds) => {
        const sphere = sphereAt(seconds);
        ship.position = { x: sphere.x, y: sphere.y, z: sphere.z };
        return sphere;
    };
    return { owner, calls, ship, system, breach, tick, at, sphereAt, parkAtCentre };
}

test('the fireball stands where the map places it, and burns the ship sitting there', () => {
    const { calls, ship, breach, tick, sphereAt, parkAtCentre } = createFireballWorld();
    // The placement itself, independently of the damage: one metre is 1.8 world units and the axis
    // stands on the containment's floor.
    const peak = sphereAt(FIREBALL_WORLD.peakSeconds);
    assert.ok(Math.abs(peak.y - FIREBALL_WORLD.peakY) < 1e-9, `the fireball is at ${peak.y}`);
    assert.ok(Math.abs(peak.radius - FIREBALL_WORLD.peakRadius) < 1e-9, `it is ${peak.radius} across`);

    parkAtCentre(FIREBALL_WORLD.peakSeconds);
    breach(0);
    tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(calls.length, 1, 'a ship at the centre of the fireball is burned');
    assert.equal(calls[0].target, ship);
    assert.equal(calls[0].cause, 'BLAST');
    assert.equal(calls[0].amount, 50, 'the centre deals the authored damage undiminished');
    assert.deepEqual(
        { x: calls[0].options.impactPoint.x, y: calls[0].options.impactPoint.y },
        { x: peak.x, y: peak.y },
        'the hit is reported at the fireball, not at the segment anchor',
    );
    // Dead on the axis there is no horizontal direction to be thrown along, which is what
    // ExplosionKnockbackOps decided long before this; being thrown is checked off-axis below.
    assert.equal(ship.knockbacks, 0);
});

test('the fireball burns a ship that flies in after it was made', () => {
    const { calls, ship, breach, tick, parkAtCentre } = createFireballWorld();
    ship.position = { x: 4000, y: 0, z: 0 };
    breach(0);

    tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(calls.length, 0, 'a ship on the far side of the map is not burned');

    // Halfway through the decay the fireball is half its size and stands half again as high.
    const late = parkAtCentre(2.9);
    assert.ok(Math.abs(late.radius - FIREBALL_WORLD.peakRadius / 2) < 1e-9);
    assert.ok(late.y > FIREBALL_WORLD.peakY);
    tick(2.9);
    assert.equal(calls.length, 1, 'flying into it later is just as hot');
    assert.equal(calls[0].amount, 50);
});

test('the edge of the fireball deals nothing, and just inside it deals something', () => {
    const edge = createFireballWorld();
    const peak = edge.sphereAt(FIREBALL_WORLD.peakSeconds);
    edge.ship.position = { x: peak.x + peak.radius, y: peak.y, z: peak.z };
    edge.breach(0);
    edge.tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(edge.calls.length, 0, 'exactly at the radius the falloff has run out');
    assert.equal(edge.ship.knockbacks, 0, 'and there is no force left to throw anyone with');

    const inside = createFireballWorld();
    inside.ship.position = { x: peak.x + peak.radius - 1, y: peak.y, z: peak.z };
    inside.breach(0);
    inside.tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(inside.calls.length, 1, 'one unit inside there is still damage');
    assert.ok(inside.calls[0].amount > 0 && inside.calls[0].amount < 5,
        `a graze deals ${inside.calls[0].amount}, not a centre hit`);
    assert.equal(inside.ship.knockbacks, 1, 'and a graze off the axis is still thrown');

    const outside = createFireballWorld();
    outside.ship.position = { x: peak.x + peak.radius + 1, y: peak.y, z: peak.z };
    outside.breach(0);
    outside.tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(outside.calls.length, 0);
});

test('brushing the edge does not use up the one burn a breach owes a ship', () => {
    const world = createFireballWorld();
    world.ship.position = { x: FIREBALL_WORLD.peakRadius, y: FIREBALL_WORLD.peakY, z: 0 };
    world.breach(0);
    world.tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(world.calls.length, 0);

    world.ship.position = { x: 0, y: FIREBALL_WORLD.peakY, z: 0 };
    world.tick(FIREBALL_WORLD.peakSeconds + 0.1);
    assert.equal(world.calls.length, 1, 'the ship was never burned, so it still can be');
});

test('a fireball burns each ship once per breach, however long it stays and however often it dies', () => {
    const { calls, ship, breach, tick } = createFireballWorld();
    breach(0);

    for (const seconds of [1.0, 1.4, 1.8, 2.4, 3.0, 4.0]) tick(seconds);
    assert.equal(calls.length, 1, 'sitting in it for three seconds costs one hit, not one per tick');

    // Shot down and back in the same fireball: the ship is the same ship, so the breach is done
    // with it. Otherwise a respawn on the reactor would be an endless source of damage.
    ship.alive = false;
    tick(4.1);
    ship.alive = true;
    ship.position = { x: 0, y: FIREBALL_WORLD.peakY, z: 0 };
    tick(4.2);
    assert.equal(calls.length, 1, 'a respawned ship is still the one this breach already burned');
});

test('spawn protection is skipped over rather than used up, and the fireball waits for it', () => {
    const { calls, ship, breach, tick } = createFireballWorld();
    ship.spawnProtectionTimer = 1;
    breach(0);

    tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(calls.length, 0, 'a protected ship takes nothing');
    assert.equal(ship.knockbacks, 0, 'and is not thrown either');

    ship.spawnProtectionTimer = 0;
    tick(2.0);
    assert.equal(calls.length, 1, 'once the protection runs out, the fireball it is sitting in gets it');
    tick(2.5);
    assert.equal(calls.length, 1, 'and only the once');
});

test('the fireball is over at its last row, and the smoke after it never burns anyone', () => {
    const { calls, system, breach, tick } = createFireballWorld();
    breach(0);

    tick(FIREBALL_WORLD.goneSeconds);
    assert.equal(calls.length, 0, 'at 4.4 s the fireball has no radius left');
    assert.equal(system._fireballs.length, 0, 'and is forgotten rather than kept as a zero sphere');

    // The clip draws stem, cap, rolled rim and ground dust for another forty-five seconds.
    for (const seconds of [4.5, 8, 12, 24, 40, 49]) tick(seconds);
    assert.equal(calls.length, 0, 'smoke is scenery');
});

test('the breach itself is harmless: at zero seconds the fireball has no radius', () => {
    const { calls, breach, tick } = createFireballWorld();
    breach(0);
    tick(0);
    assert.equal(calls.length, 0, 'the first row is authored at nothing, so nothing is hit');
    tick(0.7);
    assert.equal(calls.length, 1, 'half a second later it is half grown and does hit');
});

test('a fireball is sampled, not swept: a ship that crosses between two updates is missed', () => {
    const { calls, ship, breach, tick } = createFireballWorld();
    ship.position = { x: 4000, y: 0, z: 0 };
    breach(0);
    tick(0.1);
    // The whole window passes in one step, as it would after a stall. Nobody was measured inside
    // it, so nobody is charged for it - the safe direction.
    tick(9.0);
    assert.equal(calls.length, 0);
});

test('a breach on the map clock, not on the wall clock: a late break burns at its own offset', () => {
    const { calls, breach, tick } = createFireballWorld();
    breach(120);

    tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(calls.length, 0, 'at 1.4 s on the map clock this breach has not happened yet');
    tick(120 + FIREBALL_WORLD.peakSeconds);
    assert.equal(calls.length, 1, 'the table is read from the second the segment broke');
    assert.ok(calls[0].amount > 45, `a centre hit two minutes in still deals ${calls[0].amount}`);
});

test('a fresh round forgets which ships a previous breach had already burned', () => {
    const { calls, system, breach, tick } = createFireballWorld();
    breach(0);
    tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(calls.length, 1);

    system.startRound();
    assert.equal(system._fireballs.length, 0);
    breach(0);
    tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(calls.length, 2, 'the same ship can be burned again in the next round');

    system.clear();
    assert.equal(system._fireballs.length, 0);
    tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(calls.length, 2);
});

test('a replica animates the breach but never lights a fireball of its own', () => {
    const definition = createDefinitionWithFireball();
    const { owner, calls, ship, system, breach, tick } = createFireballWorld(definition);
    owner._mapDestructibleSystem.networkReplica = true;
    breach(0);

    assert.equal(system._fireballs.length, 0, 'nothing is scheduled on a replica');
    tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(calls.length, 0);
    assert.equal(ship.knockbacks, 0);
});

test('a scene may carry both dangers, and a scene that carries only a blast is untouched', () => {
    const both = createFireballWorld(createDefinitionWithFireball({
        blast: { radius: 300, damage: 80, delaySeconds: 0 },
    }));
    const peak = both.parkAtCentre(FIREBALL_WORLD.peakSeconds);
    both.breach(0);
    assert.equal(both.system._pending.length, 1);
    assert.equal(both.system._fireballs.length, 1);
    both.tick(FIREBALL_WORLD.peakSeconds);
    assert.equal(both.calls.length, 2, 'the delayed blast and the fireball are separate hits');
    // The blast is measured from the segment's own anchor, the fireball from where it is drawn.
    assert.deepEqual(both.calls.map((call) => call.options.impactPoint.y).sort((a, b) => a - b),
        [33 * FIREBALL_WORLD.anchorScale, peak.y]);
    assert.ok(both.calls.some((call) => call.amount === 50), 'the fireball centre deals its full 50');

    const blastOnly = createFireballWorld(createDefinitionWithBlast());
    blastOnly.breach(0);
    assert.equal(blastOnly.system._fireballs.length, 0, 'no fireball is invented for a plain collapse');
    assert.equal(blastOnly.system._pending.length, 1);
});

test('a replicated break still reaches its callback but never schedules local blast damage', () => {
    const definition = createDefinitionWithBlast();
    const hostClock = { value: 10 };
    const { owner: hostOwner } = createOwner(definition, hostClock);
    hostOwner.arena = {
        currentMapDefinition: { destructibles: definition },
        glbAnimationElapsedSeconds: hostClock.value,
        resetMapDestructibleScenes() {},
        applyMapDestructibleEvents() {},
    };
    hostOwner.gameModeStrategy = { modeType: 'HUNT' };
    const host = new MapDestructibleSystem(hostOwner);
    host.startRound();
    host.applyMeshHit('dome', 500);

    const replicaClock = { value: 20 };
    const { owner: replicaOwner, calls } = createOwner(definition, replicaClock);
    replicaOwner.arena = {
        currentMapDefinition: { destructibles: definition },
        glbAnimationElapsedSeconds: replicaClock.value,
        resetMapDestructibleScenes() {},
        applyMapDestructibleEvents() {},
    };
    replicaOwner.gameModeStrategy = { modeType: 'HUNT' };
    const replica = new MapDestructibleSystem(replicaOwner);
    replicaOwner._mapDestructibleSystem = replica;
    const blast = new MapDestructibleBlastSystem(replicaOwner);
    let breakCallbacks = 0;
    replicaOwner.onMapDestructibleBreak = (event, context) => {
        breakCallbacks += 1;
        assert.equal(context.replicated, true);
        blast.schedulePendingBlast(event, context);
    };
    replica.startRound();
    replica.setNetworkReplica(true);
    replica.applyNetworkState(host.serializeNetworkState());
    blast.update();

    assert.equal(breakCallbacks, 1, 'the replica still presents the host break event');
    assert.equal(calls.length, 0, 'the replica never applies a damaging local blast');
});
