import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { applyDamage } from '../src/hunt/HealthSystem.js';
import { FlamethrowerSystem, isInsideFlameCone } from '../src/hunt/FlamethrowerSystem.js';
import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import { PlayerActionPhase } from '../src/entities/systems/lifecycle/PlayerActionPhase.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

const CLASSIC_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: false, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' },
};

function createPlayer(index, position, config) {
    return {
        index,
        alive: true,
        isBot: false,
        position: new THREE.Vector3(position[0], position[1], position[2]),
        quaternion: new THREE.Quaternion(),
        entityRuntimeConfig: config,
        activeEffects: [],
        inventory: [],
        rocketInventory: [],
        selectedItemIndex: 0,
        baseSpeed: CONFIG_BASE.PLAYER.SPEED,
        speed: CONFIG_BASE.PLAYER.SPEED,
        trail: null,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        hasShield: false,
        shieldHitFeedback: 0,
        spawnProtectionTimer: 0,
        lastDamageTimestamp: -Infinity,
        aimDirection: new THREE.Vector3(0, 0, -1),
        getAimDirection(out = null) {
            const target = out || new THREE.Vector3();
            return target.copy(this.aimDirection);
        },
        takeDamage(amount, options = {}) {
            if ((this.spawnProtectionTimer || 0) > 0) {
                return { applied: 0, absorbedByShield: 0, hpApplied: 0, remainingHp: this.hp, isDead: this.hp <= 0 };
            }
            return applyDamage(this, amount, { nowSeconds: 0, ...options }, this.entityRuntimeConfig);
        },
    };
}

function createWorld({
    mode = 'HUNT',
    arena = null,
    turrets = [],
    isFightOutcomeAuthority = true,
} = {}) {
    const config = mode === 'HUNT' ? HUNT_MODE_CONFIG : CLASSIC_MODE_CONFIG;
    const shooter = createPlayer(0, [0, 0, 0], config);
    const damageEvents = [];
    const kills = [];
    const entityManager = {
        players: [shooter],
        arena,
        isFightOutcomeAuthority,
        entityRuntimeConfig: config,
        gameModeStrategy: { hasMachineGun: () => mode === 'HUNT' },
        _staticTurretSystem: { getDestructibleTargets: () => turrets },
        _emitHuntDamageEvent(event) { damageEvents.push(event); },
        _killPlayer(player, cause, options = {}) {
            player.alive = false;
            kills.push({ player, cause, options });
        },
    };
    shooter.entityManager = entityManager;
    const system = new FlamethrowerSystem(entityManager);
    entityManager._flamethrowerSystem = system;
    return { config, entityManager, shooter, system, damageEvents, kills };
}

function addTarget(world, index, position) {
    const target = createPlayer(index, position, world.config);
    target.entityManager = world.entityManager;
    world.entityManager.players.push(target);
    return target;
}

function armFlamethrower(player) {
    applyPlayerPowerup(player, 'FLAMETHROWER');
    assert.equal(player.hasFlamethrower, true, 'the item arms the flamethrower');
    return player;
}

function blockingArena(sourceName = 'Wall_Block') {
    return {
        calls: 0,
        raycast(origin, direction, maxDistance) {
            this.calls += 1;
            return {
                hit: true,
                distance: Math.min(1, maxDistance),
                sourceName,
                point: { x: origin.x, y: origin.y, z: origin.z },
            };
        },
    };
}

test('flamethrower balancing values live in the hunt config', () => {
    assert.equal(HUNT_CONFIG.FLAMETHROWER.RANGE, 18);
    assert.equal(HUNT_CONFIG.FLAMETHROWER.CONE_DEGREES, 30, 'full opening angle');
    assert.equal(HUNT_CONFIG.FLAMETHROWER.DAMAGE_PER_SECOND, 30);
    assert.equal(HUNT_CONFIG.FLAMETHROWER.FUEL_SECONDS, 6);
});

test('the flame cone catches targets by distance, angle and hit radius', () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const direction = new THREE.Vector3(0, 0, -1);
    const scratch = new THREE.Vector3();
    const range = 18;
    const tanHalf = Math.tan((30 * 0.5 * Math.PI) / 180);
    const inCone = (x, z, radius = 0.8) => isInsideFlameCone(
        origin, direction, new THREE.Vector3(x, 0, z), radius, range, tanHalf, scratch,
    );

    assert.equal(inCone(0, -10), true, 'straight ahead and inside the range');
    assert.equal(inCone(0, -25), false, 'beyond the range');
    assert.equal(inCone(1, -10), true, 'slightly off axis stays inside');
    assert.equal(inCone(6, -10), false, 'far off axis is outside');
    assert.equal(inCone(0, 10), false, 'behind the shooter is never hit');
    // 10 units ahead the cone is 2.679 units wide; the centre at 3.2 is outside, the hull is not.
    assert.equal(inCone(3.2, -10, 0.8), true, 'the hit radius reaches into the cone');
    assert.equal(inCone(3.2, -10, 0), false, 'a point target at the same spot stays outside');
});

test('the cone damage is 30 per second at any frame rate', () => {
    for (const fps of [30, 60, 144]) {
        const world = createWorld();
        armFlamethrower(world.shooter);
        const target = addTarget(world, 1, [0, 0, -10]);
        const dt = 1 / fps;
        for (let frame = 0; frame < fps; frame += 1) world.system.fire(world.shooter, dt);
        const applied = 100 - target.hp;
        assert.ok(
            Math.abs(applied - 30) <= 1,
            `one second of contact at ${fps} fps burns 30 (+-1), got ${applied.toFixed(3)}`,
        );
    }
});

test('the flame spares the shooter, spawn protected targets and targets behind a wall', () => {
    const world = createWorld();
    armFlamethrower(world.shooter);
    const protectedTarget = addTarget(world, 1, [0, 0, -8]);
    protectedTarget.spawnProtectionTimer = 2;
    world.system.fire(world.shooter, 0.5);
    assert.equal(world.shooter.hp, 100, 'no self damage');
    assert.equal(protectedTarget.hp, 100, 'spawn protection holds against fire');

    const blocked = createWorld({ arena: blockingArena() });
    armFlamethrower(blocked.shooter);
    const hidden = addTarget(blocked, 1, [0, 0, -8]);
    blocked.system.fire(blocked.shooter, 0.5);
    assert.equal(hidden.hp, 100, 'map geometry between shooter and target stops the flame');
});

test('the flame burns the shield before the hull', () => {
    const world = createWorld();
    armFlamethrower(world.shooter);
    const target = addTarget(world, 1, [0, 0, -6]);
    target.hasShield = true;
    target.shieldHP = 40;

    world.system.fire(world.shooter, 1);
    assert.equal(target.hp, 100, 'the hull stays intact while the shield holds');
    assert.equal(target.shieldHP, 10, 'the shield takes the 30 damage');
});

test('the tank only drains while firing and ends the effect when it runs dry', () => {
    const world = createWorld();
    armFlamethrower(world.shooter);
    assert.equal(world.shooter.flameFuelSeconds, 6);

    world.system.fire(world.shooter, 1);
    assert.ok(Math.abs(world.shooter.flameFuelSeconds - 5) < 1e-6, 'one second of fire costs one second of fuel');

    for (let frame = 0; frame < 300; frame += 1) world.system.fire(world.shooter, 1 / 60);
    assert.equal(world.shooter.hasFlamethrower, false, 'the empty tank ends the effect');
    assert.equal(world.shooter.flameFuelSeconds, 0);
    assert.equal(
        world.shooter.activeEffects.some((effect) => effect?.type === 'FLAMETHROWER'),
        false,
        'the spent effect leaves activeEffects',
    );
    assert.equal(world.system.fire(world.shooter, 1 / 60), false, 'an empty tank hands the key back to the machine gun');
});

test('a held machine gun key fires the flame instead of the gun', () => {
    const world = createWorld();
    const mgShots = [];
    world.entityManager._shootHuntGun = (player) => {
        mgShots.push(player.index);
        return { ok: true };
    };
    const phase = new PlayerActionPhase(world.entityManager);
    const input = { shootMG: true, useItem: -1, shootItem: false, shootRocket: false, shootItemIndex: -1 };
    const strategy = world.entityManager.gameModeStrategy;

    phase.run(world.shooter, input, strategy, 1 / 60);
    assert.deepEqual(mgShots, [0], 'without a flamethrower the machine gun still fires');

    armFlamethrower(world.shooter);
    phase.run(world.shooter, input, strategy, 1 / 60);
    assert.deepEqual(mgShots, [0], 'the flamethrower swallows the machine gun shot');
    assert.ok(world.shooter.flameFuelSeconds < 6, 'the same tick drains the tank');
});

test('a kill by fire is booked for the shooter', () => {
    const world = createWorld();
    armFlamethrower(world.shooter);
    const target = addTarget(world, 1, [0, 0, -5]);
    target.hp = 10;

    world.system.fire(world.shooter, 0.5);
    assert.equal(target.alive, false, 'the target burns down');
    assert.equal(world.kills.length, 1);
    assert.equal(world.kills[0].options.killer, world.shooter, 'the kill goes to the shooter');
    assert.equal(world.damageEvents.length, 1);
    assert.equal(world.damageEvents[0].sourcePlayer, world.shooter);
    assert.equal(world.damageEvents[0].cause, 'FLAMETHROWER');
});

test('the flame damages foreign turrets but never the own one', () => {
    const hits = [];
    const makeTurret = (id, ownerIndex, z) => ({
        id,
        hp: 60,
        maxHp: 60,
        ownerIndex,
        destructible: true,
        deployed: true,
        position: new THREE.Vector3(0, 0, z),
        hitboxRadius: 2.2,
        takeDamage(amount, options = {}) {
            hits.push({ id, amount, cause: options.cause, source: options.sourcePlayer?.index });
            this.hp = Math.max(0, this.hp - amount);
        },
    });
    const own = makeTurret('own', 0, -4);
    const enemy = makeTurret('enemy', 1, -8);
    const world = createWorld({ turrets: [own, enemy] });
    armFlamethrower(world.shooter);

    world.system.fire(world.shooter, 1);
    assert.deepEqual(hits.map((entry) => entry.id), ['enemy'], 'only the enemy turret burns');
    assert.equal(hits[0].cause, 'FLAMETHROWER');
    assert.equal(hits[0].source, 0);
    assert.ok(Math.abs(hits[0].amount - 30) < 1e-6);
    assert.equal(own.hp, 60);
});

test('a replica neither burns nor drains, and without hunt health nobody is damaged', () => {
    const replica = createWorld({ isFightOutcomeAuthority: false });
    armFlamethrower(replica.shooter);
    const replicaTarget = addTarget(replica, 1, [0, 0, -6]);
    assert.equal(replica.system.fire(replica.shooter, 0.5), true, 'the replica still swallows the machine gun key');
    assert.equal(replicaTarget.hp, 100, 'the host books the damage');
    assert.equal(replica.shooter.flameFuelSeconds, 6, 'the host owns the tank');

    const classic = createWorld({ mode: 'CLASSIC' });
    armFlamethrower(classic.shooter);
    const classicTarget = addTarget(classic, 1, [0, 0, -6]);
    assert.equal(classic.system.fire(classic.shooter, 0.5), true);
    assert.equal(classicTarget.hp, 100, 'without hunt health the cone does no player damage');
    assert.ok(classic.shooter.flameFuelSeconds < 6, 'the tank still drains in classic');
});

test('a long burst reuses its scratch vectors', () => {
    const world = createWorld();
    armFlamethrower(world.shooter);
    addTarget(world, 1, [0, 0, -6]);
    world.system.fire(world.shooter, 1 / 60);
    const scratchBefore = Object.values(world.system).filter((value) => value instanceof THREE.Vector3);
    assert.ok(scratchBefore.length >= 3, 'the system keeps its own scratch vectors');
    const keysBefore = Object.keys(world.system).join(',');

    for (let frame = 0; frame < 200; frame += 1) world.system.fire(world.shooter, 1 / 60);

    const scratchAfter = Object.values(world.system).filter((value) => value instanceof THREE.Vector3);
    assert.equal(scratchAfter.length, scratchBefore.length);
    scratchAfter.forEach((vector, index) => {
        assert.equal(vector, scratchBefore[index], 'no tick replaces a scratch vector');
    });
    assert.equal(Object.keys(world.system).join(','), keysBefore, 'no tick adds state to the system');
});
