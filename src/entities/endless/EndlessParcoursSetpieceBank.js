import * as THREE from 'three';
import { loadGLBMap } from '../GLBMapLoader.js';
import { createGlbAnimationTrack, GlbAnimationDriver } from '../arena/GlbAnimationDriver.js';
import { createDynamicMeshCollider, refreshDynamicMeshCollider } from '../arena/StaticMeshCollider.js';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';
import { deriveEndlessSeed } from '../../shared/contracts/EndlessParcoursContract.js';
import { placeEndlessCourseMesh } from './EndlessParcoursCourseSpace.js';
import { ENDLESS_SETPIECES, resolveEndlessSetpiece } from './EndlessParcoursSetpieceCatalog.js';

function disposeTemplate(entry) {
    for (const mixer of entry.animationMixers || []) {
        mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot());
    }
    disposeObject3DResources(entry.scene, { skipGeometry: () => false, skipMaterial: () => false });
}

function shareTemplate(scene) {
    scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.geometry.userData.__sharedNoDispose = true;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if (material) material.userData.__sharedNoDispose = true;
        }
    });
}

/** Bounded per-run assets. Instances share immutable render resources, never mixers or colliders. */
export class EndlessParcoursSetpieceBank {
    constructor({ loader = null } = {}) {
        this.loader = loader;
        this.templates = new Map();
        this.disposed = false;
        this.ready = false;
        this.pending = null;
        this.instanceCount = 0;
    }

    prepare() {
        if (this.disposed) return Promise.reject(new Error('Endlos obstacle bank is disposed'));
        if (!this.pending) this.pending = this._load();
        return this.pending;
    }

    async _load() {
        try {
            for (const definition of ENDLESS_SETPIECES) {
                const entry = await loadGLBMap(definition.url, {
                    ...(this.loader ? { loader: this.loader } : {}),
                    collectColliders: false, sceneName: `endless-template:${definition.id}`,
                });
                if (this.disposed) {
                    disposeTemplate(entry);
                    throw new Error('Endlos obstacle preparation was cancelled');
                }
                const clip = entry.animationTracks[0]?.action.getClip();
                if (!clip) {
                    disposeTemplate(entry);
                    throw new Error(`Endlos obstacle has no animation: ${definition.id}`);
                }
                for (const mixer of entry.animationMixers) {
                    mixer.stopAllAction(); mixer.uncacheRoot(entry.scene);
                }
                shareTemplate(entry.scene);
                this.templates.set(definition.id, { scene: entry.scene, clip });
            }
            this.ready = true;
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    create(module, baseSeed, elapsedSeconds = 0) {
        const definition = resolveEndlessSetpiece(module);
        if (!definition || !this.ready || this.disposed) return null;
        const template = this.templates.get(definition.id);
        const root = new THREE.Group();
        root.name = `endless-module:${module.moduleIndex}:${definition.id}`;
        placeEndlessCourseMesh(root, module, 0, 0, 60);
        const alignment = new THREE.Group();
        alignment.rotation.set(definition.rotation[0], definition.rotation[1], definition.rotation[2]);
        alignment.scale.setScalar(definition.scale);
        const offset = new THREE.Group(); offset.position.set(definition.center[0], definition.center[1], definition.center[2]).multiplyScalar(-1);
        const scene = template.scene.clone(true);
        offset.add(scene); alignment.add(offset); root.add(alignment);
        const mixer = new THREE.AnimationMixer(scene), action = mixer.clipAction(template.clip);
        action.play();
        const driver = new GlbAnimationDriver();
        driver.setTracks([createGlbAnimationTrack({ mixer, action, clip: template.clip,
            clock: { beatSeconds: definition.beatSeconds,
                phaseOffsetBeats: deriveEndlessSeed(baseSeed, `setpiece:${module.moduleIndex}`) % 1000 / 1000 },
        })]);
        driver.setElapsedSeconds(elapsedSeconds); root.updateMatrixWorld(true);
        const colliders = [];
        scene.traverse(mesh => {
            if (!mesh.isMesh) return;
            // The source's static signal disc is decoration for a dynamic-only map.
            // Omit it from this full-collision passage, both visibly and physically.
            if ('omitMeshes' in definition && definition.omitMeshes.includes(mesh.name)) { mesh.visible = false; return; }
            if (mesh.name.toLowerCase().includes('_nocol')) return;
            const meshCollider = createDynamicMeshCollider(mesh);
            if (!meshCollider) throw new Error(`Unsupported Endlos obstacle mesh: ${mesh.name}`);
            const box = new THREE.Box3();
            refreshDynamicMeshCollider(meshCollider,box);
            colliders.push({ id: `${root.name}:${mesh.name}`, ownerId: `endless-module:${module.moduleIndex}`,
                sourceName: mesh.name, kind: 'hard', isWall: false, dynamic: true,
                meshCollider, box });
        });
        this.instanceCount += 1;
        let disposed = false;
        return {
            id: definition.id, root, colliders,
            update(seconds) {
                if (disposed) return;
                driver.setElapsedSeconds(seconds); root.updateMatrixWorld(true);
                for (const collider of colliders) refreshDynamicMeshCollider(collider.meshCollider, collider.box);
            },
            dispose: () => {
                if (disposed) return;
                disposed = true; driver.clear(); this.instanceCount -= 1;
            },
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.ready = false;
        for (const template of this.templates.values()) disposeTemplate(template);
        this.templates.clear();
    }
}
