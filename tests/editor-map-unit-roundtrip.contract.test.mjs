import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { generateJSONExport, importFromJSON } from '../editor/js/EditorMapSerializer.js';

const ARENA_SIZE = { width: 2800, height: 950, depth: 2400 };

// Already in the shape the map schema normalizes to, so the block has to come back byte for byte.
const MAP_UNITS = [
    {
        id: 'patrol',
        kind: 'tank',
        path: [[0, 3, 0], [60, 3, 0], [60, 3, 60]],
        loop: true,
        speed: 12,
        maxHp: 150,
        hitboxRadius: 3.5,
        respawnSeconds: 30,
        weapons: { mg: { damage: 3, cooldown: 0.3, range: 60 }, rocket: false },
        loot: { ROCKET_MEDIUM: 0.6, ROCKET_HEAVY: 0.3, ROCKET_MEGA: 0.1 },
        allowedModes: ['HUNT', 'ARCADE'],
        targetPlayers: 'all',
    },
    {
        id: 'vault_swarm',
        kind: 'swarm',
        path: [[-12, 6, 0], [12, 6, 0]],
        loop: false,
        speed: 18,
        maxHp: 8,
        hitboxRadius: 1.25,
        respawnSeconds: 20,
        weapons: { mg: { damage: 2, cooldown: 0.6, range: 40 }, rocket: false },
        loot: {},
        allowedModes: ['HUNT', 'ARCADE'],
        targetPlayers: 'all',
        memberCount: 8,
        memberHp: 8,
        formationRadius: 5,
    },
];
function createSceneObject(userData, position = [0, 0, 0]) {
    const object = new THREE.Group();
    object.position.set(position[0], position[1], position[2]);
    object.userData = { ...userData };
    return object;
}

function createExportManager(children, mapDocumentMeta = {}) {
    const byId = new Map(children.map((child) => [child.userData.id, child]));
    return {
        core: { objectsContainer: { children } },
        mapDocumentMeta,
        getObjectById(id) {
            return byId.get(id) || null;
        },
        syncTunnelEndpointsFromMesh() {},
    };
}

function createImportManager() {
    const children = [];
    return {
        core: { objectsContainer: { children } },
        mapDocumentMeta: {},
        clearAllObjects() { children.length = 0; },
        withSceneMutation(callback) { callback(); },
        queueSceneUiRefresh() {},
        createMesh(type, subType, x, y, z, sizeInfo, extraProps = {}) {
            const object = createSceneObject({ type, subType, sizeInfo, ...extraProps }, [x, y, z]);
            children.push(object);
            return object;
        },
    };
}

function authoredMapJSON(extra) {
    const blocks = [createSceneObject({ id: 'block_1', type: 'hard', sizeX: 70, sizeY: 70, sizeZ: 70, sizeInfo: 35 })];
    const document = JSON.parse(generateJSONExport(createExportManager(blocks), ARENA_SIZE));
    return JSON.stringify({ ...document, ...extra });
}

function roundtrip(extra) {
    const importManager = createImportManager();
    importFromJSON(importManager, authoredMapJSON(extra));
    const exportManager = createExportManager(
        [createSceneObject({ id: 'block_1', type: 'hard', sizeX: 70, sizeY: 70, sizeZ: 70, sizeInfo: 35 })],
        importManager.mapDocumentMeta
    );
    return JSON.parse(generateJSONExport(exportManager, ARENA_SIZE));
}

test('map units survive an editor import/export roundtrip untouched', () => {
    assert.deepEqual(roundtrip({ mapUnits: MAP_UNITS }).mapUnits, MAP_UNITS);
});

test('a map without units exports no map unit field', () => {
    assert.equal('mapUnits' in roundtrip({}), false);
});

test('Escort routes import as visual waypoints and export with checkpoint metadata', () => {
    const escortUnit = {
        id: 'escort_tank',
        kind: 'tank',
        path: [[-30, 2, 0], [0, 2, 20], [30, 2, 0], [60, 2, 10]],
        loop: false,
        speed: 6,
        maxHp: 600,
        hitboxRadius: 3.5,
        respawnSeconds: 0,
        weapons: { mg: false, rocket: false },
        loot: { ROCKET_MEDIUM: 0.6, ROCKET_HEAVY: 0.3, ROCKET_MEGA: 0.1 },
        allowedModes: ['ESCORT'],
        targetPlayers: 'all',
        escortObjective: { checkpointPathIndices: [2] },
    };
    const manager = createImportManager();
    importFromJSON(manager, authoredMapJSON({ mapUnits: [escortUnit] }));
    const route = manager.core.objectsContainer.children.filter((object) => object.userData.type === 'escort_waypoint');
    assert.deepEqual(route.map((object) => object.userData.subType), ['start', 'waypoint', 'checkpoint', 'goal']);
    assert.equal(manager.mapDocumentMeta.mapUnits.length, 0, 'visual route replaces carried-through Escort metadata');

    const exported = JSON.parse(generateJSONExport(createExportManager(
        manager.core.objectsContainer.children,
        manager.mapDocumentMeta,
    ), ARENA_SIZE));
    const exportedEscort = exported.mapUnits.find((unit) => unit.escortObjective);
    assert.deepEqual(exportedEscort.path, escortUnit.path);
    assert.deepEqual(exportedEscort.escortObjective.checkpointPathIndices, [2]);
    assert.equal(exportedEscort.speed, 6);
    assert.equal(exportedEscort.maxHp, 600);
});
