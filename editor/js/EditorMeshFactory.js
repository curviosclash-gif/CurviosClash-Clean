import * as THREE from 'three';

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

export function alignTunnelSegment(mesh, pA, pB, radius) {
    const distance = pA.distanceTo(pB);
    if (distance <= 0) return;

    mesh.position.copy(pA).lerp(pB, 0.5);
    mesh.scale.set(radius, distance, radius);
    mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        pB.clone().sub(pA).normalize()
    );

    mesh.userData = {
        ...(mesh.userData || {}),
        pointA: pA.clone(),
        pointB: pB.clone(),
        radius
    };
}

export function createEditorMesh(manager, type, subType, x, y, z, sizeInfo, extraProps = {}, options = {}) {
    const props = { ...(extraProps || {}) };
    const requestedId = props.id;
    let mesh = null;
    const userData = { type, sizeInfo, ...props };

    if (type === 'hard' || type === 'foam') {
        mesh = new THREE.Mesh(manager.blockGeo, manager.mats[type]);
        const fallback = Math.max(10, (Number(sizeInfo) || 70) * 2);
        const sx = Number(props.sizeX) || fallback;
        const sz = Number(props.sizeZ) || fallback;
        const sy = Number(props.sizeY) || fallback;
        mesh.scale.set(sx, sy, sz);
        userData.sizeX = sx;
        userData.sizeZ = sz;
        userData.sizeY = sy;
        userData.sizeInfo = Math.max(sx, sy, sz) * 0.5;
    }
    else if (type === 'tunnel') {
        const trailSubType = (typeof subType === 'string' && subType.startsWith('trail_')) ? subType : null;
        mesh = manager.createTunnelTrailMesh(trailSubType) || new THREE.Mesh(manager.cylinderGeo, manager.mats.tunnel);
        const r = Number(props.radius) || Number(sizeInfo) || 160;
        userData.radius = r;
        if (trailSubType) {
            userData.subType = trailSubType;
        }

        if (props.pointA && props.pointB) {
            alignTunnelSegment(mesh, props.pointA, props.pointB, r);
        } else {
            mesh.scale.set(r, 100, r);
        }
    }
    else if (type === 'portal') {
        const portalSubType = (typeof subType === 'string' && subType.startsWith('portal_')) ? subType : null;
        mesh = (portalSubType ? manager.assetLoader.getClone(portalSubType) : null) || new THREE.Mesh(manager.torusGeo, manager.mats.portal);
        const r = Number(sizeInfo) || Number(props.radius) || 80;
        mesh.scale.set(r, r, r);
        mesh.rotation.x = Math.PI / 2;
        userData.sizeInfo = r;
        userData.radius = r;
        if (portalSubType) {
            userData.subType = portalSubType;
        }
    }
    else if (type === 'spawn') {
        mesh = new THREE.Mesh(manager.torusKnotGeo, subType === 'player' ? manager.mats.playerSpawn : manager.mats.botSpawn);
        mesh.scale.set(40, 40, 40);
        userData.subType = subType;
    }
    else if (type === 'item') {
        mesh = manager.assetLoader.getClone(subType) || new THREE.Mesh(manager.sphereGeo, manager.mats.item_fallback);
        mesh.scale.set(50, 50, 50);
        if (subType === 'item_shield' || subType === 'item_coin' || subType === 'item_ring') mesh.scale.set(50, 10, 50);
        if (subType === 'item_capsule' || subType === 'item_rocket') mesh.scale.set(30, 80, 30);
        userData.subType = subType;
    }
    else if (type === 'aircraft') {
        mesh = manager.assetLoader.getClone(subType) || new THREE.Mesh(manager.coneGeo, manager.mats.aircraft_fallback);
        const s = Number(props.modelScale) || 50;
        mesh.scale.set(s, s, s);
        userData.subType = subType;
        userData.modelScale = s;
    }
    else if (type === 'checkpoint') {
        const isFinish = subType === 'finish';
        const mat = isFinish ? manager.mats.checkpoint_finish : manager.mats.checkpoint;
        mesh = new THREE.Mesh(manager.torusGeo, mat);
        const r = Number(props.cpRadius) || (isFinish ? 7.0 : 5.5);
        const scale = r * 14;
        mesh.scale.set(scale, scale, scale);
        mesh.rotation.x = Math.PI / 2;
        userData.subType = subType;
        userData.cpRadius = r;
        userData.cpForward = props.cpForward || [1, 0, 0];
        if (typeof props.aliasOf === 'string') {
            userData.aliasOf = props.aliasOf;
        }
    }

    if (!mesh) {
        console.warn(`[EditorMapManager] Unsupported mesh type "${type}"`);
        return null;
    }

    mesh.position.set(x, y, z);
    mesh.userData = {
        ...(mesh.userData || {}),
        ...userData
    };

    manager.attachSelectionOutlines(mesh);

    if (isFiniteNumber(props.rotateY)) {
        mesh.rotation.y = Number(props.rotateY);
    }

    return manager.registerObject(mesh, {
        requestedId,
        updateUi: options.updateUi !== false
    });
}
