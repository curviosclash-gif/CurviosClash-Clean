import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    TEAM_COLORS,
    TEAM_IDS,
    TEAM_LABELS,
    TEAM_WEAPON_KINDS,
    canDamage,
    normalizeTeamId,
    resolveBalancedTeamId,
    resolveTeamColor,
    resolveTeamLabel,
} from '../src/shared/contracts/TeamCombatContract.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { getPreferredFightEnemy } from '../src/hunt/FightTargetSelector.js';
import { resolveItemProjectileTarget } from '../src/entities/systems/projectile/ItemProjectileTargetingOps.js';
import { serializePlayer } from '../src/core/GameStateSnapshot.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { resolveHuntLineTarget } from '../src/hunt/HuntTargetingOps.js';

function player(index, teamId, x = index * 5) {
    return {
        index,
        teamId,
        alive: true,
        hp: 100,
        maxHp: 100,
        position: { x, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
    };
}

test('team combat keeps legacy free-for-all actors hostile and applies the friendly-fire matrix', () => {
    const alpha = player(0, TEAM_IDS.ALPHA);
    const ally = player(1, TEAM_IDS.ALPHA);
    const bravo = player(2, TEAM_IDS.BRAVO);
    const legacy = player(3, null);

    assert.equal(normalizeTeamId('alpha'), TEAM_IDS.ALPHA);
    assert.equal(canDamage(alpha, ally, TEAM_WEAPON_KINDS.ROCKET), false);
    assert.equal(canDamage(alpha, ally, TEAM_WEAPON_KINDS.ITEM_PROJECTILE), false);
    assert.equal(canDamage(alpha, ally, TEAM_WEAPON_KINDS.MACHINE_GUN), true);
    assert.equal(canDamage(alpha, ally, TEAM_WEAPON_KINDS.TRAIL), true);
    assert.equal(canDamage(alpha, bravo, TEAM_WEAPON_KINDS.ROCKET), true);
    assert.equal(canDamage(alpha, legacy, TEAM_WEAPON_KINDS.ROCKET), true);
});

test('bot lock-on skips allied players and trails without disabling MG friendly fire', () => {
    const source = { ...player(0, TEAM_IDS.ALPHA), position: new THREE.Vector3(0, 0, 0) };
    const ally = { ...player(1, TEAM_IDS.ALPHA), position: new THREE.Vector3(5, 0, 0) };
    const trailEntry = {
        playerIndex: ally.index,
        segmentIdx: 0,
        fromX: 3,
        fromY: 0,
        fromZ: 0,
        toX: 4,
        toY: 0,
        toZ: 0,
    };
    const options = {
        sourcePlayer: source,
        players: [source, ally],
        trailSpatialIndex: {
            checkProjectileTrailCollision: () => ({ entry: trailEntry }),
        },
        origin: source.position,
        direction: new THREE.Vector3(1, 0, 0),
        playerRange: 10,
        trailRange: 10,
        trailSampleStep: 1,
    };
    assert.equal(resolveHuntLineTarget({ ...options, excludeTeammates: true }), null);
    assert.equal(resolveHuntLineTarget(options)?.kind, 'trail');
});

test('balanced team assignment alternates stable player slots', () => {
    assert.deepEqual(
        Array.from({ length: 6 }, (_, index) => resolveBalancedTeamId(index)),
        [TEAM_IDS.ALPHA, TEAM_IDS.BRAVO, TEAM_IDS.ALPHA, TEAM_IDS.BRAVO, TEAM_IDS.ALPHA, TEAM_IDS.BRAVO],
    );
});

test('team presentation reuses the two-player split-screen blue and orange identity', () => {
    assert.deepEqual(TEAM_COLORS, { ALPHA: 0x00aaff, BRAVO: 0xff8800 });
    assert.deepEqual(TEAM_LABELS, { ALPHA: 'Team Blau', BRAVO: 'Team Orange' });
    assert.equal(CONFIG_SECTIONS.COLORS.PLAYER_1, resolveTeamColor(TEAM_IDS.ALPHA));
    assert.equal(CONFIG_SECTIONS.COLORS.PLAYER_2, resolveTeamColor(TEAM_IDS.BRAVO));
    assert.equal(resolveTeamLabel(TEAM_IDS.ALPHA), 'Team Blau');
    assert.equal(resolveTeamLabel(TEAM_IDS.BRAVO), 'Team Orange');
    assert.equal(resolveTeamColor(null, 0x123456), 0x123456);
});

test('fight and item targeting skip teammates while preserving enemy selection', () => {
    const alpha = player(0, TEAM_IDS.ALPHA, 0);
    const ally = player(1, TEAM_IDS.ALPHA, 2);
    const bravo = player(2, TEAM_IDS.BRAVO, 8);
    const scratch = {
        x: 0, y: 0, z: 0,
        subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; },
        lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; },
        multiplyScalar(value) { this.x *= value; this.y *= value; this.z *= value; return this; },
    };

    assert.equal(getPreferredFightEnemy(alpha, [alpha, ally, bravo], scratch).enemy, bravo);
    assert.equal(resolveItemProjectileTarget({
        owner: alpha,
        players: [alpha, ally, bravo],
        origin: { x: 0, y: 0, z: 0, distanceToSquared: (target) => target.x ** 2 + target.y ** 2 + target.z ** 2 },
        direction: { dot: (vector) => vector.x },
        scratch,
        currentTarget: ally,
    }), bravo);
});

test('network player snapshots carry the normalized team id', () => {
    assert.equal(serializePlayer(player(4, TEAM_IDS.BRAVO)).teamId, TEAM_IDS.BRAVO);
    assert.equal(serializePlayer(player(5, 'invalid')).teamId, null);
});

test('rockets pass through teammates and still damage enemies', () => {
    const attacker = { index: 0, teamId: TEAM_IDS.ALPHA };
    const ally = {
        ...player(1, TEAM_IDS.ALPHA),
        position: new THREE.Vector3(0, 0, 0),
        hitboxRadius: 1,
        takeDamage() { throw new Error('teammate must not be damaged'); },
    };
    let enemyDamage = 0;
    const enemy = {
        ...player(2, TEAM_IDS.BRAVO),
        position: new THREE.Vector3(0, 0, 0),
        hitboxRadius: 1,
        takeDamage(amount) { enemyDamage += amount; return { isDead: false }; },
    };
    const projectile = {
        owner: attacker,
        type: 'ROCKET_GUIDED',
        radius: 0.5,
        position: new THREE.Vector3(0, 0, 0),
        previousPosition: new THREE.Vector3(0, 0, 0),
    };
    const resolver = new ProjectileHitResolver({
        _tmpVec: new THREE.Vector3(),
        onProjectileHit() {},
        onProjectilePowerup() {},
        onProjectileDamage() {},
    });

    assert.equal(resolver.resolveProjectileOutcome(projectile, [ally], null, {}), false);
    assert.equal(resolver.resolveProjectileOutcome(projectile, [ally, enemy], null, {}), true);
    assert.ok(enemyDamage > 0);
});

test('rockets pass through allied team-owned tanks before projectile consumption', () => {
    const attacker = { index: 0, teamId: TEAM_IDS.ALPHA };
    const alliedTank = {
        destructible: true,
        hp: 600,
        teamId: TEAM_IDS.ALPHA,
        position: new THREE.Vector3(),
        hitboxRadius: 2,
        takeDamage() { throw new Error('allied tank must not consume the rocket'); },
    };
    const enemyTank = {
        ...alliedTank,
        teamId: TEAM_IDS.BRAVO,
        takeDamage() { return { isDead: false }; },
    };
    const system = {
        _tmpVec: new THREE.Vector3(),
        getTurrets: () => [alliedTank],
        onProjectileHit() {},
    };
    const resolver = new ProjectileHitResolver(system);
    const projectile = {
        owner: attacker,
        type: 'ROCKET_GUIDED',
        radius: 0.5,
        position: new THREE.Vector3(),
        previousPosition: new THREE.Vector3(),
    };
    assert.equal(resolver._resolveTurretHit(projectile, []), false);
    assert.equal(projectile.detonated, undefined);
    system.getTurrets = () => [enemyTank];
    assert.equal(resolver._resolveTurretHit(projectile, []), true);
});

test('client reconciliation adopts the authoritative team id', () => {
    const local = { teamId: TEAM_IDS.ALPHA };
    new StateReconciler()._reconcileAuthoritativeFields(local, { teamId: TEAM_IDS.BRAVO });
    assert.equal(local.teamId, TEAM_IDS.BRAVO);
});
