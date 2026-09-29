import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const REPAIR_DRONE_MODEL_URL = new URL(
    '../../../../assets/models/repair_drone/glb/repair_drone.glb', import.meta.url,
).href;

const ROTOR_NAMES = Object.freeze([
    'rotor_front_left', 'rotor_front_right', 'rotor_rear_left', 'rotor_rear_right',
]);

export function createRepairDroneAssets(options = {}) {
    return {
        bodyGeometry: new THREE.OctahedronGeometry(0.75, 0),
        crossGeometry: new THREE.BoxGeometry(1.35, 0.18, 0.18),
        bodyMaterial: new THREE.MeshStandardMaterial({
            color: 0x49d982,
            emissive: 0x123d28,
            emissiveIntensity: 0.5,
            roughness: 0.45,
            metalness: 0.35,
        }),
        crossMaterial: new THREE.MeshBasicMaterial({ color: 0xeafff1 }),
        loader: options.loader || new GLTFLoader(),
        model: null,
        modelPromise: null,
        disposed: false,
    };
}

function disposeModel(model) {
    model?.traverse((node) => {
        node.geometry?.dispose?.();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
            if (!material) continue;
            for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
            material.dispose?.();
        }
    });
}

function loadModel(assets) {
    if (assets.modelPromise) return assets.modelPromise;
    assets.modelPromise = assets.loader.loadAsync(REPAIR_DRONE_MODEL_URL)
        .then((gltf) => {
            const model = gltf?.scene || null;
            if (assets.disposed) {
                disposeModel(model);
                return null;
            }
            if (!model || ROTOR_NAMES.some((name) => !model.getObjectByName(name))) {
                disposeModel(model);
                return null;
            }
            assets.model = model;
            return model;
        })
        .catch(() => null);
    return assets.modelPromise;
}

function attachModel(root, template) {
    const visual = root.userData.repairDroneVisual;
    if (!template || !visual || visual.removed || visual.model) return;
    visual.model = template.clone(true);
    visual.rotors = ROTOR_NAMES.map((name) => visual.model.getObjectByName(name));
    root.add(visual.model);
    visual.fallback.visible = false;
}

export function createRepairDroneVisual(renderer, assets) {
    if (!renderer?.addToScene || !assets) return null;
    const root = new THREE.Group();
    root.userData.repairDrone = true;
    const fallback = new THREE.Group();
    fallback.add(new THREE.Mesh(assets.bodyGeometry, assets.bodyMaterial));
    const horizontal = new THREE.Mesh(assets.crossGeometry, assets.crossMaterial);
    horizontal.position.z = 0.72;
    fallback.add(horizontal);
    const vertical = new THREE.Mesh(assets.crossGeometry, assets.crossMaterial);
    vertical.position.z = 0.72;
    vertical.rotation.z = Math.PI * 0.5;
    fallback.add(vertical);
    root.add(fallback);
    root.userData.repairDroneVisual = { fallback, model: null, rotors: null, removed: false };
    if (assets.model) attachModel(root, assets.model);
    else loadModel(assets).then((model) => attachModel(root, model));
    renderer.addToScene(root);
    return root;
}

export function updateRepairDroneVisual(drone) {
    if (!drone?.root) return;
    drone.root.position.copy(drone.position);
    drone.root.rotation.y = drone.yaw;
    const rotors = drone.root.userData.repairDroneVisual?.rotors;
    if (rotors) {
        for (let index = 0; index < rotors.length; index += 1) {
            rotors[index].rotation.y = drone.yaw * (index % 2 === 0 ? 18 : -18);
        }
    }
}

export function removeRepairDroneVisual(renderer, drone) {
    if (!drone?.root) return;
    if (drone.root.userData.repairDroneVisual) {
        drone.root.userData.repairDroneVisual.removed = true;
    }
    renderer?.removeFromScene?.(drone.root);
    drone.root = null;
}

export function disposeRepairDroneAssets(assets) {
    if (!assets) return;
    assets.disposed = true;
    for (const value of Object.values(assets)) value?.dispose?.();
    disposeModel(assets.model);
    assets.model = null;
}
