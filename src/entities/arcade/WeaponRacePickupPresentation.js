import * as THREE from 'three';
import { WEAPON_RACE_WEAPON_STAGES } from '../../shared/contracts/WeaponRaceContract.js';

const COLORS = Object.freeze([0x78d7ff, 0xff7a32, 0xffc22e, 0xc899ff, 0x72f7ff]);

export class WeaponRacePickupPresentation {
    constructor(renderer = null) {
        this.renderer = renderer;
        this.root = null;
        this.geometry = null;
        this.materials = [];
    }

    start(route = null) {
        this.dispose();
        if (!this.renderer?.addToScene || !Array.isArray(route?.checkpoints)) return false;
        this.root = new THREE.Group();
        this.root.name = 'weapon-race-checkpoint-pickups';
        this.geometry = new THREE.OctahedronGeometry(1.45, 0);
        for (let index = 0; index < WEAPON_RACE_WEAPON_STAGES.length; index += 1) {
            const stage = WEAPON_RACE_WEAPON_STAGES[index];
            const checkpoint = route.checkpoints.find((entry) => entry?.id === stage.checkpointId);
            if (!checkpoint?.pos) continue;
            const material = new THREE.MeshStandardMaterial({
                color: COLORS[index], emissive: COLORS[index], emissiveIntensity: 1.2,
                transparent: true, opacity: 0.84, roughness: 0.3, metalness: 0.35,
            });
            this.materials.push(material);
            const mesh = new THREE.Mesh(this.geometry, material);
            mesh.name = `weapon-race-pickup:${stage.weaponId}`;
            mesh.position.set(checkpoint.pos[0], checkpoint.pos[1] + 3.2, checkpoint.pos[2]);
            mesh.userData.phase = index * 0.9;
            this.root.add(mesh);
        }
        this.renderer.addToScene(this.root);
        return this.root.children.length > 0;
    }

    update(nowMs = 0) {
        if (!this.root) return;
        const time = Math.max(0, Number(nowMs) || 0) * 0.001;
        for (let index = 0; index < this.root.children.length; index += 1) {
            const mesh = this.root.children[index];
            mesh.rotation.y = time * 1.45 + mesh.userData.phase;
            mesh.rotation.x = 0.35 + Math.sin(time * 1.8 + mesh.userData.phase) * 0.12;
            mesh.scale.setScalar(1 + Math.sin(time * 2.4 + mesh.userData.phase) * 0.1);
        }
    }

    dispose() {
        if (this.root) this.renderer?.removeFromScene?.(this.root);
        this.geometry?.dispose?.();
        for (const material of this.materials) material.dispose?.();
        this.materials.length = 0;
        this.geometry = null;
        this.root = null;
    }
}
