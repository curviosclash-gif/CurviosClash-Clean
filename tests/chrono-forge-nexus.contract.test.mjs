import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { CHRONO_FORGE_NEXUS_MAP } from '../src/core/config/maps/presets/chrono_forge_nexus.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

const map = CHRONO_FORGE_NEXUS_MAP.chrono_forge_nexus;

test('Chrono-Forge Nexus is registered as a desktop map', () => {
    assert.equal(MAP_PRESET_CATALOG.chrono_forge_nexus, map);
    assert.equal(MAP_PRESETS_BASE.chrono_forge_nexus, map);
    assert.deepEqual(map.size, [380, 120, 260]);
});

test('Chrono-Forge Nexus fulfills the authored gameplay inventory', () => {
    assert.equal(map.portals.length, 3);
    assert.equal(map.gates.filter((gate) => gate.type === 'boost').length, 5);
    assert.equal(map.gates.filter((gate) => gate.type === 'slingshot').length, 2);
    assert.equal(map.obstacles.filter((obstacle) => obstacle.kind === 'foam').length, 4);
    assert.equal(map.items.length, 10);
    assert.equal(map.botSpawns.length, 4);
    assert.ok(map.glbModels.length <= 30);
    assert.equal(map.glbModels.filter((model) => model.url.startsWith('assets/maps/chrono_forge/glb/')).length, 8);
    assert.equal(map.glbColliderMode, 'dynamic');
});

test('Chrono-Forge Nexus builds two forward branches and fifteen stages including finish', () => {
    const route = buildRouteFromParcours(map.parcours);

    assert.ok(route);
    assert.equal(route.routeId, 'chrono_forge_nexus_v1');
    assert.equal(route.totalCheckpoints, 14);
    assert.equal(route.branches.length, 2);
    assert.ok(route.branches.every((branch) => branch.validMerge));
    assert.ok(route.branches.every((branch) => branch.nextCheckpointIds.length === 2));
    assert.ok(route.finish);
    assert.equal(route.totalCheckpoints + 1, 15);
});

test('Chrono-Forge Nexus route triggers stay within the arena', () => {
    const [width, height, depth] = map.size;
    const entries = [...map.parcours.checkpoints, map.parcours.finish];

    for (const entry of entries) {
        const [x, y, z] = entry.pos;
        assert.ok(Math.abs(x) + entry.radius <= width / 2, `${entry.id} fits in X`);
        assert.ok(y - entry.radius >= 0 && y + entry.radius <= height, `${entry.id} fits in Y`);
        assert.ok(Math.abs(z) + entry.radius <= depth / 2, `${entry.id} fits in Z`);
    }
});
