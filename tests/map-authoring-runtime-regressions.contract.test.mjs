import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMapDocument, toArenaMapDefinition } from '../src/entities/MapSchema.js';
import { missingEntries, pickSubset } from './helpers/object-subset.mjs';

// Moved from tests/core-targeted.spec.js (P3): both tests took no `page` fixture and only
// pushed a literal map document through the schema and the runtime projection. The test ids
// stay in the titles.

test('T14eb: Runtime-Warnungen machen Portalmodus, Spawnmodus und Legacy-Gates sichtbar', () => {
    const sourceDocument = {
        arenaSize: { width: 280, height: 110, depth: 280 },
        portalMode: 'dynamic',
        itemSpawnMode: 'fallback-random',
        portals: [
            { id: 'portal_1', x: -20, y: 10, z: 0, radius: 18 },
            { id: 'portal_2', x: 20, y: 10, z: 0, radius: 18 },
        ],
        gates: [
            { id: 'gate_legacy', type: 'boost_plus', pos: [0, 12, 0] },
        ],
        items: [
            { id: 'anchor_speed', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 8, z: 12 },
        ],
    };

    const parsed = createMapDocument(sourceDocument);
    const runtime = toArenaMapDefinition(parsed, { mapScale: 1, name: 'qa-map' });

    assert.strictEqual(runtime.map.portalMode, 'dynamic');
    assert.deepStrictEqual(
        pickSubset(runtime.map.portalAuthoring, {
            mode: 'dynamic',
            authoredNodeCount: 2,
            authoredPairCount: 1,
            hasDanglingPortalNode: false,
            usesAuthoredPortals: false,
            usesDynamicPortals: true,
        }),
        {
            mode: 'dynamic',
            authoredNodeCount: 2,
            authoredPairCount: 1,
            hasDanglingPortalNode: false,
            usesAuthoredPortals: false,
            usesDynamicPortals: true,
        }
    );
    assert.strictEqual(runtime.map.itemSpawnMode, 'fallback-random');
    assert.deepStrictEqual(
        pickSubset(runtime.map.gates[0], {
            type: 'boost',
            legacyType: 'boost_plus',
            warningCode: 'map.warning.gate-type',
        }),
        {
            type: 'boost',
            legacyType: 'boost_plus',
            warningCode: 'map.warning.gate-type',
        }
    );
    assert.deepStrictEqual(
        missingEntries(runtime.warnings, [
            'Authored portal nodes were ignored because portalMode=dynamic.',
            'Authored item anchors were ignored because itemSpawnMode=fallback-random.',
            'Unknown gate type "boost_plus" normalized to "boost".',
        ]),
        []
    );
});

test('T14eb1: Portal-Authoring-Vertrag meldet dangling authored nodes im Hybrid-Modus sichtbar', () => {
    const sourceDocument = {
        arenaSize: { width: 280, height: 110, depth: 280 },
        portalMode: 'hybrid',
        portals: [
            { id: 'portal_1', x: -20, y: 10, z: 0, radius: 18 },
            { id: 'portal_2', x: 20, y: 10, z: 0, radius: 18 },
            { id: 'portal_3', x: 90, y: 10, z: 0, radius: 18 },
        ],
    };

    const parsed = createMapDocument(sourceDocument);
    const runtime = toArenaMapDefinition(parsed, { mapScale: 1, name: 'qa-map-hybrid' });

    assert.strictEqual(runtime.map.portalMode, 'hybrid');
    assert.deepStrictEqual(
        pickSubset(runtime.map.portalAuthoring, {
            mode: 'hybrid',
            authoredNodeCount: 3,
            authoredPairCount: 1,
            hasDanglingPortalNode: true,
            usesAuthoredPortals: true,
            usesDynamicPortals: true,
        }),
        {
            mode: 'hybrid',
            authoredNodeCount: 3,
            authoredPairCount: 1,
            hasDanglingPortalNode: true,
            usesAuthoredPortals: true,
            usesDynamicPortals: true,
        }
    );
    assert.deepStrictEqual(
        missingEntries(runtime.warnings, [
            'Authored portal contract requires complete A/B pairs; a trailing portal node was ignored.',
        ]),
        []
    );
});
