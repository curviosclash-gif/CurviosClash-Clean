import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMapUnit, resolveMapUnitDefinitions } from '../src/shared/contracts/MapUnitContract.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';

const PATH = [[-8, 6, 0], [8, 6, 0]];

test('a bare swarm gets the agreed lightweight combat defaults', () => {
    const swarm = normalizeMapUnit({ id: 'vault_swarm', kind: 'swarm', path: PATH });

    assert.equal(swarm.kind, 'swarm');
    assert.equal(swarm.memberCount, 8);
    assert.equal(swarm.memberHp, 8);
    assert.equal(swarm.formationRadius, 5);
    assert.equal(swarm.maxHp, 8);
    assert.equal(swarm.respawnSeconds, 0, 'the map decides whether a defeated swarm returns');
    assert.deepEqual(swarm.weapons.mg, { damage: 2, cooldown: 0.6, range: 40 });
    assert.equal(swarm.weapons.rocket, null);
});

test('swarm size and member values are bounded', () => {
    const swarm = normalizeMapUnit({
        kind: 'swarm',
        path: PATH,
        memberCount: 99,
        memberHp: -2,
        formationRadius: 500,
    });

    assert.equal(swarm.memberCount, 8);
    assert.equal(swarm.memberHp, 1);
    assert.equal(swarm.formationRadius, 20);
});

test('swarm fields survive the map schema and its scale boundary', () => {
    const document = normalizeMapSchemaDocument({
        schemaVersion: 4,
        mapUnits: [{
            id: 'custom_swarm',
            kind: 'swarm',
            path: [[-30, 18, 0], [30, 18, 0]],
            memberCount: 6,
            memberHp: 7,
            formationRadius: 9,
            respawnSeconds: 37,
        }],
    });
    const runtime = toArenaMapDefinition(document, { mapScale: 3 });
    const [swarm] = resolveMapUnitDefinitions(runtime.map, { preserveSpatial: true });

    assert.equal(swarm.kind, 'swarm');
    assert.equal(swarm.memberCount, 6);
    assert.equal(swarm.memberHp, 7);
    assert.equal(swarm.formationRadius * 3, 9);
    assert.equal(swarm.respawnSeconds, 37);
    assert.deepEqual(swarm.path, [[-10, 6, 0], [10, 6, 0]]);
});
