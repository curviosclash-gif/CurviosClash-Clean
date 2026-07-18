import assert from 'node:assert/strict';
import test from 'node:test';

import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';

function createMapDocument(parcoursRules = undefined) {
    return {
        schemaVersion: 4,
        arenaSize: { width: 120, height: 60, depth: 120 },
        hardBlocks: [],
        foamBlocks: [],
        tunnels: [],
        portals: [],
        portalLevels: [],
        gates: [],
        items: [],
        aircraft: [],
        botSpawns: [],
        playerSpawn: { x: -12, y: 10, z: 0 },
        parcours: {
            enabled: true,
            routeId: 'schema_probe_route',
            rules: parcoursRules,
            checkpoints: [
                { id: 'CP01', type: 'entry', pos: [-8, 10, 0], radius: 3.5, forward: [1, 0, 0] },
                { id: 'CP02', type: 'gate', pos: [8, 10, 0], radius: 3.5, forward: [1, 0, 0] },
            ],
            finish: { id: 'FINISH', type: 'finish', pos: [16, 10, 0], radius: 3.8, forward: [1, 0, 0] },
        },
    };
}

test('MapSchema runtime defaults parcours bidirectional checkpoints to true', () => {
    const runtime = toArenaMapDefinition(createMapDocument(), { mapScale: 1, name: 'Schema Route' });
    assert.equal(runtime?.map?.parcours?.rules?.bidirectionalCheckpoints, true);
});

test('MapSchema runtime preserves explicit bidirectional checkpoint override', () => {
    const runtime = toArenaMapDefinition(
        createMapDocument({ bidirectionalCheckpoints: false, ordered: true }),
        { mapScale: 1, name: 'Schema Route' }
    );
    assert.equal(runtime?.map?.parcours?.rules?.bidirectionalCheckpoints, false);
});

test('MapSchema runtime preserves custom parcours ghost and animation flags', () => {
    const runtime = toArenaMapDefinition(
        createMapDocument({ showGhost: false, animateCheckpoints: false }),
        { mapScale: 1, name: 'Schema Route' }
    );
    assert.equal(runtime?.map?.parcours?.rules?.showGhost, false);
    assert.equal(runtime?.map?.parcours?.rules?.animateCheckpoints, false);
});

test('MapSchema runtime preserves explicit zero-valued parcours timing rules', () => {
    const runtime = toArenaMapDefinition(
        createMapDocument({
            cooldownMs: 0,
            wrongOrderCooldownMs: 0,
            wrongOrderPenaltyMs: 0,
            errorIndicatorMs: 0,
        }),
        { mapScale: 1, name: 'Schema Route' }
    );
    assert.deepEqual(
        {
            cooldownMs: runtime?.map?.parcours?.rules?.cooldownMs,
            wrongOrderCooldownMs: runtime?.map?.parcours?.rules?.wrongOrderCooldownMs,
            wrongOrderPenaltyMs: runtime?.map?.parcours?.rules?.wrongOrderPenaltyMs,
            errorIndicatorMs: runtime?.map?.parcours?.rules?.errorIndicatorMs,
        },
        {
            cooldownMs: 0,
            wrongOrderCooldownMs: 0,
            wrongOrderPenaltyMs: 0,
            errorIndicatorMs: 0,
        }
    );
});

test('MapSchema runtime preserves portal visuals and orientation', () => {
    const document = createMapDocument();
    document.portalMode = 'authored';
    document.portals = [
        { id: 'portal_a', x: -20, y: 10, z: 0, radius: 8, model: 'portal_triangle', rotateY: Math.PI / 2 },
        { id: 'portal_b', x: 20, y: 10, z: 0, radius: 8, model: 'portal_star', rotateZ: Math.PI / 4 },
    ];
    const runtime = toArenaMapDefinition(document, { mapScale: 1, name: 'Portal Schema' });
    assert.deepEqual(runtime.map.portals[0], {
        a: [-20, 10, 0],
        b: [20, 10, 0],
        color: runtime.map.portals[0].color,
        modelA: 'portal_triangle',
        modelB: 'portal_star',
        rotationA: [0, Math.PI / 2, 0],
        rotationB: [0, 0, Math.PI / 4],
    });
});
