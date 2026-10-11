import test from 'node:test';
import assert from 'node:assert/strict';

import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import {
    resolveMapSinglePlayerScenario,
    resolveMapStaticTurretDefinitions,
} from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import { resolveScenarioBotTuning } from '../src/hunt/HuntScenarioBotRoles.js';

test('Angriffsparcours is available on desktop with a complete ordered route', () => {
    const map = PARCOURS_MAPS.parcours_assault;
    assert.equal(MAP_PRESETS_BASE.parcours_assault, map);

    const route = buildRouteFromParcours(map.parcours);
    assert.ok(route);
    assert.equal(route.routeId, 'assault_mg_rockets_v2');
    assert.equal(route.totalCheckpoints, 9);
    assert.equal(route.rules.bidirectionalCheckpoints, true);
    assert.equal(route.rules.resetToLastValid, true);
    assert.ok(route.finish);
});

test('Angriffsparcours starts outside a forgiving first checkpoint', () => {
    const map = PARCOURS_MAPS.parcours_assault;
    const route = buildRouteFromParcours(map.parcours);
    const first = route.checkpoints[0];
    const spawnDistance = Math.hypot(
        map.playerSpawn.x - first.pos[0],
        map.playerSpawn.y - first.pos[1],
        map.playerSpawn.z - first.pos[2]
    );

    assert.equal(first.id, 'CP01_START');
    assert.equal(first.forward, null);
    assert.ok(spawnDistance > first.radius);
    assert.ok(spawnDistance - first.radius <= 5);
});

test('Angriffsparcours accepts the first checkpoint from the authored spawn', () => {
    const map = PARCOURS_MAPS.parcours_assault;
    const player = {
        index: 0,
        isBot: false,
        alive: true,
        hitboxRadius: 0.8,
        position: {
            x: map.playerSpawn.x * 3,
            y: map.playerSpawn.y * 3,
            z: map.playerSpawn.z * 3,
        },
    };
    const manager = {
        arena: { currentMapDefinition: map },
        players: [player],
        recorder: { logEvent() {} },
        _notifyPlayerFeedback() {},
    };
    const system = new ParcoursProgressSystem(manager, { nowProvider: () => 1000 });
    system.startRound([player]);
    system.onPlayerSpawn(player, { reason: 'spawn_all' });
    const first = system.getRouteSnapshot().checkpoints[0];
    const previousPosition = { ...player.position };
    [player.position.x, player.position.y, player.position.z] = first.pos;

    assert.deepEqual(system.updatePlayerProgress(player, previousPosition, 1000), {
        type: 'checkpoint',
        checkpointId: 'CP01_START',
    });
    assert.equal(system.getPlayerProgressSnapshot(0, 1000).nextCheckpointIndex, 1);
});

test('Angriffsparcours provides authored enemies and escalating rocket pickups for Hunt', () => {
    const map = PARCOURS_MAPS.parcours_assault;
    const pickupTypes = map.items.map((item) => item.pickupType);

    assert.ok(map.botSpawns.length >= 4);
    assert.ok(pickupTypes.includes('ROCKET_MEDIUM'));
    assert.ok(pickupTypes.includes('ROCKET_HEAVY'));
    assert.ok(pickupTypes.includes('ROCKET_MEGA'));

    const strategy = new HuntModeStrategy();
    assert.equal(strategy.hasMachineGun(), true);
    assert.ok(strategy.resolveRocketProjectileParams('ROCKET_MEDIUM', {}));
});

test('Angriffsparcours declares the required single-player combat setup', () => {
    const scenario = resolveMapSinglePlayerScenario(PARCOURS_MAPS.parcours_assault);

    assert.deepEqual(scenario, {
        id: 'assault_mg_rockets',
        modePath: 'fight',
        gameMode: 'HUNT',
        minBots: 4,
        botRoles: ['pursuer', 'interceptor', 'flanker', 'pursuer', 'interceptor', 'flanker'],
    });
});

test('Angriffsparcours declares aggressive mobile bot roles and six static defences', () => {
    const map = PARCOURS_MAPS.parcours_assault;
    const turrets = resolveMapStaticTurretDefinitions(map);

    assert.deepEqual(map.singlePlayerScenario.botRoles, ['pursuer', 'interceptor', 'flanker', 'pursuer', 'interceptor', 'flanker']);
    assert.deepEqual(turrets.map((entry) => entry.weapon), ['mg', 'mg', 'rocket', 'rocket', 'mg', 'mg']);
    assert.equal(resolveScenarioBotTuning({ scenarioRole: 'guard' }).anchorRadius, 24);
    assert.equal(resolveScenarioBotTuning({ scenarioRole: 'pursuer' }).aggressionBonus, 0.3);
    assert.equal(resolveScenarioBotTuning({ scenarioRole: 'interceptor' }).prefersRocket, true);
});

test('Angriffsparcours bot spawn points clear the authored box obstacles', () => {
    const map = PARCOURS_MAPS.parcours_assault;
    const clearance = 4;
    for (const spawn of map.botSpawns) {
        for (const obstacle of map.obstacles) {
            if (!obstacle.pos || !obstacle.size) continue;
            const distanceX = Math.max(0, Math.abs(spawn.x - obstacle.pos[0]) - obstacle.size[0] / 2);
            const distanceY = Math.max(0, Math.abs(spawn.y - obstacle.pos[1]) - obstacle.size[1] / 2);
            const distanceZ = Math.max(0, Math.abs(spawn.z - obstacle.pos[2]) - obstacle.size[2] / 2);
            assert.ok(
                distanceX ** 2 + distanceY ** 2 + distanceZ ** 2 >= clearance ** 2,
                `spawn (${spawn.x}, ${spawn.y}, ${spawn.z}) overlaps obstacle at (${obstacle.pos})`
            );
        }
    }
});
