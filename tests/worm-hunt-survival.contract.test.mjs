import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ARCADE_SCENARIOS } from '../src/entities/directors/ArcadeScenarioCatalog.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { TargetableRegistry } from '../src/entities/systems/TargetableRegistry.js';
import { CONFIG } from '../src/core/Config.js';
import { applyBotMapUnitFire } from '../src/hunt/HuntBotMapUnitOps.js';
import { hasRailgunLine } from '../src/hunt/HuntBotRailgunOps.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';

function createWorld({ scenario = 'worm_hunt' } = {}) {
    const definition = ARCADE_SCENARIOS.find(entry => entry.id === 'worm_hunt');
    assert.ok(definition);
    const events = [], scored = [], visuals = [];
    const human = { index: 0, isBot: false, alive: true, hp: 100, position: new THREE.Vector3(0, 50, 0) };
    const enemy = { index: 1, isBot: true, alive: true, hp: 100, position: new THREE.Vector3(0, 50, 0) };
    const companion = { index: 2, isBot: true, isArcadeCompanion: true, alive: true, hp: 100, position: new THREE.Vector3(0, 50, 0) };
    const owner = {
        runtimeConfig: { arcade: { enabled: true, scenarioId: scenario, scenarioMapUnits: definition.mapUnits, scenarioMapUnitsMode: 'replace' } },
        gameModeStrategy: { modeType: 'ARCADE', getPickupModeType: () => 'HUNT' },
        arena: { currentMapDefinition: MAP_PRESET_CATALOG.standard, bounds: { min: { y: 0 } } },
        players: [human, enemy, companion], humanPlayers: [human],
        renderer: { addToScene: root => visuals.push(root), removeFromScene() {} },
        onArcadeGameplayEvent: event => events.push(event),
        _huntScoring: { registerUnitDestroyed: (index, kind) => scored.push({ index, kind }) },
        particles: { spawnHit() {}, spawnExplosion() {} },
        _notifyPlayerFeedback() {},
    };
    const system = new MapUnitSystem(owner);
    owner._mapUnitSystem = system;
    const registry = new TargetableRegistry(); registry.addProvider(() => system.getTargets()); owner._targetableRegistry = registry;
    system.startRound();
    return { system, owner, human, enemy, companion, events, scored, visuals };
}

test('Wurmjagd starts with 100 separate visible six-HP creatures after normal simulation ticks', () => {
    const world = createWorld();
    try {
        for (let i = 0; i < 12; i++) world.system.update(1 / 60);
        assert.equal(world.system.getTargets().length, 100);
        assert.ok(world.system.units.every(unit => unit.alive && unit.hp === 6 && unit.maxHp === 6));
        assert.equal(world.visuals.filter(root => root.visible && root.userData.wormVisual).length, 100);
        assert.equal(world.events.filter(event => event.type === 'unit_destroyed').length, 0);
    } finally { world.system.dispose(); }
});

test('an enemy bot cannot consume the player objective by direct or splash damage', () => {
    const world = createWorld();
    try {
        for (const unit of world.system.units) {
            const result = unit.takeDamage(60, { sourcePlayer: world.enemy, cause: 'MG_BULLET' });
            assert.equal(result.hpApplied, 0);
            assert.equal(unit.hp, 6); assert.equal(unit.alive, true);
        }
        assert.deepEqual(world.scored, []); assert.deepEqual(world.events, []);
    } finally { world.system.dispose(); }
});

test('one human worm kill cannot trigger a tank blast chain and credits exactly that creature', () => {
    const world = createWorld();
    try {
        // Deliberately cluster targets: spacing alone must not be the fix for the blast bug.
        for (const unit of world.system.units) unit.position.set(0, 1.35, 0);
        const first = world.system.units[0];
        first.takeDamage(6, { sourcePlayer: world.human, cause: 'MG_BULLET' });
        assert.equal(world.system.getTargets().length, 99);
        assert.equal(world.system.units.filter(unit => unit.hp === 6).length, 99);
        assert.deepEqual(world.scored, [{ index: 0, kind: 'creature' }]);
        assert.equal(world.events.filter(event => event.type === 'unit_destroyed').length, 1);
        assert.equal(world.events[0].count, 1);
        world.system.update(90.1);
        assert.equal(first.alive, false, 'a completed objective target must not respawn and be counted twice');
    } finally { world.system.dispose(); }
});

test('humans and their existing companions can finish all one hundred distinct objectives once', () => {
    const world = createWorld();
    try {
        for (const [index, unit] of world.system.units.entries()) {
            const sourcePlayer = index % 2 ? world.companion : world.human;
            unit.takeDamage(6, { sourcePlayer, cause: 'MG_BULLET' });
            unit.takeDamage(6, { sourcePlayer, cause: 'MG_BULLET' });
        }
        assert.equal(world.events.filter(event => event.type === 'unit_destroyed').length, 100);
        assert.equal(world.scored.length, 100);
        assert.equal(world.system.getTargets().length, 0);
        assert.equal(world.events.filter(event => event.companion).length, 50);
    } finally { world.system.dispose(); }
});

test('normal map creatures retain their existing bot-damage behavior outside Wurmjagd', () => {
    const world = createWorld({ scenario: 'other' });
    try {
        world.system.units[0].takeDamage(1, { sourcePlayer: world.enemy, cause: 'MG_BULLET' });
        assert.equal(world.system.units[0].hp, 5);
    } finally { world.system.dispose(); }
});

test('enemy bot weapon decisions leave the protected worm alone while companion aim remains available', () => {
    const world = createWorld();
    try {
        const target = world.system.units[0]; target.position.set(0, 10, 30);
        const policy = { _tmpFlameAim: new THREE.Vector3(), _tmpFlameOffset: new THREE.Vector3() };
        const context = { entityManager: { _targetableRegistry: { collect: () => [target] } } };
        for (const player of [world.enemy, world.companion]) {
            player.position.set(0, 10, 0);
            player.getAimDirection = out => out.set(0, 0, 1);
            const input = { shootMG: false };
            const allowed = player === world.companion;
            assert.equal(applyBotMapUnitFire(policy, input, player, context), allowed);
            assert.equal(input.shootMG, allowed);
            assert.equal(hasRailgunLine(player, [target], 95, new THREE.Vector3(0, 0, 1), new THREE.Vector3()), allowed);
            const resolver = new MGHitResolver({ players: [], combat: { getMgTurretTargets: () => [target] } });
            player.getAimDirection = out => out.set(0.02, 0, 1).normalize();
            const aim = resolver.resolveAimDirection(player, new THREE.Vector3(), { RANGE: 95, AIM_DOT_MIN: 0.965 });
            if (allowed) assert.equal(aim.x, 0, 'companions keep the normal worm aim assist');
            else assert.ok(aim.x > 0.01, 'enemy bot aim cannot snap onto the protected worm');
        }
    } finally { world.system.dispose(); }
});

test('all hundred worm paths leave room for their bodies, arena borders and standard pillars', () => {
    const scenario = ARCADE_SCENARIOS.find(entry => entry.id === 'worm_hunt');
    const map = MAP_PRESET_CATALOG.standard, scale = CONFIG.ARENA.MAP_SCALE;
    assert.equal(scenario.mapUnits.length, 100);
    for (const worm of scenario.mapUnits) {
        for (const point of worm.path) {
            const [x, y, z] = point;
            assert.equal(y, 0);
            assert.ok(Math.abs(x) + 10 < map.size[0] * scale / 2);
            assert.ok(Math.abs(z) + 6 < map.size[2] * scale / 2);
            for (const obstacle of map.obstacles) {
                const xReach = obstacle.size[0] * scale / 2 + 10;
                const zReach = obstacle.size[2] * scale / 2 + 6;
                assert.ok(Math.abs(x - obstacle.pos[0] * scale) >= xReach || Math.abs(z - obstacle.pos[2] * scale) >= zReach,
                    `${worm.id} body intersects pillar at ${obstacle.pos}`);
            }
        }
    }
    for (let i = 0; i < scenario.mapUnits.length; i++) for (let j = i + 1; j < scenario.mapUnits.length; j++) {
        const a = scenario.mapUnits[i].path[0], b = scenario.mapUnits[j].path[0];
        assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) >= 20, 'creature start positions must be visibly separated');
    }
});
