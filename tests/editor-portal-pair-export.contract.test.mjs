import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { generateJSONExport } from '../editor/js/EditorMapSerializer.js';
import { toArenaMapDefinition } from '../src/entities/MapSchema.js';

const ARENA_SIZE = { width: 2800, height: 950, depth: 2400 };

function portalObject(id, partnerId, x) {
    const object = new THREE.Group();
    object.position.set(x, 100, 0);
    object.userData = {
        id,
        type: 'portal',
        sizeInfo: 80,
        ...(partnerId ? { portalPartnerId: partnerId } : {}),
    };
    return object;
}

function createExportManager(children) {
    const byId = new Map(children.map((child) => [child.userData.id, child]));
    return {
        core: { objectsContainer: { children } },
        mapDocumentMeta: {},
        getObjectById(id) {
            return byId.get(id) || null;
        },
        syncTunnelEndpointsFromMesh() {},
    };
}

test('an unpaired portal does not split the linked portal pairs behind it', () => {
    const manager = createExportManager([
        portalObject('portal_a', 'portal_b', -400),
        portalObject('portal_b', 'portal_a', -200),
        portalObject('portal_lone', '', 0),
        portalObject('portal_c', 'portal_d', 200),
        portalObject('portal_d', 'portal_c', 400),
    ]);

    const exported = JSON.parse(generateJSONExport(manager, ARENA_SIZE));

    // The runtime pairs portals by their position in the list, so every linked pair
    // has to stay adjacent; the portal without a partner goes last and is dropped.
    assert.deepEqual(
        exported.portals.map((entry) => entry.id),
        ['portal_a', 'portal_b', 'portal_c', 'portal_d', 'portal_lone']
    );

    const runtime = toArenaMapDefinition(exported, { mapScale: 1 }).map;
    assert.equal(runtime.portals.length, 2);
    assert.deepEqual(runtime.portals.map((pair) => [pair.a[0], pair.b[0]]), [[-400, -200], [200, 400]]);
});

test('portals without any authoring link keep their scene order', () => {
    const manager = createExportManager([
        portalObject('portal_1', '', -300),
        portalObject('portal_2', '', -100),
        portalObject('portal_3', '', 100),
        portalObject('portal_4', '', 300),
    ]);

    const exported = JSON.parse(generateJSONExport(manager, ARENA_SIZE));

    assert.deepEqual(
        exported.portals.map((entry) => entry.id),
        ['portal_1', 'portal_2', 'portal_3', 'portal_4']
    );
});
