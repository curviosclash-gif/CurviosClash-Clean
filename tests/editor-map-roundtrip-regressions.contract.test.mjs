import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMapJSON } from '../src/entities/MapSchema.js';
import { generateJSONExport, importFromJSON } from '../editor/js/EditorMapSerializer.js';
import { missingEntries, pickSubset } from './helpers/object-subset.mjs';

// Moved from tests/core-targeted.spec.js (P3): these four tests never took the `page`
// fixture. They drive the editor serializer against a hand-built manager stub, so an
// Electron window and a loaded game were pure overhead. The test ids stay in the titles.

// Mirrors createMockEditorManager in tests/core-targeted.shared.js, which still serves the
// remaining Playwright tests. Kept as a local copy so this file pulls in no Playwright code.
function createMockEditorManager() {
    return {
        mapDocumentMeta: {},
        lastSchemaWarnings: [],
        core: {
            objectsContainer: {
                children: [],
            },
        },
        clearAllObjects() {
            this.core.objectsContainer.children = [];
            this.mapDocumentMeta = {};
            this.lastSchemaWarnings = [];
        },
        withSceneMutation(fn) {
            return fn();
        },
        queueSceneUiRefresh() {},
        syncTunnelEndpointsFromMesh() {},
        createMesh(type, subType, x, y, z, sizeInfo, extraProps = {}) {
            const mesh = {
                position: { x, y, z },
                rotation: { y: Number(extraProps.rotateY) || 0 },
                userData: {
                    type,
                    subType,
                    sizeInfo,
                    ...extraProps,
                },
            };
            this.core.objectsContainer.children.push(mesh);
            return mesh;
        },
    };
}

test('migration warnings survive the history export performed after import', () => {
    const manager = createMockEditorManager();
    const legacyDocument = {
        arenaSize: { width: 280, height: 110, depth: 280 },
        hardBlocks: [],
    };

    importFromJSON(manager, JSON.stringify(legacyDocument));
    assert.ok(manager.lastSchemaWarnings.includes('Legacy map format detected. Migrated to schema v4.'));

    generateJSONExport(manager, legacyDocument.arenaSize);

    assert.ok(manager.lastSchemaWarnings.includes('Legacy map format detected. Migrated to schema v4.'));
});

test('T14e: Editor-Import/Export behaelt Showcase-Metadaten und Pickup-Anker-Felder', () => {
    const manager = createMockEditorManager();
    const sourceDocument = {
        arenaSize: { width: 390, height: 156, depth: 390 },
        glbModel: 'assets/models/showcase.glb',
        glbColliderMode: 'fallbackOnly',
        preferAuthoredPortals: true,
        portalLevels: [36, 78, 120],
        hardBlocks: [
            { id: 'hard_lane', x: 0, y: 24, z: -102, width: 120, height: 54, depth: 18, tunnel: { radius: 14.4, axis: 'x' } },
        ],
        foamBlocks: [],
        tunnels: [
            { id: 'tube_lane', ax: -132, ay: 54, az: -78, bx: 132, by: 54, bz: -78, radius: 12.6 },
        ],
        portals: [
            { id: 'portal_a', x: -156, y: 36, z: -156, radius: 18 },
            { id: 'portal_b', x: 156, y: 78, z: 156, radius: 18 },
        ],
        gates: [
            { id: 'gate_boost', type: 'boost', pos: [0, 36, -150], forward: [0, 0, -1], params: { duration: 1.4, forwardImpulse: 46 } },
        ],
        playerSpawn: { id: 'spawn_player', x: -162, y: 36, z: 54 },
        botSpawns: [{ id: 'spawn_bot_a', x: 162, y: 36, z: 54 }],
        items: [
            { id: 'item_anchor', type: 'item_rocket', model: 'item_rocket', pickupType: 'ROCKET_WEAK', weight: 1.5, x: 60, y: 78, z: 54, rotateY: 0.25 },
        ],
        aircraft: [
            { id: 'air_show', jetId: 'jet_ship6', x: 0, y: 138, z: 144, scale: 3.3, rotateY: 1.4 },
        ],
        flagObjectives: Array.from({ length: 6 }, (_, index) => ({
            id: `flag-${index + 1}`,
            teamId: index < 3 ? 'ALPHA' : 'BRAVO',
            position: [index * 20, 36, 0],
        })),
    };

    importFromJSON(manager, JSON.stringify(sourceDocument));
    const exported = generateJSONExport(manager, sourceDocument.arenaSize);
    const roundtrip = parseMapJSON(exported).map;

    assert.strictEqual(roundtrip.glbModel, sourceDocument.glbModel);
    assert.strictEqual(roundtrip.glbColliderMode, 'fallbackOnly');
    assert.ok(roundtrip.preferAuthoredPortals);
    assert.strictEqual(roundtrip.portalMode, 'authored');
    assert.strictEqual(roundtrip.itemSpawnMode, 'anchor-only');
    assert.deepStrictEqual(roundtrip.portalLevels, sourceDocument.portalLevels);
    assert.strictEqual(roundtrip.gates.length, 1);
    assert.deepStrictEqual(
        pickSubset(roundtrip.gates[0], { id: 'gate_boost', type: 'boost', pos: [0, 36, -150] }),
        { id: 'gate_boost', type: 'boost', pos: [0, 36, -150] }
    );
    assert.strictEqual(roundtrip.items.length, 1);
    assert.deepStrictEqual(
        pickSubset(roundtrip.items[0], {
            id: 'item_anchor',
            type: 'item_rocket',
            model: 'item_rocket',
            pickupType: 'ROCKET_WEAK',
            weight: 1.5,
        }),
        {
            id: 'item_anchor',
            type: 'item_rocket',
            model: 'item_rocket',
            pickupType: 'ROCKET_WEAK',
            weight: 1.5,
        }
    );
    assert.strictEqual(roundtrip.aircraft.length, 1);
    assert.deepStrictEqual(roundtrip.flagObjectives, sourceDocument.flagObjectives);
    assert.deepStrictEqual(
        pickSubset(roundtrip.playerSpawn, { id: 'spawn_player', x: -162, y: 36, z: 54 }),
        { id: 'spawn_player', x: -162, y: 36, z: 54 }
    );
    assert.strictEqual(roundtrip.botSpawns.length, 1);
    assert.strictEqual(roundtrip.tunnels.length, 1);
});

test('T14ea: Editor-Import/Export normalisiert Legacy-Rocket-PickupType auf aktive Tier-Namen', () => {
    const manager = createMockEditorManager();
    const sourceDocument = {
        arenaSize: { width: 280, height: 110, depth: 280 },
        items: [
            {
                id: 'legacy_rocket_anchor',
                type: 'item_rocket',
                model: 'item_rocket',
                pickupType: 'ROCKET_STRONG',
                weight: 1.1,
                x: 24,
                y: 16,
                z: -18,
            },
        ],
    };

    importFromJSON(manager, JSON.stringify(sourceDocument));
    const exported = generateJSONExport(manager, sourceDocument.arenaSize);
    const roundtrip = parseMapJSON(exported).map;
    const pickupType = String(roundtrip?.items?.[0]?.pickupType || '');

    assert.strictEqual(pickupType, 'ROCKET_HEAVY');
});

test('T14ea1: Editor-Export meldet invalides pickupType, Gate-Typ und Spawn-Metadaten frueh sichtbar', () => {
    const manager = createMockEditorManager();
    manager.mapDocumentMeta = {
        portalMode: 'scripted',
        itemSpawnMode: 'anchors',
        gates: [
            { id: 'gate_legacy', type: 'boost_plus', pos: [0, 12, 0] },
        ],
    };
    manager.createMesh('item', 'item_battery', 0, 14, 0, 0, {
        id: 'anchor_invalid',
        pickupType: 'LASER_BEAM',
    });

    const exported = generateJSONExport(manager, { width: 280, height: 110, depth: 280 });
    const roundtrip = parseMapJSON(exported).map;

    assert.deepStrictEqual(
        missingEntries(manager.lastSchemaWarnings, [
            'Unsupported portalMode "scripted" normalized to "dynamic".',
            'Unsupported itemSpawnMode "anchors" normalized to "anchor-only".',
            'Unknown gate type "boost_plus" normalized to "boost".',
            'Item anchor anchor_invalid uses unsupported pickupType "LASER_BEAM"; runtime falls back to item type/model.',
        ]),
        []
    );
    assert.strictEqual(roundtrip.portalMode, 'dynamic');
    assert.strictEqual(roundtrip.itemSpawnMode, 'anchor-only');
    assert.deepStrictEqual(
        pickSubset(roundtrip.gates[0], {
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
    assert.strictEqual(roundtrip.items[0]?.pickupType, undefined);
});

test('T14g: Editor-Import/Export behaelt Parcours-Definitionen im Roundtrip', () => {
    const manager = createMockEditorManager();
    const sourceDocument = {
        arenaSize: { width: 320, height: 120, depth: 280 },
        hardBlocks: [
            { id: 'lane_wall', x: 0, y: 16, z: 0, width: 30, height: 32, depth: 8 },
        ],
        parcours: {
            enabled: true,
            routeId: 'roundtrip_route_v1',
            rules: {
                ordered: true,
                resetOnDeath: true,
                resetToLastValid: false,
                maxSegmentTimeMs: 12000,
                cooldownMs: 450,
                allowLaneAliases: true,
                winnerByParcoursComplete: true,
            },
            checkpoints: [
                { id: 'CP01', type: 'entry', pos: [-20, 10, 0], radius: 4.4, forward: [1, 0, 0] },
                { id: 'CP02', type: 'gate', pos: [0, 14, 0], radius: 4.2, forward: [1, 0, 0] },
                { id: 'CP03', type: 'split', pos: [20, 18, -6], radius: 4.3, forward: [1, 0, 0] },
                { id: 'CP03_R', type: 'split', aliasOf: 'CP03', pos: [20, 18, 6], radius: 4.3, forward: [1, 0, 0] },
            ],
            finish: { id: 'FINISH', type: 'finish', pos: [34, 18, 0], radius: 5.2, forward: [1, 0, 0] },
        },
    };

    importFromJSON(manager, JSON.stringify(sourceDocument));
    const exported = generateJSONExport(manager, sourceDocument.arenaSize);
    const roundtrip = parseMapJSON(exported).map;

    assert.ok(roundtrip.parcours?.enabled);
    assert.strictEqual(roundtrip.parcours?.routeId, 'roundtrip_route_v1');
    assert.strictEqual(roundtrip.parcours?.checkpoints?.length, 4);
    assert.deepStrictEqual(
        pickSubset(roundtrip.parcours?.checkpoints?.[3], { id: 'CP03_R', aliasOf: 'CP03', type: 'split' }),
        { id: 'CP03_R', aliasOf: 'CP03', type: 'split' }
    );
    assert.deepStrictEqual(
        pickSubset(roundtrip.parcours?.finish, { id: 'FINISH', type: 'finish' }),
        { id: 'FINISH', type: 'finish' }
    );
    assert.deepStrictEqual(
        pickSubset(roundtrip.parcours?.rules, { ordered: true, resetOnDeath: true, winnerByParcoursComplete: true }),
        { ordered: true, resetOnDeath: true, winnerByParcoursComplete: true }
    );
});
