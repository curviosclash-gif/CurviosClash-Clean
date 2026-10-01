import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { bindEditorRelationshipControls } from '../editor/js/ui/EditorRelationshipControls.js';

function createPortal(id, partnerId = '') {
    const portal = new THREE.Object3D();
    portal.visible = false;
    portal.userData = { id, type: 'portal', portalPartnerId: partnerId };
    return portal;
}

function createSelect() {
    let children = [];
    let selectedValue = '';
    return {
        replaceCount: 0,
        addEventListener() {},
        get children() { return children; },
        get value() { return selectedValue; },
        set value(value) {
            const candidate = String(value);
            selectedValue = children.some((option) => option.value === candidate) ? candidate : '';
        },
        replaceChildren(fragment) {
            children = [...fragment.children];
            this.replaceCount += 1;
        },
    };
}

function createDocumentHarness() {
    let createdOptions = 0;
    return {
        get createdOptions() { return createdOptions; },
        createDocumentFragment() {
            return {
                children: [],
                appendChild(child) { this.children.push(child); },
            };
        },
        createElement(tagName) {
            assert.equal(tagName, 'option');
            createdOptions += 1;
            return { value: '', textContent: '' };
        },
    };
}

test('portal partner options keep nodes for unchanged ordered IDs and refresh the selected value', () => {
    const previousDocument = globalThis.document;
    const documentHarness = createDocumentHarness();
    globalThis.document = documentHarness;

    const scene = new THREE.Scene();
    const objectsContainer = new THREE.Group();
    scene.add(objectsContainer);
    const portalsById = new Map();
    const addPortal = (portal) => {
        objectsContainer.add(portal);
        portalsById.set(portal.userData.id, portal);
    };
    const portalSelect = createSelect();
    const editor = {
        core: { scene, objectsContainer },
        mapManager: { getObjectById: (id) => portalsById.get(id) || null },
        dom: { propPortalPartner: portalSelect },
        isManagedObjectAlive: (portal) => objectsContainer.children.includes(portal),
        executeHistoryMutation(_label, apply) { apply(); },
        showPropPanel() {},
    };

    const portalA = createPortal('portal-a', 'portal-b');
    const portalB = createPortal('portal-b', 'portal-a');
    const portalC = createPortal('portal-c');
    addPortal(portalA);
    addPortal(portalB);
    addPortal(portalC);

    try {
        bindEditorRelationshipControls(editor);

        editor.populateRelationshipFields(portalA);
        assert.deepEqual(portalSelect.children.map((option) => option.value), ['', 'portal-b', 'portal-c']);
        assert.equal(portalSelect.value, 'portal-b');
        assert.equal(portalSelect.replaceCount, 1);
        assert.equal(documentHarness.createdOptions, 3);
        const initialOptions = [...portalSelect.children];

        portalA.userData.portalPartnerId = 'portal-c';
        editor.populateRelationshipFields(portalA);
        assert.equal(portalSelect.replaceCount, 1, 'same ordered IDs must not rebuild the option nodes');
        assert.equal(documentHarness.createdOptions, 3);
        assert.deepEqual(portalSelect.children, initialOptions);
        assert.equal(portalSelect.value, 'portal-c', 'the selected value must still follow current portal data');

        editor.populateRelationshipFields(portalB);
        assert.deepEqual(portalSelect.children.map((option) => option.value), ['', 'portal-a', 'portal-c']);
        assert.equal(portalSelect.value, 'portal-a');
        assert.equal(portalSelect.replaceCount, 2, 'changing selected portal changes the ordered partner IDs');

        objectsContainer.remove(portalC);
        portalsById.delete('portal-c');
        editor.populateRelationshipFields(portalB);
        assert.deepEqual(portalSelect.children.map((option) => option.value), ['', 'portal-a']);
        assert.equal(portalSelect.replaceCount, 3, 'removing a portal updates the options');

        const portalD = createPortal('portal-d');
        addPortal(portalD);
        portalB.userData.portalPartnerId = 'portal-d';
        editor.populateRelationshipFields(portalB);
        assert.deepEqual(portalSelect.children.map((option) => option.value), ['', 'portal-a', 'portal-d']);
        assert.equal(portalSelect.value, 'portal-d');
        assert.equal(portalSelect.replaceCount, 4, 'inserting a portal updates the options');

        objectsContainer.remove(portalA);
        objectsContainer.add(portalA);
        portalB.userData.portalPartnerId = 'portal-a';
        editor.populateRelationshipFields(portalB);
        assert.deepEqual(portalSelect.children.map((option) => option.value), ['', 'portal-d', 'portal-a']);
        assert.equal(portalSelect.value, 'portal-a');
        assert.equal(portalSelect.replaceCount, 5, 'reordering portals rebuilds in the new order');

        portalB.userData.portalPartnerId = 'portal-d';
        const reorderedOptions = [...portalSelect.children];
        editor.populateRelationshipFields(portalB);
        assert.equal(portalSelect.replaceCount, 5, 'selection-only refresh must preserve option nodes');
        assert.deepEqual(portalSelect.children, reorderedOptions);
        assert.equal(portalSelect.value, 'portal-d');

        objectsContainer.remove(portalA);
        portalsById.delete('portal-a');
        objectsContainer.remove(portalD);
        portalsById.delete('portal-d');
        editor.populateRelationshipFields(portalB);
        assert.deepEqual(portalSelect.children.map((option) => option.value), ['']);
        assert.equal(portalSelect.value, '', 'an empty partner list keeps only the unpaired option selected');
        assert.equal(portalSelect.replaceCount, 6);
        editor.populateRelationshipFields(portalB);
        assert.equal(portalSelect.replaceCount, 6, 'an unchanged empty list must also reuse its option node');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});
