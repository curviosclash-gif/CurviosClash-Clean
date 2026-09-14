import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { createStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { applyHuntNetworkState, createHuntNetworkState } from '../src/hunt/HuntNetworkState.js';
import { resolveRocketTierDamage } from '../src/hunt/RocketPickupSystem.js';
import { MAP_DESTRUCTIBLE_DAMAGE } from '../src/shared/contracts/MapDestructibleContract.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { resolveFightMachineGunConfig } from '../src/shared/contracts/FightMachineGunContract.js';

const DESTRUCTIBLES = {
    segments: [
        { id: 'leg_a', label: 'Bein A', kind: 'leg_lower', hp: 500, meshPrefixes: ['Tower_Leg_A'], anchor: [10, 0, 10] },
        { id: 'shaft', label: 'Schaft', kind: 'shaft', hp: 40, meshPrefixes: ['Tower_Shaft'] },
    ],
};

// The four lower legs of an intact tower all export under the same mesh names, so only the
// anchor - the foot of the leg in authored units - tells them apart.
const FOUR_LEG_DESTRUCTIBLES = {
    segments: [
        { id: 'leg_mm', label: 'Bein SW', kind: 'leg_lower', hp: 200, meshPrefixes: ['legs_lower'], anchor: [-20, 0, -20] },
        { id: 'leg_mp', label: 'Bein NW', kind: 'leg_lower', hp: 200, meshPrefixes: ['legs_lower'], anchor: [-20, 0, 20] },
        { id: 'leg_pm', label: 'Bein SO', kind: 'leg_lower', hp: 200, meshPrefixes: ['legs_lower'], anchor: [20, 0, -20] },
        { id: 'leg_pp', label: 'Bein NO', kind: 'leg_lower', hp: 200, meshPrefixes: ['legs_lower'], anchor: [20, 0, 20] },
    ],
};

function createDestructibleSystem({ elapsedSeconds = 7, destructibles = DESTRUCTIBLES } = {}) {
    const sceneCalls = [];
    const entityManager = {
        arena: {
            currentMapDefinition: { destructibles },
            glbAnimationElapsedSeconds: elapsedSeconds,
            sceneCalls,
            sceneResets: 0,
            applyMapDestructibleEvents(events) {
                sceneCalls.push(events.map((event) => event.segmentId));
            },
            resetMapDestructibleScenes() {
                this.sceneResets += 1;
            },
        },
        breaks: [],
    };
    entityManager.onMapDestructibleBreak = (event, context) => {
        entityManager.breaks.push({ event, context });
    };
    const system = new MapDestructibleSystem(entityManager);
    assert.equal(system.startRound(), destructibles.segments.length);
    return { entityManager, system };
}

function segmentHp(system, id) {
    return system.getState().segments.find((segment) => segment.id === id)?.hp;
}

function createRocketOutcome(sourceName, {
    bouncedOnFoam = false,
    type = 'ROCKET_MEDIUM',
    environmentProjectile = false,
    destructibles = DESTRUCTIBLES,
    impactPoint = [5, 2, 0],
} = {}) {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const detonations = [];
    const projectileSystem = new ProjectileSystem({
        entityRuntimeConfig,
        players: [],
        arena: null,
        onProjectileHit: (position, color, owner, projectile) => detonations.push(projectile?.type || ''),
    });
    const { entityManager, system } = createDestructibleSystem({ destructibles });
    projectileSystem.setMapDestructibleSystem(system);

    const owner = { index: 0, alive: true, isBot: false, position: new THREE.Vector3() };
    const projectile = {
        type,
        owner,
        environmentProjectile,
        detonated: false,
        radius: 0.5,
        position: new THREE.Vector3(impactPoint[0], impactPoint[1], impactPoint[2]),
        previousPosition: new THREE.Vector3(impactPoint[0] - 1, impactPoint[1], impactPoint[2]),
        velocity: new THREE.Vector3(0, 0, -30),
        ttl: 1,
        traveled: 0,
    };
    const simulationResult = {
        projectileExpired: false,
        projectileHitArena: true,
        bouncedOnFoam,
        arenaCollision: { hit: true, kind: bouncedOnFoam ? 'foam' : 'hard', sourceName },
    };
    const removed = projectileSystem._hitResolver.resolveProjectileOutcome(projectile, [], null, simulationResult);
    return { detonations, entityManager, entityRuntimeConfig, projectile, removed, system, type };
}

test('a rocket hitting a tower mesh damages that segment and still detonates', () => {
    const { detonations, entityRuntimeConfig, removed, system, type } = createRocketOutcome('Tower_Shaft_Mid_03');

    assert.equal(removed, true);
    assert.deepEqual(detonations, [type]);
    const expected = resolveRocketTierDamage(type, { entityRuntimeConfig });
    assert.ok(expected > 0);
    assert.equal(segmentHp(system, 'shaft'), Math.max(0, 40 - expected));
    assert.equal(system.getState().segments[1].destroyed, expected >= 40);
    // Damage never leaks into a segment the shot did not touch.
    assert.equal(segmentHp(system, 'leg_a'), 500);

    // A weaker tier books less; the tiers stay the single source of rocket damage.
    const weak = createRocketOutcome('Tower_Shaft_Mid_03', { type: 'ROCKET_WEAK' });
    const weakDamage = resolveRocketTierDamage('ROCKET_WEAK', { entityRuntimeConfig });
    assert.equal(segmentHp(weak.system, 'shaft'), Math.max(0, 40 - weakDamage));
});

test('a rocket on an intact tower damages the leg it actually struck', () => {
    // Every leg answers to `legs_lower`; only where the rocket stopped tells them apart.
    const hit = createRocketOutcome('legs_lower_iron_003', {
        destructibles: FOUR_LEG_DESTRUCTIBLES,
        impactPoint: [18, 34, 22],
    });
    const damage = resolveRocketTierDamage('ROCKET_MEDIUM', { entityRuntimeConfig: hit.entityRuntimeConfig });
    assert.ok(damage > 0);

    assert.equal(segmentHp(hit.system, 'leg_pp'), 200 - damage);
    for (const id of ['leg_mm', 'leg_mp', 'leg_pm']) {
        assert.equal(segmentHp(hit.system, id), 200, `${id} must stay whole`);
    }

    // The opposite corner of the very same mesh books on the opposite leg.
    const opposite = createRocketOutcome('legs_lower_irondark', {
        destructibles: FOUR_LEG_DESTRUCTIBLES,
        impactPoint: [-24, 8, -19],
    });
    assert.equal(segmentHp(opposite.system, 'leg_mm'), 200 - damage);
    assert.equal(segmentHp(opposite.system, 'leg_pp'), 200);
});

test('a foam bounce and a mesh outside the tower leave every segment untouched', () => {
    const bounced = createRocketOutcome('Tower_Shaft_Mid_03', { bouncedOnFoam: true });
    assert.equal(segmentHp(bounced.system, 'shaft'), 40);

    const elsewhere = createRocketOutcome('ground_plane');
    assert.equal(segmentHp(elsewhere.system, 'shaft'), 40);
    assert.equal(elsewhere.removed, true);

    // A non-rocket projectile flies through the same impact without touching the tower.
    const item = createRocketOutcome('Tower_Shaft_Mid_03', { type: 'SLOW_DOWN' });
    assert.equal(segmentHp(item.system, 'shaft'), 40);
});

test('static turret fire leaves the map standing', () => {
    // Environment projectiles are excluded from the rocket explosion too: only what a player
    // aimed at the tower may bring it down.
    const turretShot = createRocketOutcome('Tower_Shaft_Mid_03', { environmentProjectile: true });
    assert.equal(turretShot.removed, true);
    assert.equal(segmentHp(turretShot.system, 'shaft'), 40);

    // The very same impact from a player rocket does book damage.
    const playerShot = createRocketOutcome('Tower_Shaft_Mid_03');
    assert.ok(segmentHp(playerShot.system, 'shaft') < 40);
});

test('a destroyed segment reports its break once and seals the tower for a lower leg', () => {
    const { entityManager, system } = createDestructibleSystem({ elapsedSeconds: 21.5 });

    const shaftBreak = system.applyMeshHit('tower_shaft_top', 40, { hitDirection: { x: -1, y: 0, z: 0 } });
    assert.equal(shaftBreak?.destroyed, true);
    assert.equal(shaftBreak?.event?.atSeconds, 21.5);
    assert.equal(shaftBreak?.event?.yaw, -Math.PI / 2);
    assert.equal(entityManager.breaks.length, 1);
    assert.equal(entityManager.breaks[0].context.cause, null);

    const legBreak = system.applyMeshHit('Tower_Leg_A_01', 500, { cause: 'MG_BULLET' });
    assert.equal(legBreak?.event?.kind, 'leg_lower');
    // The leg stands at (10, 10), and the tower comes down onto it rather than along the shot.
    assert.equal(legBreak?.event?.yaw, Math.PI / 4);
    assert.equal(system.getState().sealed, true);
    assert.equal(entityManager.breaks.length, 2);

    // Sealed: nothing else can be damaged any more.
    assert.equal(system.applyMeshHit('tower_shaft_top', 10), null);
    assert.equal(system.getHudState().sealed, true);
    assert.equal(system.getHudState().segments.length, 2);

    system.clear();
    assert.equal(system.isActive(), false);
    assert.equal(system.applyMeshHit('Tower_Leg_A_01', 10), null);
    assert.equal(system.serializeNetworkState(), null);
});

test('a scaled map measures hits against the anchors it was built with', () => {
    // Two legs on the same axis: at map scale 3 their feet stand at 30 and 90 instead of 10
    // and 30, so one and the same impact at x = 40 belongs to the other one of them.
    const axisLegs = {
        segments: [
            { id: 'inner', kind: 'leg_lower', hp: 100, meshPrefixes: ['legs_lower'], anchor: [10, 0, 0] },
            { id: 'outer', kind: 'leg_lower', hp: 100, meshPrefixes: ['legs_lower'], anchor: [30, 0, 0] },
        ],
    };
    const createSystem = (scaleAuthoredAnchors) => {
        const system = new MapDestructibleSystem({
            entityRuntimeConfig: { ARENA: { MAP_SCALE: 3 } },
            arena: {
                currentMapDefinition: { scaleAuthoredAnchors, destructibles: axisLegs },
                glbAnimationElapsedSeconds: 2,
            },
        });
        system.startRound();
        system.applyMeshHit('legs_lower_iron', 10, { hitPoint: { x: 40, y: 0, z: 0 } });
        return system;
    };

    const scaled = createSystem(true);
    assert.equal(scaled.anchorScale, 3);
    assert.equal(segmentHp(scaled, 'inner'), 90);
    assert.equal(segmentHp(scaled, 'outer'), 100);

    const unscaled = createSystem(false);
    assert.equal(unscaled.anchorScale, 1);
    assert.equal(segmentHp(unscaled, 'outer'), 90);
    assert.equal(segmentHp(unscaled, 'inner'), 100);

    unscaled.clear();
    assert.equal(unscaled.anchorScale, 1);
});

test('a replica books no damage of its own', () => {
    const { system } = createDestructibleSystem();
    system.setNetworkReplica(true);
    assert.equal(system.applyMeshHit('Tower_Shaft_01', 10), null);
    assert.equal(segmentHp(system, 'shaft'), 40);

    system.setNetworkReplica(false);
    assert.equal(system.applyMeshHit('Tower_Shaft_01', 10)?.applied, true);
    assert.equal(segmentHp(system, 'shaft'), 30);
});

function createMgFixture({
    wallDistance = 20,
    sourceName = 'Tower_Shaft_Lower',
    destructibleMap = DESTRUCTIBLES,
} = {}) {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 40, 40));
    wallMesh.position.set(wallDistance, 0, 0);
    wallMesh.updateMatrixWorld(true);
    const obstacles = [{
        box: new THREE.Box3().setFromObject(wallMesh),
        isWall: false,
        kind: 'hard',
        meshCollider: createStaticMeshCollider(wallMesh),
        sourceName,
    }];
    const collision = new ArenaCollision({
        bounds: { minX: -500, maxX: 500, minY: -500, maxY: 500, minZ: -500, maxZ: 500 },
        obstacles,
    });
    const arena = {
        currentMapDefinition: { destructibles: destructibleMap },
        glbAnimationElapsedSeconds: 3,
        raycast: (origin, direction, maxDistance) => collision.raycast(origin, direction, maxDistance),
    };

    const shooter = {
        index: 0,
        alive: true,
        isBot: false,
        position: new THREE.Vector3(0, 0, 0),
        quaternion: new THREE.Quaternion(),
        activeEffects: [],
        shootCooldown: 0,
        hitboxRadius: 1,
        getAimDirection: (out) => out.set(1, 0, 0),
    };
    const victim = {
        index: 1,
        alive: true,
        isBot: true,
        position: new THREE.Vector3(60, 0, 0),
        hitboxRadius: 2,
        hp: 100,
        takeDamage(amount) {
            this.hp -= amount;
            return { applied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
    const entityManager = {
        entityRuntimeConfig,
        arena,
        players: [shooter, victim],
        gameModeStrategy: { hasMachineGun: () => true },
    };
    const destructibles = new MapDestructibleSystem(entityManager);
    destructibles.startRound();
    // The gun reaches the tower through the public accessor, exactly like the rocket path does.
    entityManager._mapDestructibleSystem = destructibles;
    entityManager.getMapDestructibleSystem = () => entityManager._mapDestructibleSystem;

    const gun = new OverheatGunSystem(entityManager);
    return { destructibles, entityManager, gun, shooter, victim };
}

test('the machine gun stops at map geometry and damages the segment behind the mesh name', () => {
    const { destructibles, gun, shooter, victim } = createMgFixture();

    const result = gun.tryFire(shooter);

    assert.equal(result.ok, true);
    assert.equal(result.hit, false, 'the bullet must not reach the player behind the wall');
    assert.equal(result.hitCount, 1);
    assert.equal(victim.hp, 100);
    assert.equal(segmentHp(destructibles, 'shaft'), 40 - MAP_DESTRUCTIBLE_DAMAGE.MG);
});

test('the machine gun hands the ray hit point on to the tower', () => {
    // The wall stands from x=18 to x=22, so the pellet stops at (18, 0, 0). The nearer leg is
    // declared second: without the hit point the first one would take the damage.
    const { destructibles, gun, shooter } = createMgFixture({
        sourceName: 'legs_lower_iron',
        destructibleMap: {
            segments: [
                { id: 'leg_far', kind: 'leg_lower', hp: 50, meshPrefixes: ['legs_lower'], anchor: [20, 0, 60] },
                { id: 'leg_near', kind: 'leg_lower', hp: 50, meshPrefixes: ['legs_lower'], anchor: [20, 0, 0] },
            ],
        },
    });

    const point = gun._hitResolver.resolveHit(shooter, { RANGE: 95 }, new THREE.Vector3(), new THREE.Vector3())?.point;
    assert.ok(point, 'the resolver must report where the ray stopped');
    assert.ok(Math.abs(point.x - 18) < 0.001, `hit point x ${point.x}`);

    const result = gun.tryFire(shooter);
    assert.equal(result.hitCount, 1);
    assert.equal(segmentHp(destructibles, 'leg_near'), 50 - MAP_DESTRUCTIBLE_DAMAGE.MG);
    assert.equal(segmentHp(destructibles, 'leg_far'), 50);
});

test('a wall that belongs to no segment still stops the shot but takes no damage', () => {
    const { destructibles, gun, shooter, victim } = createMgFixture({ sourceName: 'plain_rock' });

    const result = gun.tryFire(shooter);

    assert.equal(result.hit, false);
    assert.equal(result.hitCount, 0);
    assert.equal(victim.hp, 100);
    assert.equal(segmentHp(destructibles, 'shaft'), 40);
});

test('a wall behind the target never steals the shot', () => {
    // Wall at 70, victim at 60, range 95: the ray is capped at the target, so the wall is
    // out of reach even though it stands well inside the weapon's range.
    const { destructibles, entityManager, gun, shooter, victim } = createMgFixture({ wallDistance: 70 });
    const mg = resolveFightMachineGunConfig(entityManager.entityRuntimeConfig.HUNT.MG);
    assert.ok(Number(mg.RANGE || 95) > 70, 'the wall must lie inside the weapon range');

    const hitResult = gun._hitResolver.resolveHit(shooter, mg, new THREE.Vector3(), new THREE.Vector3());
    assert.equal(hitResult.arena, undefined, 'no arena result may be reported behind the target');
    assert.ok(hitResult.target, 'the target must still be found');
    assert.ok(hitResult.distance < 70, `distance ${hitResult.distance}`);

    const result = gun.tryFire(shooter);
    assert.equal(result.hit, true);
    assert.ok(victim.hp < 100, `victim hp ${victim.hp}`);
    assert.equal(segmentHp(destructibles, 'shaft'), 40, 'the tower behind the target stays whole');
});

test('without map geometry in the way the machine gun reaches its target again', () => {
    const { gun, shooter, victim } = createMgFixture({ wallDistance: 200 });

    const result = gun.tryFire(shooter);

    assert.equal(result.hit, true);
    assert.ok(victim.hp < 100, `victim hp ${victim.hp}`);
});

test('a replica machine gun leaves the tower alone', () => {
    const { destructibles, gun, shooter } = createMgFixture();
    destructibles.setNetworkReplica(true);

    const result = gun.tryFire(shooter);

    assert.equal(result.hitCount, 0);
    assert.equal(segmentHp(destructibles, 'shaft'), 40);
});

test('the mg hit resolver reports no arena block when the arena cannot answer rays', () => {
    const resolver = new MGHitResolver({ players: [] });
    assert.equal(resolver._resolveArenaHit({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10), null);
    assert.equal(
        new MGHitResolver({ arena: { raycast: () => ({ hit: false }) } })
            ._resolveArenaHit({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10),
        null,
    );
});

test('the tower state travels to a replica through the hunt network state', () => {
    const host = createDestructibleSystem().system;
    host.applyMeshHit('Tower_Shaft_Top', 15, { hitDirection: { x: 0, y: 0, z: 1 } });
    host.applyMeshHit('Tower_Leg_A_Base', 500);

    const hostManager = {
        huntEnabled: true,
        players: [],
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
        _mapDestructibleSystem: host,
        _roundOutcomeSystem: { getDeathmatchState: () => ({}) },
        _huntScoring: { getScoreboard: () => [] },
        _lastRoundOutcome: null,
    };
    const state = JSON.parse(JSON.stringify(createHuntNetworkState(hostManager)));
    assert.ok(state.mapDestructibles, 'the hunt state must carry the tower');

    const replica = createDestructibleSystem().system;
    replica.setNetworkReplica(true);
    applyHuntNetworkState({
        players: [],
        _huntScoring: { applyScoreboard: () => {} },
        _mapDestructibleSystem: replica,
    }, state);

    assert.deepEqual(replica.serializeNetworkState(), host.serializeNetworkState());
    assert.equal(replica.getState().sealed, true);
    assert.equal(replica.getState().events.length, 1);
    assert.equal(segmentHp(replica, 'shaft'), 25);
});

test('every break reaches the arena, on the host and on a replica alike', () => {
    const hostFixture = createDestructibleSystem({ elapsedSeconds: 3 });
    // startRound puts a reused arena back together before the first shot is fired.
    assert.equal(hostFixture.entityManager.arena.sceneResets, 1);

    hostFixture.system.applyMeshHit('Tower_Shaft_Top', 40, { hitDirection: { x: 0, z: 1 } });
    hostFixture.system.applyMeshHit('Tower_Leg_A_Base', 500);
    // Partial damage changes nothing on screen, so only the two breaks are handed over.
    assert.deepEqual(hostFixture.entityManager.arena.sceneCalls, [['shaft'], ['shaft', 'leg_a']]);

    const replicaFixture = createDestructibleSystem();
    replicaFixture.system.setNetworkReplica(true);
    replicaFixture.system.applyNetworkState(hostFixture.system.serializeNetworkState());

    // The replica never books damage of its own; the host's events are what drives its tower.
    assert.deepEqual(replicaFixture.entityManager.arena.sceneCalls, [['shaft', 'leg_a']]);
    assert.equal(replicaFixture.system.applyNetworkState(null), replicaFixture.system.getState());
    assert.equal(replicaFixture.entityManager.arena.sceneCalls.length, 1);

    // A host snapshot arrives many times a second. An unchanged event list is not handed over
    // again, so the arena does not rebuild the same collapse on every packet.
    for (let tick = 0; tick < 20; tick += 1) {
        replicaFixture.system.applyNetworkState(hostFixture.system.serializeNetworkState());
    }
    assert.equal(replicaFixture.entityManager.arena.sceneCalls.length, 1);

    // A break that really is new still gets through.
    hostFixture.system.clear();
    hostFixture.system.startRound();
    hostFixture.system.applyMeshHit('Tower_Shaft_Top', 40, { hitDirection: { x: 1, z: 0 } });
    replicaFixture.system.applyNetworkState(hostFixture.system.serializeNetworkState());
    assert.deepEqual(replicaFixture.entityManager.arena.sceneCalls, [['shaft', 'leg_a'], ['shaft']]);

    // The round start clears the memory, so the same events are handed over again afterwards.
    replicaFixture.system.startRound();
    replicaFixture.system.applyNetworkState(hostFixture.system.serializeNetworkState());
    assert.equal(replicaFixture.entityManager.arena.sceneCalls.length, 3);
    assert.equal(replicaFixture.entityManager.arena.sceneResets, 2);
});

test('a map destructible in one mode only stays whole in every other', () => {
    // The Eiffel siege is shot apart in the hunt and flown as intact iron everywhere else. The
    // map itself stays playable in every mode - only its destructible parts are not installed.
    const huntOnly = {
        gameModes: ['HUNT'],
        segments: [{ id: 'shaft', label: 'Schaft', kind: 'shaft', hp: 40, meshPrefixes: ['Tower_Shaft'] }],
    };
    const createSystem = (modeType) => {
        const system = new MapDestructibleSystem({
            gameModeStrategy: modeType ? { modeType } : null,
            arena: {
                currentMapDefinition: { destructibles: huntOnly },
                glbAnimationElapsedSeconds: 1,
            },
        });
        return { count: system.startRound(), system };
    };

    for (const modeType of ['HUNT', 'hunt']) {
        const hunt = createSystem(modeType);
        assert.equal(hunt.count, 1, `${modeType} installs the tower`);
        assert.equal(hunt.system.isActive(), true);
        assert.equal(hunt.system.applyMeshHit('Tower_Shaft_01', 10)?.applied, true);
        assert.equal(segmentHp(hunt.system, 'shaft'), 30);
    }

    for (const modeType of ['CLASSIC', 'ARCADE', '']) {
        const other = createSystem(modeType);
        assert.equal(other.count, 0, `${modeType || 'no mode'} installs nothing`);
        assert.equal(other.system.isActive(), false);
        assert.equal(other.system.getDefinition(), null);
        assert.equal(other.system.applyMeshHit('Tower_Shaft_01', 10), null);
        assert.equal(other.system.serializeNetworkState(), null);
    }
});

test('a map without destructibles keeps the hunt state and every weapon path quiet', () => {
    const system = new MapDestructibleSystem({ arena: { currentMapDefinition: {} } });
    assert.equal(system.startRound(), 0);
    assert.equal(system.isActive(), false);
    assert.equal(system.getDefinition(), null);
    assert.equal(system.applyMeshHit('Tower_Shaft_01', 10), null);
    assert.equal(system.serializeNetworkState(), null);
    assert.deepEqual(system.getHudState(), {
        active: false,
        sealed: false,
        focusSegment: null,
        breakingSecondsRemaining: 0,
        segments: [],
    });
    assert.equal(system.applyNetworkState(null), system.getState());
    assert.equal(new MapDestructibleSystem(null).startRound(), 0);
    assert.equal(new MapDestructibleSystem(null).getElapsedSeconds(), 0);
});
