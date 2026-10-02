import { applyProjectileCosmeticColor, createProjectileCosmeticGroup } from './ProjectileCosmeticMeshOps.js';
import { HYDRA_FIREBALL, createHydraFireballGroup } from './HydraFireballOps.js';
import { createBomberBombMesh } from './BomberBombOps.js';

export function acquireProjectileMesh(system, type, color, visualColor = color) {
    const pool = system._getProjectilePool(type);
    let group = pool.pop();
    if (!group) {
        const assets = type === 'BOMBER_BOMB' ? null : system._getProjectileAssets(type, color);
        group = type === 'BOMBER_BOMB' ? createBomberBombMesh()
            : (type === HYDRA_FIREBALL ? createHydraFireballGroup(assets) : createProjectileCosmeticGroup(assets));
    }
    group.visible = true;
    if (type === 'BOMBER_BOMB') group.userData.bomberBombMaterials?.[0]?.color?.setHex(visualColor);
    else if (type !== HYDRA_FIREBALL) applyProjectileCosmeticColor(group, visualColor);
    if (group.userData.flame) group.userData.flame.scale.set(1, 1, 1);
    if (system.renderer) system.renderer.addToScene(group);
    return group;
}
