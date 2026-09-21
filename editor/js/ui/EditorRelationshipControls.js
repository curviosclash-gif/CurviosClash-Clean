import * as THREE from 'three';

function listByType(editor, type) {
    return Array.from(editor?.core?.objectsContainer?.children || [])
        .filter((object) => object?.userData?.type === type && editor.isManagedObjectAlive(object));
}

export function bindEditorRelationshipControls(editor) {
    if (!editor) return;
    const dom = editor.dom || {};
    const visualGroup = new THREE.Group();
    visualGroup.name = 'editor-relationships';
    visualGroup.userData.editorOverlay = true;
    editor.core.scene.add(visualGroup);
    const portalMaterial = new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.8 });
    const parcoursMaterial = new THREE.LineBasicMaterial({ color: 0xaaff00, transparent: true, opacity: 0.65 });
    const escortMaterial = new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.82 });

    const clearVisuals = () => {
        for (const child of [...visualGroup.children]) {
            visualGroup.remove(child);
            child.geometry?.dispose?.();
        }
    };

    const addLine = (from, to, material) => {
        if (!from?.visible || !to?.visible) return;
        const geometry = new THREE.BufferGeometry().setFromPoints([from.position, to.position]);
        visualGroup.add(new THREE.Line(geometry, material));
    };

    const updateVisuals = () => {
        clearVisuals();
        const portals = listByType(editor, 'portal');
        const seenPairs = new Set();
        for (const portal of portals) {
            const partnerId = String(portal.userData?.portalPartnerId || '');
            const partner = partnerId ? editor.mapManager?.getObjectById?.(partnerId) : null;
            if (!partner || partner.userData?.type !== 'portal') continue;
            const pairKey = [portal.userData.id, partnerId].sort().join(':');
            if (seenPairs.has(pairKey)) continue;
            seenPairs.add(pairKey);
            addLine(portal, partner, portalMaterial);
        }
        const checkpoints = listByType(editor, 'checkpoint')
            .sort((left, right) => (Number(left.userData?.checkpointOrder) || 0) - (Number(right.userData?.checkpointOrder) || 0));
        for (let index = 1; index < checkpoints.length; index += 1) {
            addLine(checkpoints[index - 1], checkpoints[index], parcoursMaterial);
        }
        const escortPoints = listByType(editor, 'escort_waypoint')
            .sort((left, right) => (Number(left.userData?.escortOrder) || 0) - (Number(right.userData?.escortOrder) || 0));
        for (let index = 1; index < escortPoints.length; index += 1) {
            addLine(escortPoints[index - 1], escortPoints[index], escortMaterial);
        }
    };

    const normalizeEscortOrder = (ordered = null) => {
        const unsorted = ordered || listByType(editor, 'escort_waypoint')
            .sort((left, right) => {
                const orderDelta = (Number(left.userData?.escortOrder) || 0) - (Number(right.userData?.escortOrder) || 0);
                return orderDelta || String(left.userData?.id || '').localeCompare(String(right.userData?.id || ''));
            });
        const source = [
            ...unsorted.filter((point) => point.userData?.subType === 'start'),
            ...unsorted.filter((point) => !['start', 'goal'].includes(point.userData?.subType)),
            ...unsorted.filter((point) => point.userData?.subType === 'goal'),
        ];
        source.forEach((point, index) => { point.userData.escortOrder = index; });
        updateVisuals();
    };

    const normalizeCheckpointOrder = (ordered = null) => {
        const source = ordered || listByType(editor, 'checkpoint')
            .sort((left, right) => {
                const orderDelta = (Number(left.userData?.checkpointOrder) || 0) - (Number(right.userData?.checkpointOrder) || 0);
                return orderDelta || String(left.userData?.id || '').localeCompare(String(right.userData?.id || ''));
            });
        const checkpoints = [
            ...source.filter((checkpoint) => checkpoint.userData?.subType !== 'finish'),
            ...source.filter((checkpoint) => checkpoint.userData?.subType === 'finish'),
        ];
        checkpoints.forEach((checkpoint, index) => {
            checkpoint.userData.checkpointOrder = index;
        });
        updateVisuals();
    };

    const setPortalPartner = (portal, partnerId) => {
        if (!portal || portal.userData?.type !== 'portal') return;
        const oldPartner = editor.mapManager?.getObjectById?.(String(portal.userData.portalPartnerId || ''));
        if (oldPartner?.userData?.portalPartnerId === portal.userData.id) oldPartner.userData.portalPartnerId = '';
        portal.userData.portalPartnerId = '';
        const partner = editor.mapManager?.getObjectById?.(String(partnerId || ''));
        if (partner && partner !== portal && partner.userData?.type === 'portal') {
            const previous = editor.mapManager?.getObjectById?.(String(partner.userData.portalPartnerId || ''));
            if (previous?.userData?.portalPartnerId === partner.userData.id) previous.userData.portalPartnerId = '';
            portal.userData.portalPartnerId = partner.userData.id;
            partner.userData.portalPartnerId = portal.userData.id;
        }
        updateVisuals();
    };

    editor.populateRelationshipFields = (object) => {
        if (dom.propPortalPartnerRow) dom.propPortalPartnerRow.style.display = object?.userData?.type === 'portal' ? 'grid' : 'none';
        if (dom.propCheckpointOrderRow) dom.propCheckpointOrderRow.style.display = ['checkpoint', 'escort_waypoint'].includes(object?.userData?.type) ? 'grid' : 'none';
        if (object?.userData?.type === 'portal' && dom.propPortalPartner) {
            const fragment = document.createDocumentFragment();
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = 'Noch ohne Partner';
            fragment.appendChild(empty);
            for (const portal of listByType(editor, 'portal')) {
                if (portal === object) continue;
                const option = document.createElement('option');
                option.value = portal.userData.id;
                option.textContent = portal.userData.id;
                fragment.appendChild(option);
            }
            dom.propPortalPartner.replaceChildren(fragment);
            dom.propPortalPartner.value = String(object.userData.portalPartnerId || '');
        }
        if (object?.userData?.type === 'checkpoint' && dom.propCheckpointOrder) {
            dom.propCheckpointOrder.value = String(Number(object.userData.checkpointOrder) || 0);
        } else if (object?.userData?.type === 'escort_waypoint' && dom.propCheckpointOrder) {
            dom.propCheckpointOrder.value = String(Number(object.userData.escortOrder) || 0);
        }
    };

    dom.propPortalPartner?.addEventListener('change', () => {
        const portal = editor.selectedObject;
        editor.executeHistoryMutation('Pair portals', () => setPortalPartner(portal, dom.propPortalPartner.value));
        editor.showPropPanel(portal);
    });
    dom.propCheckpointOrder?.addEventListener('change', () => {
        const selected = editor.selectedObject;
        if (!['checkpoint', 'escort_waypoint'].includes(selected?.userData?.type)) return;
        editor.executeHistoryMutation('Reorder checkpoint', () => {
            if (selected.userData.type === 'escort_waypoint') {
                const route = listByType(editor, 'escort_waypoint').filter((entry) => entry !== selected)
                    .sort((left, right) => (Number(left.userData.escortOrder) || 0) - (Number(right.userData.escortOrder) || 0));
                const nextIndex = Math.max(0, Math.min(route.length, Number(dom.propCheckpointOrder.value) || 0));
                route.splice(nextIndex, 0, selected);
                normalizeEscortOrder(route);
                return;
            }
            const checkpoints = listByType(editor, 'checkpoint').filter((entry) => entry !== selected)
                .sort((left, right) => (Number(left.userData.checkpointOrder) || 0) - (Number(right.userData.checkpointOrder) || 0));
            const nextIndex = Math.max(0, Math.min(checkpoints.length, Number(dom.propCheckpointOrder.value) || 0));
            checkpoints.splice(nextIndex, 0, selected);
            normalizeCheckpointOrder(checkpoints);
        });
        editor.showPropPanel(selected);
    });

    editor.reorderCheckpointById = (sourceId, targetId) => {
        const checkpoints = listByType(editor, 'checkpoint')
            .sort((left, right) => (Number(left.userData.checkpointOrder) || 0) - (Number(right.userData.checkpointOrder) || 0));
        const sourceIndex = checkpoints.findIndex((entry) => entry.userData.id === sourceId);
        const targetIndex = checkpoints.findIndex((entry) => entry.userData.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false;
        if (checkpoints[sourceIndex].userData?.subType === 'finish') return false;
        const [source] = checkpoints.splice(sourceIndex, 1);
        checkpoints.splice(targetIndex, 0, source);
        normalizeCheckpointOrder(checkpoints);
        return true;
    };
    editor.normalizeCheckpointOrder = normalizeCheckpointOrder;
    editor.normalizeEscortOrder = normalizeEscortOrder;
    editor.updateRelationshipVisuals = updateVisuals;
    editor.setPortalPartner = setPortalPartner;
    const initializeRelationships = () => {
        const legacyPortals = listByType(editor, 'portal');
        if (legacyPortals.length % 2 === 0 && legacyPortals.every((portal) => !Object.prototype.hasOwnProperty.call(portal.userData, 'portalPartnerId'))) {
            for (let index = 0; index < legacyPortals.length; index += 2) {
                legacyPortals[index].userData.portalPartnerId = legacyPortals[index + 1].userData.id;
                legacyPortals[index + 1].userData.portalPartnerId = legacyPortals[index].userData.id;
            }
        }
        const checkpoints = listByType(editor, 'checkpoint');
        checkpoints.forEach((checkpoint, index) => {
            if (!Number.isFinite(Number(checkpoint.userData?.checkpointOrder))) checkpoint.userData.checkpointOrder = index;
        });
        normalizeCheckpointOrder();
        const escortPoints = listByType(editor, 'escort_waypoint');
        escortPoints.forEach((point, index) => {
            if (!Number.isFinite(Number(point.userData?.escortOrder))) point.userData.escortOrder = index;
        });
        normalizeEscortOrder();
    };
    editor.initializeRelationships = initializeRelationships;
    initializeRelationships();
    updateVisuals();
}
