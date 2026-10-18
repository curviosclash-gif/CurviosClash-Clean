import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG_BASE_DATA } from '../src/core/config/maps/MapPresetCatalogBaseData.js';
import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { normalizeMapUnit } from '../src/shared/contracts/MapUnitContract.js';
import { sanitizeMapUnitList, toRuntimeMapUnits } from '../src/entities/mapSchema/MapSchemaMapUnitOps.js';

const CREATURE = {
    id: 'giant_worm', kind: 'creature', path: [[-10, 0, 0], [10, 0, 0]], speed: 5,
};

function createPlayer(index, protectedPlayer = false) {
    return {
        index, alive: true, hp: 100, maxHp: 100,
        spawnProtectionTimer: protectedPlayer ? 1 : 0,
        position: new THREE.Vector3(0, 2.5, 0),
        takeDamage(amount) {
            this.hp -= amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
}

function createWorld({ renderer = null } = {}) {
    const target = createPlayer(0);
    const protectedTarget = createPlayer(1, true);
    const loot = [];
    const scored = [];
    const explosions = [];
    const manager = {
        renderer,
        isFightOutcomeAuthority: true,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { bounds: { min: { y: 0 } }, currentMapDefinition: { mapUnits: [CREATURE] } },
        players: [target, protectedTarget], humanPlayers: [target],
        powerupManager: { spawnAtAnchor: (entry) => loot.push(entry) },
        particles: { spawnExplosion: (position) => explosions.push(position.clone()), spawnHit() {} },
        _huntScoring: { registerUnitDestroyed: (index, kind) => scored.push({ index, kind }) },
        _emitHuntDamageEvent() {}, _killPlayer() {}, _notifyPlayerFeedback() {},
    };
    const system = new MapUnitSystem(manager);
    manager._mapUnitSystem = system;
    system.startRound();
    return { system, worm: system.units[0], target, protectedTarget, loot, scored, explosions };
}

test('creature defaults define the giant worm balance and survive scaling', () => {
    const unit = normalizeMapUnit(CREATURE);
    assert.equal(unit.kind, 'creature');
    assert.equal(unit.maxHp, 600);
    assert.equal(unit.respawnSeconds, 90);
    assert.deepEqual(unit.attack, { damage: 30, cooldown: 4, radius: 20 });
    const scaled = normalizeMapUnit({ ...CREATURE, attack: { radius: 12 } }, 0, undefined, { preserveSpatial: true });
    assert.equal(scaled.attack.radius, 12);
    const saved = sanitizeMapUnitList([{ ...CREATURE, attack: { radius: 12 } }]);
    assert.equal(saved[0].attack.radius, 12);
    assert.equal(toRuntimeMapUnits(saved, 0.5)[0].attack.radius, 6);
});

test('the giant worm moves, attacks every four seconds and respects spawn protection', () => {
    const { system, worm, target, protectedTarget } = createWorld();
    const startX = worm.position.x;
    system.update(3.9);
    assert.notEqual(worm.position.x, startX);
    assert.equal(target.hp, 100);
    system.update(0.1);
    assert.equal(target.hp, 70);
    assert.equal(protectedTarget.hp, 100);
    assert.equal(worm.attacksFired, 1);
});

test('the worm is targetable, drops loot, credits 100-XP kind and returns after ninety seconds', () => {
    const { system, worm, target, protectedTarget, loot, scored } = createWorld();
    target.position.set(100, 0, 100);
    protectedTarget.position.set(100, 0, 100);
    const shooter = { index: 4, isBot: false };
    assert.equal(system.getTargets().includes(worm), true);
    worm.takeDamage(600, { sourcePlayer: shooter });
    assert.equal(worm.alive, false);
    assert.equal(loot.length, 1);
    assert.deepEqual(scored, [{ index: 4, kind: 'creature' }]);
    system.update(89.9);
    assert.equal(worm.alive, false);
    system.update(0.1);
    assert.equal(worm.alive, true);
    assert.equal(worm.hp, 600);
});

test('network replicas receive creature pose, hp and attack count without attacking', () => {
    const host = createWorld();
    const client = createWorld();
    host.system.update(4);
    client.system.applyNetworkState(host.system.serializeNetworkState());
    assert.equal(client.worm.attacksFired, 1);
    assert.equal(client.worm.position.x, host.worm.position.x);
    const hp = client.target.hp;
    client.system.update(4);
    assert.equal(client.target.hp, hp);
    host.system.update(4);
    client.system.applyNetworkState(host.system.serializeNetworkState());
    assert.equal(client.worm.attacksFired, 2);
    assert.equal(client.explosions.length, 1, 'later attacks replay one visual pulse');
});

test('standard arena places the first giant worm on a clear in-bounds ground route', () => {
    const map = MAP_PRESET_CATALOG_BASE_DATA.standard;
    const worm = map.mapUnits.find((unit) => unit.kind === 'creature');
    assert.ok(worm);
    assert.equal(worm.id, 'standard_giant_worm');
    // The runtime scales a unit only on maps that scale their anchors (resolveAuthoredAnchorScale), so
    // this path counts in world units; the obstacles and the arena size are always built x MAP_SCALE.
    const unitScale = map.scaleAuthoredAnchors === true ? CONFIG.ARENA.MAP_SCALE : 1;
    const blockers = (path, hitboxRadius) => path.flatMap(([x, y, z]) => {
        const found = [];
        if (Math.abs(x) > (map.size[0] * CONFIG.ARENA.MAP_SCALE) / 2 - hitboxRadius
            || Math.abs(z) > (map.size[2] * CONFIG.ARENA.MAP_SCALE) / 2 - hitboxRadius) found.push('arena wall');
        if (y !== 0) found.push('not on the ground');
        for (const obstacle of map.obstacles) {
            const halfX = (obstacle.size[0] * CONFIG.ARENA.MAP_SCALE) / 2 + hitboxRadius;
            const halfZ = (obstacle.size[2] * CONFIG.ARENA.MAP_SCALE) / 2 + hitboxRadius;
            if (Math.abs(x - obstacle.pos[0] * CONFIG.ARENA.MAP_SCALE) < halfX
                && Math.abs(z - obstacle.pos[2] * CONFIG.ARENA.MAP_SCALE) < halfZ) found.push(`obstacle at ${obstacle.pos}`);
        }
        return found;
    });
    const path = worm.path.map((point) => point.map((value) => value * unitScale));
    assert.deepEqual(blockers(path, worm.hitboxRadius * unitScale), []);
    // The check itself: a route through the 12 unit centre pillar was waved through in map units.
    assert.deepEqual(blockers([[10, 0, -10]], worm.hitboxRadius * unitScale), ['obstacle at 0,5,0']);
});
test('the renderer builds one segmented worm visual and clears it on restart', () => {
    const roots = [];
    const renderer = { addToScene: (root) => roots.push(root), removeFromScene() {} };
    const { system, worm } = createWorld({ renderer });
    assert.equal(worm.root.userData.creature, true);
    assert.equal(worm.root.userData.wormVisual, true);
    assert.equal(worm.root.userData.face.userData.creatureFace, true);
    assert.equal(worm.root.userData.face.children.filter((child) => child.name === 'worm-eye').length, 2);
    assert.equal(worm.root.userData.face.children.filter((child) => child.name === 'worm-pupil').length, 2);
    assert.ok(worm.root.userData.face.children.some((child) => child.name === 'worm-smile'));
    assert.ok(worm.root.children.length >= 8);
    const firstRoot = worm.root;
    system.startRound();
    assert.notEqual(system.units[0].root, firstRoot);
});
