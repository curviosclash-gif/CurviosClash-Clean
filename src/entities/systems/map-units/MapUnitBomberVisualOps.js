import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The bomber flies the Blender fighter jet (user decision 28.09.2026). Its size is three times the
// Star-Cruiser (Ship 5): OBJ player ships are fitted to 4.5 units on their longest axis.
export const BOMBER_JET_MODEL_URL = 'assets/models/fighter_jet/glb/01_fighter_jet.glb';
export const BOMBER_JET_LENGTH = 4.5 * 3;
const GEAR_UP_CLIP = 'gear_up';

/**
 * Poses the loaded jet for flight and fits it into a wrapper: gear retracted, nose along +z,
 * longest axis BOMBER_JET_LENGTH, box centred on the origin. Map units travel along
 * (sin yaw, cos yaw) while the GLB noses at -z like a player ship, so it is turned round the
 * same way the hydra is.
 * @param {THREE.Object3D} scene
 * @param {THREE.AnimationClip[]} [clips]
 * @returns {THREE.Group}
 */
export function fitBomberJetModel(scene, clips = []) {
    const gearUp = clips.find((clip) => clip.name === GEAR_UP_CLIP);
    if (gearUp) {
        // One sampled frame at the clip's end; the mixer is not kept, the posed nodes are.
        const mixer = new THREE.AnimationMixer(scene);
        const action = mixer.clipAction(gearUp);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        mixer.update(gearUp.duration);
    }
    scene.rotation.y = Math.PI;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = BOMBER_JET_LENGTH / Math.max(0.001, size.x, size.y, size.z);
    const centre = box.getCenter(new THREE.Vector3());
    scene.position.sub(centre);
    const wrapper = new THREE.Group();
    wrapper.scale.setScalar(scale);
    wrapper.add(scene);
    return wrapper;
}

export function createBomberAssets() {
    return {
        box: new THREE.BoxGeometry(1, 1, 1),
        bodyMaterial: new THREE.MeshStandardMaterial({
            color: 0x4c5663, roughness: 0.58, metalness: 0.48,
        }),
        accentMaterial: new THREE.MeshStandardMaterial({
            color: 0xc74736, emissive: 0x32100c, emissiveIntensity: 0.28, roughness: 0.42, metalness: 0.4,
        }),
        // Loaded once per map-unit system; every bomber gets a clone sharing its geometry.
        jet: null,
        jetPromise: null,
        disposed: false,
    };
}

function loadJetTemplate(assets) {
    if (!assets.jetPromise) {
        assets.jetPromise = new GLTFLoader().loadAsync(BOMBER_JET_MODEL_URL).then((gltf) => {
            if (assets.disposed) {
                disposeJet(gltf.scene);
                return null;
            }
            assets.jet = fitBomberJetModel(gltf.scene, gltf.animations);
            return assets.jet;
        }).catch(() => null); // The box bomber keeps flying when the model cannot load.
    }
    return assets.jetPromise;
}

function disposeJet(object) {
    object?.traverse?.((node) => {
        node.geometry?.dispose?.();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
            if (!material) continue;
            for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
            material.dispose?.();
        }
    });
}

export function disposeBomberAssets(assets) {
    if (!assets) return;
    assets.disposed = true;
    assets.box?.dispose?.();
    assets.bodyMaterial?.dispose?.();
    assets.accentMaterial?.dispose?.();
    disposeJet(assets.jet);
    assets.jet = null;
}

function attachJet(root, jet) {
    const state = root.userData.bomberVisual;
    if (!jet || !state || state.jet) return;
    state.jet = jet.clone(true);
    root.add(state.jet);
    state.fallback.visible = false;
}

export function createBomberVisual(renderer, assets, scale = 1) {
    if (!renderer?.addToScene || !assets) return null;
    const root = new THREE.Group();
    root.scale.setScalar(Math.max(0.001, Number(scale) || 1));
    root.userData.bomber = true;

    // The old box bomber stays as the stand-in until the jet has loaded, or for good if it fails.
    const fallback = new THREE.Group();
    const addPart = (position, partScale, material = assets.bodyMaterial) => {
        const mesh = new THREE.Mesh(assets.box, material);
        mesh.position.set(...position);
        mesh.scale.set(...partScale);
        fallback.add(mesh);
    };
    addPart([0, 0, 0], [1.15, 0.55, 3.2]);
    addPart([-2.6, 0, 0.15], [2.1, 0.18, 1.3]);
    addPart([2.6, 0, 0.15], [2.1, 0.18, 1.3]);
    addPart([0, 0.65, 2.45], [0.18, 0.75, 0.85], assets.accentMaterial);
    addPart([0, 0.45, -1.25], [0.72, 0.35, 0.9], assets.accentMaterial);
    root.add(fallback);
    root.userData.bomberVisual = { fallback, jet: null };

    if (assets.jet) attachJet(root, assets.jet);
    else loadJetTemplate(assets).then((jet) => attachJet(root, jet));

    renderer.addToScene(root);
    return root;
}

export function updateBomberVisual(unit) {
    if (!unit?.root) return;
    unit.root.position.copy(unit.position);
    unit.root.rotation.y = unit.yaw;
}
