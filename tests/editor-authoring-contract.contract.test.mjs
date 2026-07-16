import assert from 'node:assert/strict';
import test from 'node:test';

import {
    EDITOR_AUTHORING_CONTRACT_VERSION,
    EDITOR_ITEM_PICKUP_TYPE_BY_SUBTYPE,
    EDITOR_OBJECT_TYPES,
    EDITOR_CONTENT_DESCRIPTOR_FIELDS,
    EDITOR_UI_METADATA_FIELDS,
    isKnownEditorObjectType,
    getEditorAuthoringDescriptor,
    getDefaultEditorItemPickupType,
} from '../src/shared/contracts/EditorAuthoringContract.js';
import * as THREE from 'three';
import { createEditorMesh } from '../editor/js/EditorMeshFactory.js';
import {
    getYLayerValue,
    readArenaSizeInputs,
    readPositivePropertyFieldNumber,
    readPropertyFieldNumber,
} from '../editor/js/ui/EditorFormState.js';

test('EDITOR_AUTHORING_CONTRACT_VERSION is a non-empty string', () => {
    assert.equal(typeof EDITOR_AUTHORING_CONTRACT_VERSION, 'string');
    assert.ok(EDITOR_AUTHORING_CONTRACT_VERSION.length > 0);
});

test('EDITOR_OBJECT_TYPES contains all nine authoritative types', () => {
    const expected = ['hard', 'foam', 'portal', 'spawn', 'item', 'aircraft', 'glb', 'tunnel', 'checkpoint'];
    const actual = Object.values(EDITOR_OBJECT_TYPES);
    assert.equal(actual.length, expected.length, 'Object type count must be 9');
    for (const type of expected) {
        assert.ok(actual.includes(type), `Expected object type "${type}" in EDITOR_OBJECT_TYPES`);
    }
});

test('EDITOR_CONTENT_DESCRIPTOR_FIELDS contains tool and subType', () => {
    assert.ok(EDITOR_CONTENT_DESCRIPTOR_FIELDS.includes('tool'));
    assert.ok(EDITOR_CONTENT_DESCRIPTOR_FIELDS.includes('subType'));
});

test('EDITOR_UI_METADATA_FIELDS contains all presentation-only fields', () => {
    const expected = ['categoryId', 'categoryLabel', 'accentColor', 'previewGlyph', 'previewToken',
        'sortOrder', 'badge', 'isFeatured', 'isDefault', 'label', 'description', 'keywords'];
    for (const field of expected) {
        assert.ok(EDITOR_UI_METADATA_FIELDS.includes(field), `Expected UI field "${field}"`);
    }
});

test('content-descriptor fields and UI-metadata fields are disjoint', () => {
    const contentSet = new Set(EDITOR_CONTENT_DESCRIPTOR_FIELDS);
    for (const field of EDITOR_UI_METADATA_FIELDS) {
        assert.ok(!contentSet.has(field), `Field "${field}" must not appear in both field sets`);
    }
});

test('isKnownEditorObjectType returns true for all EDITOR_OBJECT_TYPES values', () => {
    for (const type of Object.values(EDITOR_OBJECT_TYPES)) {
        assert.ok(isKnownEditorObjectType(type), `isKnownEditorObjectType("${type}") must be true`);
    }
});

test('isKnownEditorObjectType returns false for unknown or invalid types', () => {
    assert.equal(isKnownEditorObjectType(''), false);
    assert.equal(isKnownEditorObjectType('unknown'), false);
    assert.equal(isKnownEditorObjectType(null), false);
    assert.equal(isKnownEditorObjectType(undefined), false);
    assert.equal(isKnownEditorObjectType(42), false);
});

test('getEditorAuthoringDescriptor returns frozen descriptor with all fields', () => {
    const descriptor = getEditorAuthoringDescriptor();
    assert.equal(descriptor.contractVersion, EDITOR_AUTHORING_CONTRACT_VERSION);
    assert.ok(Array.isArray(descriptor.objectTypes));
    assert.ok(Array.isArray(descriptor.contentDescriptorFields));
    assert.ok(Array.isArray(descriptor.uiMetadataFields));
    assert.equal(descriptor.objectTypes.length, Object.values(EDITOR_OBJECT_TYPES).length);
    assert.ok(Object.isFrozen(descriptor));
});

test('editor item models have deterministic pickup defaults except the random item box', () => {
    assert.equal(getDefaultEditorItemPickupType('item_health'), 'HEALTH');
    assert.equal(getDefaultEditorItemPickupType('item_battery'), 'SPEED_UP');
    assert.equal(getDefaultEditorItemPickupType('item_rocket'), 'ROCKET_WEAK');
    assert.equal(getDefaultEditorItemPickupType('item_box'), null);
    assert.ok(Object.keys(EDITOR_ITEM_PICKUP_TYPE_BY_SUBTYPE).length >= 16);
});

test('placing an editor item persists its default pickupType without overriding authored values', () => {
    const manager = {
        assetLoader: { getClone: () => new THREE.Group() },
        sphereGeo: new THREE.SphereGeometry(1),
        mats: { item_fallback: new THREE.MeshBasicMaterial() },
        attachSelectionOutlines() {},
        registerObject(mesh) { return mesh; },
    };

    const medipack = createEditorMesh(manager, 'item', 'item_health', 1, 2, 3, 0);
    const override = createEditorMesh(manager, 'item', 'item_health', 1, 2, 3, 0, { pickupType: 'SHIELD' });
    const randomBox = createEditorMesh(manager, 'item', 'item_box', 1, 2, 3, 0);

    assert.equal(medipack.userData.pickupType, 'HEALTH');
    assert.equal(override.userData.pickupType, 'SHIELD');
    assert.equal(randomBox.userData.pickupType, undefined);
});

test('editor property fields preserve valid zero values', () => {
    const editor = { dom: { propX: { value: '0' }, propY: { value: '' } } };
    assert.equal(readPropertyFieldNumber(editor, 'x', 123), 0);
    assert.equal(readPropertyFieldNumber(editor, 'y', 123), 123);
});

test('editor numeric authoring fields reject invalid dimensions and clamp build height', () => {
    const editor = {
        ARENA_H: 950,
        dom: {
            numArenaW: { value: '-1' },
            numArenaD: { value: '3000' },
            numArenaH: { value: '' },
            numYLayer: { value: '1200' },
            propWidth: { value: '-20' },
        },
    };
    assert.deepEqual(readArenaSizeInputs(editor, { width: 2800, depth: 2400, height: 950 }), {
        width: 2800,
        depth: 3000,
        height: 950,
    });
    assert.equal(getYLayerValue(editor), 950);
    assert.equal(readPositivePropertyFieldNumber(editor, 'width', 200), 200);
});
