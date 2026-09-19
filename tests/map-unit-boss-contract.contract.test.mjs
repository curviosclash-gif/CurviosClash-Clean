import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMapUnit, resolveMapUnitDefinitions } from '../src/shared/contracts/MapUnitContract.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';

const PATH = [[-12, -14, -12], [12, -14, -12], [12, -14, 12], [-12, -14, 12]];

test('a bare boss gets the agreed secret-room balance and one-round lifecycle', () => {
    const boss = normalizeMapUnit({ id: 'vault_boss', kind: 'boss', path: PATH });

    assert.equal(boss.kind, 'boss');
    assert.equal(boss.speed, 8);
    assert.equal(boss.maxHp, 800);
    assert.equal(boss.respawnSeconds, 0);
    assert.equal(boss.modelScale, 1.6);
    assert.equal(boss.lootCount, 3);
    assert.deepEqual(boss.guaranteedLoot, ['ROCKET_MEGA']);
    assert.deepEqual(boss.weapons.rocket, { rocketType: 'ROCKET_MEDIUM', cooldown: 3, range: 90 });
});

test('boss-only fields survive the map schema and scale boundary', () => {
    const document = normalizeMapSchemaDocument({
        schemaVersion: 4,
        mapUnits: [{
            id: 'custom_boss',
            kind: 'boss',
            path: PATH,
            modelScale: 1.8,
            lootCount: 4,
            guaranteedLoot: ['ROCKET_MEGA', 'ROCKET_HEAVY'],
        }],
    });
    const runtime = toArenaMapDefinition(document, { mapScale: 2 });
    const [boss] = resolveMapUnitDefinitions(runtime.map, { preserveSpatial: true });

    assert.equal(boss.modelScale, 1.8);
    assert.equal(boss.lootCount, 4);
    assert.deepEqual(boss.guaranteedLoot, ['ROCKET_MEGA', 'ROCKET_HEAVY']);
    assert.deepEqual(boss.path, PATH.map((point) => point.map((value) => value / 2)));
});
