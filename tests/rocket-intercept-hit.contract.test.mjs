import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

/**
 * Stands for a player: only the fields the hit resolution reads. `takeDamage` counts
 * calls, because the whole point of an intercept is that nobody nearby gets hurt.
 */
function createPlayer(index, position) {
    return {
        index,
        alive: true,
        isBot: false,
        hitboxRadius: 1,
        damageCalls: 0,
        position: position.clone(),
        getDirection(out) { return out.set(1, 0, 0); },
        getAimDirection(out) { return out.set(1, 0, 0); },
        takeDamage(amount) {
            this.damageCalls += 1;
            return { applied: amount, isDead: false };
        },
    };
}

function createInterceptWorld({ onRocketIntercepted } = {}) {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const defender = createPlayer(0, new THREE.Vector3(-40, 0, 0));
    const attacker = createPlayer(1, new THREE.Vector3(40, 0, 0));
    const players = [defender, attacker];
    const detonations = [];
    const system = new ProjectileSystem({
        entityRuntimeConfig,
        players,
        arena: null,
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
        onProjectileHit(position, _color, _owner, projectile) {
            detonations.push({ traversalId: projectile.traversalId, position: position.clone() });
        },
        onRocketIntercepted,
    });
    return { system, entityRuntimeConfig, players, defender, attacker, detonations };
}

/**
 * Puts a rocket at an exact spot with an exact velocity. `spawnExternalProjectile`
 * builds the mesh, the trail handle and the pooled state; the test overwrites only
 * the two numbers it cares about, so the geometry of each case stays readable.
 */
function spawnRocketAt(system, owner, position, velocity) {
    const direction = velocity.lengthSq() > 0 ? velocity.clone().normalize() : new THREE.Vector3(1, 0, 0);
    const projectile = system.spawnExternalProjectile({
        owner,
        type: 'ROCKET_WEAK',
        position: { x: position.x, y: position.y, z: position.z },
        direction: { x: direction.x, y: direction.y, z: direction.z },
    });
    assert.ok(projectile, 'the test rocket was spawned');
    projectile.position.copy(position);
    projectile.previousPosition.copy(position);
    projectile.velocity.copy(velocity);
    projectile.mesh?.position.copy(position);
    return projectile;
}

function markAsInterceptor(interceptor, target) {
    interceptor.isInterceptor = true;
    interceptor.interceptTargetId = target.traversalId;
}

test('an interceptor reaching its target destroys both rockets and reports the intercept', () => {
    const intercepts = [];
    const { system, defender, attacker, detonations } = createInterceptWorld({
        onRocketIntercepted(event) { intercepts.push(event); },
    });

    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
    const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    markAsInterceptor(interceptor, incoming);

    system.update(1 / 60);

    assert.equal(system.projectiles.length, 0, 'both rockets left the field');
    assert.equal(detonations.length, 2, 'both rockets detonated visibly');
    assert.equal(intercepts.length, 1, 'the intercept is reported exactly once');
    assert.equal(intercepts[0].defender, defender, 'the defending player is the interceptor owner');
    system.dispose();
});

test('an MG turret can remove a locked rocket through the shared intercept contract', () => {
    const intercepts = [];
    const { system, defender, attacker, detonations } = createInterceptWorld({
        onRocketIntercepted(event) { intercepts.push({ ...event, targetType: event.target?.type }); },
    });
    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(8, 0, 0), new THREE.Vector3(-45, 0, 0));

    assert.equal(system.interceptRocket(incoming, defender, { weapon: 'mg' }), true);

    assert.equal(system.projectiles.length, 0);
    assert.equal(detonations.length, 1);
    assert.equal(intercepts.length, 1);
    assert.equal(intercepts[0].defender, defender);
    assert.equal(intercepts[0].targetType, 'ROCKET_WEAK');
    system.dispose();
});

test('an external turret rocket can enter the existing interceptor flight path', () => {
    const { system, defender, attacker } = createInterceptWorld();
    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(20, 0, 0), new THREE.Vector3(-45, 0, 0));
    const interceptor = system.spawnExternalProjectile({
        owner: defender,
        type: 'ROCKET_WEAK',
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(1, 0, 0),
        interceptTargetId: incoming.traversalId,
    });

    assert.equal(interceptor.isInterceptor, true);
    assert.equal(interceptor.interceptTargetId, incoming.traversalId);
    assert.equal(interceptor.target, null);
    assert.equal(interceptor.ignoresTrails, true);
    system.dispose();
});

test('an intercept hurts nobody standing next to it', () => {
    const { system, defender, attacker, players } = createInterceptWorld();
    const bystander = createPlayer(2, new THREE.Vector3(2, 0, 6));
    players.push(bystander);

    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
    const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    markAsInterceptor(interceptor, incoming);

    system.update(1 / 60);

    assert.equal(system.projectiles.length, 0, 'both rockets left the field');
    assert.equal(bystander.damageCalls, 0, 'the bystander inside the blast radius stays unhurt');
    assert.equal(defender.damageCalls, 0, 'the defender stays unhurt');
    assert.equal(attacker.damageCalls, 0, 'the attacker stays unhurt');
    system.dispose();
});

test('an interceptor passing wide of its target keeps flying', () => {
    const intercepts = [];
    const { system, defender, attacker, detonations } = createInterceptWorld({
        onRocketIntercepted(event) { intercepts.push(event); },
    });

    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(4, 0, 5), new THREE.Vector3(-45, 0, 0));
    const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    markAsInterceptor(interceptor, incoming);

    system.update(1 / 60);

    assert.equal(system.projectiles.length, 2, 'a five unit gap is more than the three unit hit radius');
    assert.equal(detonations.length, 0, 'nothing detonated');
    assert.equal(intercepts.length, 0, 'nothing was reported');
    system.dispose();
});

test('two rockets crossing inside one long frame still meet', () => {
    const intercepts = [];
    const { system, defender, attacker } = createInterceptWorld({
        onRocketIntercepted(event) { intercepts.push(event); },
    });

    // 135 units per second over a 1/20 s frame is 6.75 units of travel each. Both paths
    // cross at (3.5, 0, 0), yet every start and end point is more than three units away
    // from the other rocket's path - only a real sweep can see this hit. The interceptor
    // is spawned first on purpose: the list is walked backwards, so the rocket it chases
    // moves first and both frame paths are complete when the intercept is resolved.
    const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(135, 0, 0));
    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(3.5, 0, -3.4), new THREE.Vector3(0, 0, 135));
    markAsInterceptor(interceptor, incoming);

    system.update(1 / 20);

    assert.equal(system.projectiles.length, 0, 'the crossing rockets destroyed each other');
    assert.equal(intercepts.length, 1, 'the intercept is reported exactly once');
    system.dispose();
});

for (const targetFirst of [true, false]) {
    test(`the intercept survives the list order (target spawned ${targetFirst ? 'first' : 'last'})`, () => {
        const intercepts = [];
        const { system, defender, attacker, detonations } = createInterceptWorld({
            onRocketIntercepted(event) { intercepts.push(event); },
        });

        const stepped = [];
        const simulationOps = system._simulationOps;
        const stepProjectile = simulationOps.stepProjectile.bind(simulationOps);
        simulationOps.stepProjectile = (projectile, ...rest) => {
            stepped.push(projectile);
            return stepProjectile(projectile, ...rest);
        };

        // A bystander rocket far away from everything proves the swap-remove of two
        // entries never skips an unrelated projectile and never steps it twice.
        const bystander = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 80), new THREE.Vector3(0, 0, 45));
        const incoming = targetFirst
            ? spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0))
            : null;
        const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
        const target = incoming
            || spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
        markAsInterceptor(interceptor, target);

        system.update(1 / 60);

        assert.deepEqual(system.projectiles, [bystander], 'only the unrelated rocket is left');
        assert.equal(detonations.length, 2, 'both rockets detonated visibly');
        assert.equal(intercepts.length, 1, 'the intercept is reported exactly once');
        assert.equal(stepped.filter((entry) => entry === bystander).length, 1, 'the bystander stepped once');
        assert.ok(stepped.filter((entry) => entry === interceptor).length <= 1, 'the interceptor stepped at most once');
        assert.ok(stepped.filter((entry) => entry === target).length <= 1, 'the target stepped at most once');
        system.dispose();
    });
}

test('a second interceptor on the same target turns back into a normal rocket', () => {
    const intercepts = [];
    const { system, defender, attacker, detonations } = createInterceptWorld({
        onRocketIntercepted(event) { intercepts.push(event); },
    });

    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
    const first = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    const second = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0.8), new THREE.Vector3(45, 0, 0));
    markAsInterceptor(first, incoming);
    markAsInterceptor(second, incoming);

    system.update(1 / 60);

    assert.equal(system.projectiles.length, 1, 'only one of the two defence rockets was used up');
    assert.equal(detonations.length, 2, 'exactly one pair detonated');
    assert.equal(intercepts.length, 1, 'the intercept is credited once, not twice');
    const survivor = system.projectiles[0];
    assert.equal(survivor.isInterceptor, false, 'the spare rocket flies on as a normal rocket');
    assert.equal(survivor.interceptTargetId, '', 'and no longer chases a gone rocket');
    system.dispose();
});

test('an interceptor hitting a wall explodes there and leaves its target flying', () => {
    const intercepts = [];
    const { system, defender, attacker, detonations } = createInterceptWorld({
        onRocketIntercepted(event) { intercepts.push(event); },
    });
    system.getArena = () => ({
        getCollisionInfo(position) {
            // A thin wall right in front of the interceptor only - the attacking
            // rocket starts behind it and must not run into the same stub.
            return position.x >= 0.5 && position.x <= 0.9
                ? { hit: true, kind: 'wall', normal: new THREE.Vector3(-1, 0, 0) }
                : null;
        },
    });

    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
    const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    markAsInterceptor(interceptor, incoming);

    system.update(1 / 60);

    assert.deepEqual(system.projectiles, [incoming], 'the attacking rocket keeps flying');
    assert.equal(detonations.length, 1, 'only the interceptor detonated');
    assert.equal(intercepts.length, 0, 'a wall hit is no intercept');
    system.dispose();
});

test('a trail stops an interceptor before it reaches its target', () => {
    const intercepts = [];
    const { system, defender, attacker, detonations } = createInterceptWorld({
        onRocketIntercepted(event) { intercepts.push(event); },
    });
    // A4: trails stop defence rockets too. The stub reports one segment hit and owns
    // nothing else, which is all the rocket blast needs to book an impact.
    system.getTrailSpatialIndex = () => ({
        checkProjectileTrailCollision(_position, _radius, options) {
            // Only the defender's own rocket runs into this trail; the rocket it chases
            // must stay untouched so the test really compares the two outcomes.
            if (options?.excludePlayerIndex !== 0) return null;
            return {
                entry: { playerIndex: 1, segmentIdx: 0, maxHp: 1, destroyed: false },
                closestPoint: { closestX: 0.5, closestY: 0, closestZ: 0 },
            };
        },
    });

    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
    const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    markAsInterceptor(interceptor, incoming);

    system.update(1 / 60);

    assert.equal(system.projectiles.includes(incoming), true, 'the attacking rocket keeps flying');
    assert.equal(detonations.length, 1, 'only the interceptor detonated');
    assert.equal(intercepts.length, 0, 'a trail hit is no intercept');
    system.dispose();
});

test('an interceptor ignores every rocket that is not its own target', () => {
    const intercepts = [];
    const { system, defender, attacker, detonations } = createInterceptWorld({
        onRocketIntercepted(event) { intercepts.push(event); },
    });

    const chased = spawnRocketAt(system, attacker, new THREE.Vector3(60, 0, 0), new THREE.Vector3(-45, 0, 0));
    const stranger = spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
    const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    markAsInterceptor(interceptor, chased);

    system.update(1 / 60);

    assert.equal(system.projectiles.length, 3, 'a rocket flying past is not shot down');
    assert.equal(system.projectiles.includes(stranger), true, 'the stranger survives');
    assert.equal(detonations.length, 0, 'nothing detonated');
    assert.equal(intercepts.length, 0, 'nothing was reported');
    system.dispose();
});

test('an intercept returns both rocket states to the pool exactly once', () => {
    const { system, defender, attacker } = createInterceptWorld();

    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
    const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    markAsInterceptor(interceptor, incoming);

    system.update(1 / 60);

    const pool = system._projectileStatePool;
    assert.equal(pool.length, 2, 'both states went back into the pool');
    assert.equal(new Set(pool).size, 2, 'and none of them twice');
    for (const state of [interceptor, incoming]) {
        assert.equal(state.owner, null, 'a released state keeps no owner');
        assert.equal(state.traversalId, '', 'a released state keeps no id');
        assert.equal(state.isInterceptor, false, 'a released state is no interceptor');
        assert.equal(state.interceptTargetId, '', 'a released state chases nothing');
    }
    system.dispose();
});

test('a network replica never resolves an intercept of its own', () => {
    const intercepts = [];
    const { system, defender, attacker, detonations } = createInterceptWorld({
        onRocketIntercepted(event) { intercepts.push(event); },
    });

    const incoming = spawnRocketAt(system, attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
    const interceptor = spawnRocketAt(system, defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    markAsInterceptor(interceptor, incoming);
    system.setNetworkReplica(true);

    system.update(1 / 60);

    assert.equal(system.projectiles.length, 2, 'the host decides, the replica only shows');
    assert.equal(detonations.length, 0, 'the replica detonates nothing on its own');
    assert.equal(intercepts.length, 0, 'the replica reports nothing');
    system.dispose();
});
