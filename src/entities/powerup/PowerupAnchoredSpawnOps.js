import * as THREE from 'three';
import { normalizePickupType } from '../PickupRegistry.js';

export function spawnPowerupAtAnchor(manager, anchor) {
    const type = normalizePickupType(anchor?.type || anchor?.pickupType);
    const powerupConfig = manager?.entityRuntimeConfig?.POWERUP?.TYPES?.[type];
    const ownerId = String(anchor?.ownerId || '').trim();
    if (!manager || !type || !powerupConfig || !ownerId) return null;

    const strategy = typeof manager.getStrategy === 'function' ? manager.getStrategy() : null;
    const allowedTypes = strategy
        ? strategy.filterSpawnableTypes([type], manager.entityRuntimeConfig.POWERUP.TYPES)
        : [type];
    if (!allowedTypes.includes(type)) return null;

    const position = new THREE.Vector3(Number(anchor.x) || 0, Number(anchor.y) || 0, Number(anchor.z) || 0);
    const mesh = manager._createPowerupMesh(type, powerupConfig);
    mesh.position.copy(position);
    mesh.castShadow = false;
    manager.renderer.addToScene(mesh);
    const pickupSize = manager.entityRuntimeConfig.POWERUP.PICKUP_RADIUS * 2;
    const item = {
        mesh,
        type,
        ownerId,
        box: new THREE.Box3().setFromCenterAndSize(position, new THREE.Vector3(pickupSize, pickupSize, pickupSize)),
        networkId: `powerup:${manager._nextNetworkId++}`,
        baseY: position.y,
        phase: 0,
        anchorKey: null,
        telegraphRemaining: 0,
        animationKind: String(powerupConfig.animationKind || 'float'),
        predictedCollected: false,
        predictionAge: 0,
        baseScaleX: mesh.scale.x,
        baseScaleY: mesh.scale.y,
        baseScaleZ: mesh.scale.z,
    };
    manager.items.push(item);
    manager._applyAuthoredItemModel?.(item, anchor, powerupConfig);
    return item;
}

export function removePowerupsByOwnerId(manager, ownerId) {
    const id = String(ownerId || '').trim();
    let removed = 0;
    for (let index = manager.items.length - 1; index >= 0; index -= 1) {
        const item = manager.items[index];
        if (item.ownerId !== id) continue;
        manager.items.splice(index, 1);
        manager._disposeSpawnedItem(item);
        removed += 1;
    }
    return removed;
}
