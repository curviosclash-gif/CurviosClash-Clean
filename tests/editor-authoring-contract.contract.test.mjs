import assert from 'node:assert/strict';
import test from 'node:test';

import {
    EDITOR_AUTHORING_CONTRACT_VERSION,
    EDITOR_OBJECT_TYPES,
    EDITOR_CONTENT_DESCRIPTOR_FIELDS,
    EDITOR_UI_METADATA_FIELDS,
    isKnownEditorObjectType,
    getEditorAuthoringDescriptor,
} from '../src/shared/contracts/EditorAuthoringContract.js';

test('EDITOR_AUTHORING_CONTRACT_VERSION is a non-empty string', () => {
    assert.equal(typeof EDITOR_AUTHORING_CONTRACT_VERSION, 'string');
    assert.ok(EDITOR_AUTHORING_CONTRACT_VERSION.length > 0);
});

test('EDITOR_OBJECT_TYPES contains all eight authoritative types', () => {
    const expected = ['hard', 'foam', 'portal', 'spawn', 'item', 'aircraft', 'tunnel', 'checkpoint'];
    const actual = Object.values(EDITOR_OBJECT_TYPES);
    assert.equal(actual.length, expected.length, 'Object type count must be 8');
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
