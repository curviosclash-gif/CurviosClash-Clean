import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMapUnit, resolveMapUnitDefinitions } from '../src/shared/contracts/MapUnitContract.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';

const PATH = [[-120, 45, 0], [120, 45, 0]];

test('a bare bomber gets the agreed fixed-flight balance', () => {
    const bomber = normalizeMapUnit({ id: 'bomber_a', kind: 'bomber', path: PATH });

    assert.equal(bomber.kind, 'bomber');
    assert.equal(bomber.speed, 30);
    assert.equal(bomber.maxHp, 120);
    assert.equal(bomber.respawnSeconds, 90);
    assert.equal(bomber.loop, false);
    assert.equal(bomber.weapons.mg, null);
    assert.equal(bomber.weapons.rocket, null);
    assert.deepEqual(bomber.weapons.bomb, { damage: 50, cooldown: 1.5, radius: 15 });
    assert.deepEqual(bomber.crash, { damage: 50, radius: 20 });
});

test('bomber-only values survive the map schema and scale boundary', () => {
    const document = normalizeMapSchemaDocument({
        schemaVersion: 4,
        mapUnits: [{
            id: 'custom_bomber', kind: 'bomber', path: PATH,
            weapons: { bomb: { damage: 42, cooldown: 2, radius: 18 } },
            crash: { damage: 45, radius: 24 },
        }],
    });
    const runtime = toArenaMapDefinition(document, { mapScale: 3 });
    const [bomber] = resolveMapUnitDefinitions(runtime.map, { preserveSpatial: true });

    assert.deepEqual(bomber.path, PATH.map((point) => point.map((value) => value / 3)));
    assert.deepEqual(bomber.weapons.bomb, { damage: 42, cooldown: 2, radius: 6 });
    assert.deepEqual(bomber.crash, { damage: 45, radius: 8 });
});
