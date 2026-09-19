import * as THREE from 'three';

export function createProjectileCosmeticMaterials(assets) {
    return {
        bodyMaterial: assets.bodyMat.clone(),
        tipMaterial: assets.tipMat.clone(),
        finMaterial: assets.finMat.clone(),
        flameMaterial: assets.flameMat.clone(),
    };
}

export function createProjectileCosmeticGroup(assets) {
    const group = new THREE.Group();
    const materials = createProjectileCosmeticMaterials(assets);
    group.add(new THREE.Mesh(assets.bodyGeo, materials.bodyMaterial));
    const tip = new THREE.Mesh(assets.tipGeo, materials.tipMaterial);
    tip.position.z = -0.8;
    group.add(tip);
    for (let index = 0; index < 4; index += 1) {
        const fin = new THREE.Mesh(assets.finGeo, materials.finMaterial);
        fin.position.z = 0.5;
        const angle = (Math.PI / 2) * index;
        if (index % 2 === 0) fin.position.x = Math.cos(angle) * 0.2;
        else { fin.position.y = Math.sin(angle) * 0.2; fin.rotation.z = Math.PI / 2; }
        group.add(fin);
    }
    const flame = new THREE.Mesh(assets.flameGeo, materials.flameMaterial);
    flame.position.z = 0.85;
    group.add(flame);
    group.userData.flame = flame;
    group.userData.cosmeticMaterials = materials;
    return group;
}

export function applyProjectileCosmeticColor(mesh, color) {
    const materials = mesh?.userData?.cosmeticMaterials;
    if (!materials) return;
    materials.bodyMaterial.color.setHex(color);
    materials.bodyMaterial.emissive.setHex(color);
    materials.tipMaterial.emissive.setHex(color);
    materials.finMaterial.color.setHex(color);
    materials.finMaterial.emissive.setHex(color);
    materials.flameMaterial.color.setHex(color);
}

export function disposeProjectileCosmeticMaterials(mesh) {
    for (const material of Object.values(mesh?.userData?.cosmeticMaterials || {})) material?.dispose?.();
}
