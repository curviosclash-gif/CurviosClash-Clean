import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const MODEL_URL = 'assets/models/hydra_v3/glb/hydra_v3.glb';
const UP = new THREE.Vector3(0, 1, 0);

function disposeLoaded(scene) {
    scene?.traverse((object) => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
            if (!material) continue;
            for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
            material.dispose?.();
        }
    });
}

export function createHydraVisual(renderer, scale = 1) {
    if (!renderer?.addToScene) return null;
    const root = new THREE.Group();
    root.scale.setScalar(scale);
    const fallback = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x164a4d, roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x346a66, roughness: 0.6 });
    const bodyGeo = new THREE.SphereGeometry(1, 16, 10);
    const headGeo = new THREE.SphereGeometry(1, 10, 8);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 2.8;
    body.scale.set(3.5, 1.6, 4.1);
    fallback.add(body);
    for (let i = 0; i < 5; i += 1) {
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set((i - 2) * 1.3, 5.8 + (i % 2) * 0.45, 2.2);
        head.scale.set(0.8, 0.72, 1.2);
        fallback.add(head);
    }
    root.add(fallback);
    const warningMat = new THREE.MeshBasicMaterial({ color: 0xff742b, transparent: true, opacity: 0.42, depthWrite: false });
    const warning = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 4), warningMat);
    warning.position.set(0, 2.3, 5.5);
    warning.visible = false;
    root.add(warning);
    const barBack = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.38, 0.12), new THREE.MeshBasicMaterial({ color: 0x16100c }));
    barBack.position.y = 10.2;
    root.add(barBack);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.26, 0.14), new THREE.MeshBasicMaterial({ color: 0x8cfa65 }));
    bar.position.set(0, 10.2, 0.09);
    root.add(bar);
    root.userData.hydra = { fallback, warning, bar, mixer: null, clips: new Map(), model: null, sockets: [], actionKey: '', disposed: false };
    renderer.addToScene(root);
    loader.loadAsync(MODEL_URL).then((gltf) => {
        const state = root.userData.hydra;
        if (state.disposed) { disposeLoaded(gltf.scene); return; }
        gltf.scene.rotation.y = Math.PI;
        root.add(gltf.scene);
        state.model = gltf.scene;
        state.fallback.visible = false;
        state.mixer = new THREE.AnimationMixer(gltf.scene);
        state.clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
        state.sockets = Array.from({ length: 5 }, (_, index) => gltf.scene.getObjectByName(`Mouth_${index + 1}`));
        state.actionKey = '';
    }).catch(() => { /* The visible five-headed fallback keeps gameplay available. */ });
    return root;
}

export function updateHydraVisual(unit, dt = 0) {
    const root = unit?.root;
    const state = root?.userData?.hydra;
    if (!state) return;
    root.position.copy(unit.groundPosition);
    root.rotation.y = unit.yaw;
    const ratio = Math.max(0, Math.min(1, unit.hp / Math.max(1, unit.maxHp)));
    state.bar.scale.x = Math.max(0.001, ratio);
    state.bar.position.x = -2.5 * (1 - ratio);
    state.bar.material.color.setHex(ratio <= 0.3 ? 0xff5533 : 0x8cfa65);
    const attack = unit.hydra;
    state.warning.visible = attack?.phase === 'warning';
    if (state.warning.visible) {
        const angle = Math.atan2(attack.direction.x, attack.direction.z) - unit.yaw;
        state.warning.rotation.y = angle;
        state.warning.position.x = Math.sin(angle) * 5.5;
        state.warning.position.z = Math.cos(angle) * 5.5;
    }
    if (!state.mixer) return;
    const clipName = attack?.phase === 'warning' || attack?.phase === 'active'
        ? `${attack.action === 'snap' ? 'Snap' : 'Spit'}_${attack.head}`
        : (attack?.moving === false ? 'Idle' : 'Walk');
    const actionKey = `${clipName}:${attack?.event || 0}`;
    if (actionKey !== state.actionKey) {
        state.mixer.stopAllAction();
        const clip = state.clips.get(clipName) || state.clips.get('Idle');
        if (clip) {
            const action = state.mixer.clipAction(clip);
            action.reset();
            action.setLoop(clipName.startsWith('Snap') || clipName.startsWith('Spit') ? THREE.LoopOnce : THREE.LoopRepeat);
            action.clampWhenFinished = true;
            action.play();
        }
        state.actionKey = actionKey;
    }
    state.mixer.update(Math.max(0, dt));
}

export function getHydraMouthPosition(unit, head, out) {
    const root = unit?.root;
    const socket = root?.userData?.hydra?.sockets?.[head - 1];
    if (socket) {
        root.updateMatrixWorld(true);
        return socket.getWorldPosition(out);
    }
    const offset = head - 3;
    return out.set(offset * 1.3, 5.8 + (head % 2) * 0.45, 3.4)
        .multiplyScalar(unit.scale).applyAxisAngle(UP, unit.yaw).add(unit.groundPosition);
}

export function removeHydraVisual(renderer, unit) {
    const root = unit?.root;
    if (!root) return;
    const state = root.userData.hydra;
    if (state) {
        state.disposed = true;
        state.mixer?.stopAllAction();
        state.mixer?.uncacheRoot(state.model);
        disposeLoaded(state.model);
        for (const child of root.children) {
            if (child === state.model) continue;
            child.traverse?.((object) => {
                object.geometry?.dispose?.();
                object.material?.dispose?.();
            });
        }
    }
    renderer?.removeFromScene?.(root);
    unit.root = null;
}
