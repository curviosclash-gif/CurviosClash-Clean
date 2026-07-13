/**
 * OBJ-VEHICLE-MESH.JS - 3D model loader for OBJ ships.
 * Loads models from the spaceship pack and adds engine visuals.
 */

import * as THREE from 'three';
import { createLogger } from '../shared/logging/Logger.js';

const logger = createLogger('OBJVehicleMesh');
let OBJ_MTL_LOADER_PROMISE = null;

function loadObjAndMtlModules() {
    if (!OBJ_MTL_LOADER_PROMISE) {
        OBJ_MTL_LOADER_PROMISE = Promise.all([
            import('three/addons/loaders/OBJLoader.js'),
            import('three/addons/loaders/MTLLoader.js'),
        ]).then(([objModule, mtlModule]) => ({
            OBJLoader: objModule.OBJLoader,
            MTLLoader: mtlModule.MTLLoader,
        })).catch((error) => {
            OBJ_MTL_LOADER_PROMISE = null;
            throw error;
        });
    }
    return OBJ_MTL_LOADER_PROMISE;
}

export class OBJVehicleMesh extends THREE.Group {
    constructor(color, shipId = 'ship5') {
        super();
        this.playerColor = color;
        this.shipId = shipId;
        this._loaded = false;
        this._loadingPromise = null;

        this.glowMat = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.6,
        });

        this.forceFieldMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            emissive: 0x00ffff,
            emissiveIntensity: 0.5,
        });

        this._time = 0;
        this.forceFields = [];
        this.muzzle = new THREE.Object3D();
        this.add(this.muzzle);

        this.loadModel();
    }

    loadModel() {
        if (this._loadingPromise) return this._loadingPromise;

        const basePath = 'assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/';
        this._loadingPromise = loadObjAndMtlModules()
            .then(({ OBJLoader, MTLLoader }) => new Promise((resolve, reject) => {
                const mtlLoader = new MTLLoader();
                mtlLoader.setPath(basePath);
                mtlLoader.load(
                    `${this.shipId}.mtl`,
                    (materials) => {
                        try {
                            materials.preload();
                            const objLoader = new OBJLoader();
                            objLoader.setMaterials(materials);
                            objLoader.setPath(basePath);
                            objLoader.load(
                                `${this.shipId}.obj`,
                                (object) => resolve(object),
                                undefined,
                                (error) => reject(error)
                            );
                        } catch (error) {
                            reject(error);
                        }
                    },
                    undefined,
                    (error) => reject(error)
                );
            }))
            .then((object) => {
                this._applyLoadedModel(object);
                return true;
            })
            .catch((error) => {
                logger.warn(`Failed to load ${this.shipId}.obj/.mtl, using fallback mesh.`, error);
                this._applyFallbackModel();
                return false;
            })
            .finally(() => {
                this._loaded = true;
                this.dispatchEvent({ type: 'loaded' });
            });

        return this._loadingPromise;
    }

    _applyLoadedModel(object) {
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        object.position.sub(center);

        const targetSize = 4.5;
        const scale = targetSize / Math.max(size.x, size.y, size.z);
        object.scale.setScalar(scale);

        this.localBox = new THREE.Box3().setFromObject(object);

        object.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        this.add(object);
        this.model = object;

        this.createWingEngines(
            size.x * scale * 0.45,
            size.z * scale,
            size.x * scale * 0.5,
            size.z * scale * 0.4
        );

        this.muzzle.position.set(0, 0, -size.z * scale * 0.6);
    }

    _applyFallbackModel() {
        const fallback = new THREE.Group();

        const hull = new THREE.Mesh(
            new THREE.ConeGeometry(0.7, 2.6, 14),
            new THREE.MeshStandardMaterial({ color: this.playerColor, metalness: 0.4, roughness: 0.45 })
        );
        hull.rotation.x = Math.PI * 0.5;
        hull.position.z = -0.1;
        hull.castShadow = true;
        hull.receiveShadow = true;
        fallback.add(hull);

        const wing = new THREE.Mesh(
            new THREE.BoxGeometry(1.9, 0.12, 0.48),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.7, roughness: 0.35 })
        );
        wing.position.set(0, 0, 0.45);
        wing.castShadow = true;
        wing.receiveShadow = true;
        fallback.add(wing);

        this.add(fallback);
        this.model = fallback;
        this.localBox = new THREE.Box3().setFromObject(fallback);
        this.createWingEngines(0.95, 1.7, 0.9, 0.7);
        this.muzzle.position.set(0, 0, -1.4);
    }

    createWingEngines(wingSpan, depth, forceFieldWidth, forceFieldDepth) {
        const shroudGeo = new THREE.CylinderGeometry(0.28, 0.24, 1.0, 12);
        shroudGeo.rotateX(Math.PI / 2);

        const nozzleGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.35, 12, 1, true);
        nozzleGeo.rotateX(Math.PI / 2);

        const coreGeo = new THREE.SphereGeometry(0.14, 8, 8);
        const engineCoreMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            emissive: 0x00ffff,
            emissiveIntensity: 2.0,
        });

        const createEngineAssembly = (side) => {
            const group = new THREE.Group();
            group.position.set(side * (wingSpan + 0.1), 0, depth * 0.45);

            const shroud = new THREE.Mesh(
                shroudGeo,
                new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.3 })
            );
            group.add(shroud);

            const nozzle = new THREE.Mesh(
                nozzleGeo,
                new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1, roughness: 0.2 })
            );
            nozzle.position.z = 0.5;
            group.add(nozzle);

            const core = new THREE.Mesh(coreGeo, engineCoreMat);
            core.position.z = 0.35;
            group.add(core);

            this.add(group);
            return group;
        };

        const lEng = createEngineAssembly(-1);
        const rEng = createEngineAssembly(1);

        const glowGeo = new THREE.CylinderGeometry(0.2, 0.01, 1.0, 8);
        glowGeo.rotateX(-Math.PI / 2);

        const addFlame = (parent) => {
            const flame = new THREE.Mesh(glowGeo, this.glowMat.clone());
            flame.name = 'flame';
            flame.position.z = 1.0;
            parent.add(flame);
        };

        addFlame(lEng);
        addFlame(rEng);
    }

    tick(dt) {
        this._time += dt;
    }
}
