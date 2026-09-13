import { createEditorTurretMesh } from './EditorTurretMesh.js';
import { normalizeStaticTurretDefinition } from '../../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import * as THREE from 'three';
import { getDefaultEditorItemPickupType } from '../../src/shared/contracts/EditorAuthoringContract.js';

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function applyForwardOrientation(mesh, forwardValue) {
    if (!Array.isArray(forwardValue) || forwardValue.length < 3) return false;
    const forward = new THREE.Vector3(
        Number(forwardValue[0]) || 0,
        Number(forwardValue[1]) || 0,
        Number(forwardValue[2]) || 0,
    );
    if (forward.lengthSq() <= Number.EPSILON) return false;
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward.normalize());
    return true;
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
        if (!applyForwardOrientation(mesh, props.forward)) mesh.rotation.x = Math.PI / 2;
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
    else if (type === 'turret') {
        const definition = normalizeStaticTurretDefinition({
            weapon: subType || 'rocket', range: 90 * (Number(props.turretAuthoringScale) || 1), cooldown: 3.4, rocketType: 'ROCKET_WEAK',
            destructible: true, maxHp: 90, targetPlayers: 'all', targetTrails: true,
            allowedModes: ['HUNT', 'ARCADE'], ...props, pos: [x, y, z],
        }, 0, { preserveSpatialRange: true });
        const { id, pos, ...settings } = definition;
        void id; void pos;
        Object.assign(userData, settings, { subType: settings.weapon, sizeInfo: 7.2 });
        mesh = createEditorTurretMesh(manager, settings.weapon === 'rocket');
    }
    else if (type === 'item' && subType === 'item_rocket_turret') {
        mesh = createEditorTurretMesh(manager);
        userData.subType = subType;
        userData.pickupType = 'ROCKET_TURRET';
    }
    else if (type === 'item') {
        mesh = manager.assetLoader.getClone(subType) || new THREE.Mesh(manager.sphereGeo, manager.mats.item_fallback);
        mesh.scale.set(50, 50, 50);
        if (subType === 'item_shield' || subType === 'item_coin' || subType === 'item_ring') mesh.scale.set(50, 10, 50);
        if (subType === 'item_capsule' || subType === 'item_rocket') mesh.scale.set(30, 80, 30);
        userData.subType = subType;
        const defaultPickupType = getDefaultEditorItemPickupType(subType);
        if (!userData.pickupType && defaultPickupType) {
            userData.pickupType = defaultPickupType;
        }
    }
    else if (type === 'aircraft') {
        mesh = manager.assetLoader.getClone(subType) || new THREE.Mesh(manager.coneGeo, manager.mats.aircraft_fallback);
        const s = Number(props.modelScale) || 50;
        mesh.scale.set(s, s, s);
        userData.subType = subType;
        userData.modelScale = s;
    }
    else if (type === 'glb') {
        mesh = manager.assetLoader.getClone(subType) || new THREE.Mesh(manager.blockGeo, manager.mats.aircraft_fallback);
        const hasAuthoredScale = Number.isFinite(Number(props.glbScale));
        const targetSize = hasAuthoredScale ? null : (Number(props.targetSize) > 0 ? Number(props.targetSize) : (Number(sizeInfo) || 14));
        const scale = targetSize || Number(props.glbScale);
        mesh.scale.setScalar(scale);
        userData.subType = subType;
        userData.glbUrl = props.glbUrl || manager.assetLoader.getAssetUrl?.(subType) || '';
        if (targetSize) userData.targetSize = targetSize;
        else userData.glbScale = scale;
    }
    else if (type === 'checkpoint') {
        const isFinish = subType === 'finish';
        const mat = isFinish ? manager.mats.checkpoint_finish : manager.mats.checkpoint;
        mesh = new THREE.Mesh(manager.torusGeo, mat);
        const r = Number(props.cpRadius) || (isFinish ? 7.0 : 5.5);
        const scale = r * 14;
        mesh.scale.set(scale, scale, scale);
        if (!applyForwardOrientation(mesh, props.cpForward || [1, 0, 0])) mesh.rotation.x = Math.PI / 2;
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

    if (options.attachSelectionOutlines !== false) {
        manager.attachSelectionOutlines(mesh);
    }

    if (isFiniteNumber(props.rotateY)) {
        mesh.rotation.y = Number(props.rotateY);
    }
    if (isFiniteNumber(props.rotateX)) mesh.rotation.x = Number(props.rotateX);
    if (isFiniteNumber(props.rotateZ)) mesh.rotation.z = Number(props.rotateZ);

    if (type === 'portal' || type === 'checkpoint') {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).normalize().toArray();
        if (type === 'portal') mesh.userData.forward = forward;
        else mesh.userData.cpForward = forward;
    }

    if (options.register === false) return mesh;

    return manager.registerObject(mesh, {
        requestedId,
        updateUi: options.updateUi !== false
    });
}
