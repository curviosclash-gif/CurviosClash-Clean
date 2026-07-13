import * as THREE from 'three';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

const PORTAL_GEOMETRY_CACHE = new Map();
const PORTAL_MATERIAL_CACHE = new Map();

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function markSharedResource(resource) {
    if (!resource?.userData) {
        resource.userData = {};
    }
    resource.userData.__sharedNoDispose = true;
    return resource;
}

function toColorHex(value, fallback = 0xffffff) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return num >>> 0;
}

function getSharedGeometry(key, createGeometry) {
    if (PORTAL_GEOMETRY_CACHE.has(key)) {
        return PORTAL_GEOMETRY_CACHE.get(key);
    }
    const geometry = markSharedResource(createGeometry());
    PORTAL_GEOMETRY_CACHE.set(key, geometry);
    return geometry;
}

function getSharedMaterial(key, createMaterial) {
    if (PORTAL_MATERIAL_CACHE.has(key)) {
        return PORTAL_MATERIAL_CACHE.get(key);
    }
    const material = markSharedResource(createMaterial());
    PORTAL_MATERIAL_CACHE.set(key, material);
    return material;
}

function createColoredStandardMaterial(key, options = {}) {
    return getSharedMaterial(key, () => new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x1f1f1f,
        emissiveIntensity: 0.5,
        roughness: 0.25,
        metalness: 0.65,
        vertexColors: true,
        ...options,
    }));
}

function createColoredBasicMaterial(key, options = {}) {
    return getSharedMaterial(key, () => new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        ...options,
    }));
}

function resolvePortalDisplayColor(color, direction) {
    if (direction === 'UP') return 0x00ff00;
    if (direction === 'DOWN') return 0xff0000;
    return toColorHex(color, 0x00ffcc);
}

function toColorKey(value, fallback = 0xffffff) {
    return toColorHex(value, fallback).toString(16).padStart(6, '0');
}

class InstancedComponentBatch {
    constructor(renderer, key, geometry, material) {
        this.renderer = renderer;
        this.key = key;
        this.geometry = geometry;
        this.material = material;
        this.instances = [];
        this.mesh = null;
        this.capacity = 0;
        this._tmpColor = new THREE.Color();
    }

    allocate(colorHex) {
        const instance = {
            matrix: new THREE.Matrix4(),
            colorHex: toColorHex(colorHex, 0xffffff),
        };
        const index = this.instances.push(instance) - 1;
        this._ensureMesh(index + 1);
        this.mesh.count = this.instances.length;
        this._applyInstance(index);
        return index;
    }

    setMatrix(index, matrix) {
        const instance = this.instances[index];
        if (!instance) return;
        instance.matrix.copy(matrix);
        this._ensureMesh(this.instances.length);
        this.mesh.setMatrixAt(index, instance.matrix);
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    _ensureMesh(requiredCount) {
        const needsRebuild = !this.mesh || !this.mesh.parent || requiredCount > this.capacity;
        if (!needsRebuild) return;

        const nextCapacity = Math.max(4, 1 << Math.ceil(Math.log2(Math.max(1, requiredCount))));
        const oldMesh = this.mesh;

        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, nextCapacity);
        this.mesh.name = this.key;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        this.mesh.frustumCulled = false;
        this.mesh.count = this.instances.length;
        this.capacity = nextCapacity;

        for (let i = 0; i < this.instances.length; i++) {
            this._applyInstance(i);
        }

        this.renderer.addToScene(this.mesh);

        if (oldMesh) {
            this.renderer.removeFromScene(oldMesh);
            oldMesh.dispose();
        }
    }

    _applyInstance(index) {
        const instance = this.instances[index];
        if (!instance || !this.mesh) return;
        this.mesh.setMatrixAt(index, instance.matrix);
        this.mesh.setColorAt(index, this._tmpColor.setHex(instance.colorHex));
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) {
            this.mesh.instanceColor.needsUpdate = true;
        }
    }

    dispose() {
        if (this.mesh) {
            this.renderer.removeFromScene(this.mesh);
            this.mesh.dispose();
        }
        this.mesh = null;
        this.instances = [];
        this.capacity = 0;
    }
}

class PortalGateVisualRegistry {
    constructor(renderer) {
        this.renderer = renderer;
        this._batches = new Map();
        this._tmpMatrix = new THREE.Matrix4();
        this._tmpWorldPosition = new THREE.Vector3();
        this._tmpHandleQuaternion = new THREE.Quaternion();
        this._tmpWorldQuaternion = new THREE.Quaternion();
        this._tmpScale = new THREE.Vector3(1, 1, 1);
        this._tmpLookAt = new THREE.Matrix4();
    }

    getBatch(key, geometry, material) {
        let batch = this._batches.get(key);
        if (!batch) {
            batch = new InstancedComponentBatch(this.renderer, key, geometry, material);
            this._batches.set(key, batch);
        }
        return batch;
    }

    syncComponent(handle, component) {
        this._tmpHandleQuaternion.copy(handle.quaternion);
        if (handle._spinActive) {
            this._tmpHandleQuaternion.multiply(handle._spinQuaternion);
        }

        this._tmpWorldPosition.copy(component.localPosition);
        this._tmpWorldPosition.applyQuaternion(this._tmpHandleQuaternion);
        this._tmpWorldPosition.add(handle.position);

        this._tmpWorldQuaternion.copy(this._tmpHandleQuaternion);
        this._tmpWorldQuaternion.multiply(component.localQuaternion);
        if (component.rotationAxis) {
            this._tmpWorldQuaternion.multiply(component.dynamicQuaternion);
        }

        this._tmpScale.copy(component.localScale);
        this._tmpScale.multiply(handle._scaleVector);
        if (!handle.visible) {
            this._tmpScale.set(0, 0, 0);
        }
        this._tmpMatrix.compose(this._tmpWorldPosition, this._tmpWorldQuaternion, this._tmpScale);
        component.batch.setMatrix(component.instanceId, this._tmpMatrix);
    }

    composeLookAtQuaternion(handle, target, outQuaternion) {
        // Match Object3D.lookAt() for non-camera objects.
        this._tmpLookAt.lookAt(target, handle.position, handle.up);
        outQuaternion.setFromRotationMatrix(this._tmpLookAt);
    }

    dispose() {
        for (const batch of this._batches.values()) {
            batch?.dispose?.();
        }
        this._batches.clear();
    }
}

class InstancedVisualComponent {
    constructor(handle, batch, instanceId, localPosition, localQuaternion, localScale) {
        this.handle = handle;
        this.batch = batch;
        this.instanceId = instanceId;
        this.localPosition = localPosition ? localPosition.clone() : new THREE.Vector3();
        this.localQuaternion = localQuaternion ? localQuaternion.clone() : new THREE.Quaternion();
        this.localScale = localScale ? localScale.clone() : new THREE.Vector3(1, 1, 1);
        this.rotationAxis = null;
        this.rotationAngle = 0;
        this.dynamicQuaternion = new THREE.Quaternion();
    }

    setRotation(axis, angle) {
        const nextAngle = Number.isFinite(angle) ? angle : 0;
        if (this.rotationAxis === axis && this.rotationAngle === nextAngle) {
            return;
        }
        this.rotationAxis = axis;
        this.rotationAngle = nextAngle;

        if (axis === 'x') {
            this.dynamicQuaternion.setFromAxisAngle(AXIS_X, nextAngle);
        } else if (axis === 'y') {
            this.dynamicQuaternion.setFromAxisAngle(AXIS_Y, nextAngle);
        } else if (axis === 'z') {
            this.dynamicQuaternion.setFromAxisAngle(AXIS_Z, nextAngle);
        } else {
            this.rotationAxis = null;
            this.rotationAngle = 0;
            this.dynamicQuaternion.identity();
        }

        this.handle.syncComponent(this);
    }
}

class InstancedVisualHandle {
    constructor(registry, position = null, quaternion = null) {
        this.registry = registry;
        this.position = position ? position.clone() : new THREE.Vector3();
        this.quaternion = quaternion ? quaternion.clone() : new THREE.Quaternion();
        this._scaleVector = new THREE.Vector3(1, 1, 1);
        this.scale = {
            set: (x = 1, y = x, z = x) => {
                this._scaleVector.set(x, y, z);
                this.syncAll();
                return this.scale;
            },
            setScalar: (value = 1) => {
                this._scaleVector.setScalar(value);
                this.syncAll();
                return this.scale;
            },
            toArray: () => this._scaleVector.toArray(),
        };
        this._visible = true;
        this.up = new THREE.Vector3(0, 1, 0);
        this.userData = {};
        this._components = [];
        this._spinQuaternion = new THREE.Quaternion();
        this._spinAngle = 0;
        this._spinActive = false;
    }

    get visible() {
        return this._visible;
    }

    set visible(value) {
        const nextVisible = value !== false;
        if (this._visible === nextVisible) return;
        this._visible = nextVisible;
        this.syncAll();
    }

    addComponent(name, { batchKey, geometry, material, colorHex, localPosition, localQuaternion, localScale }) {
        const batch = this.registry.getBatch(batchKey, geometry, material);
        const instanceId = batch.allocate(colorHex);
        const component = new InstancedVisualComponent(
            this,
            batch,
            instanceId,
            localPosition,
            localQuaternion,
            localScale
        );
        this._components.push(component);
        this.registry.syncComponent(this, component);

        if (name) {
            if (Array.isArray(this.userData[name])) {
                this.userData[name].push(component);
            } else if (this.userData[name]) {
                this.userData[name] = [this.userData[name], component];
            } else {
                this.userData[name] = component;
            }
        }

        return component;
    }

    setRotationFromEuler(euler) {
        if (!euler) return this;
        this.quaternion.setFromEuler(euler);
        this.syncAll();
        return this;
    }

    lookAt(target) {
        if (!target) return this;
        this.registry.composeLookAtQuaternion(this, target, this.quaternion);
        this.syncAll();
        return this;
    }

    setSpinZ(angle) {
        const nextAngle = Number.isFinite(angle) ? angle : 0;
        if (this._spinAngle === nextAngle) return;
        this._spinAngle = nextAngle;
        this._spinActive = Math.abs(nextAngle) > 1e-8;
        if (this._spinActive) {
            this._spinQuaternion.setFromAxisAngle(AXIS_Z, nextAngle);
        } else {
            this._spinQuaternion.identity();
        }
        this.syncAll();
    }

    syncComponent(component) {
        this.registry.syncComponent(this, component);
    }

    syncAll() {
        for (let i = 0; i < this._components.length; i++) {
            this.registry.syncComponent(this, this._components[i]);
        }
    }
}

export function createPortalGateVisualRegistry(renderer) {
    return new PortalGateVisualRegistry(renderer);
}

export function createBoostPortalMesh(position, rotation, color, visualRegistry) {
    const handle = new InstancedVisualHandle(visualRegistry, position);
    handle.setRotationFromEuler(rotation);

    const displayColor = toColorHex(color, 0xffb34d);
    const displayColorKey = toColorKey(displayColor);
    const outerRing = handle.addComponent('outerRing', {
        batchKey: `portal-gate:boost:outer-ring:${displayColorKey}`,
        geometry: getSharedGeometry('boost:outerRing', () => new THREE.TorusGeometry(3.25, 0.22, 12, 48)),
        material: createColoredStandardMaterial(`boost:ringMaterial:${displayColorKey}`, {
            color: displayColor,
            emissive: displayColor,
            emissiveIntensity: 1.0,
            roughness: 0.25,
            metalness: 0.65,
            vertexColors: false,
        }),
        colorHex: displayColor,
    });

    const innerDisk = handle.addComponent('innerDisk', {
        batchKey: 'portal-gate:boost:inner-disk',
        geometry: getSharedGeometry('boost:innerDisk', () => new THREE.RingGeometry(1.2, 2.95, 40, 1)),
        material: getSharedMaterial('boost:innerDiskMaterial', () => new THREE.MeshBasicMaterial({
            color: 0xfff0a8,
            transparent: true,
            opacity: 0.28,
            side: THREE.DoubleSide,
        })),
        colorHex: 0xfff0a8,
    });

    handle.userData.spines = [];
    const spineGeometry = getSharedGeometry('boost:spineGeometry', () => new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6));
    const spineMaterial = getSharedMaterial('boost:spineMaterial', () => new THREE.MeshBasicMaterial({
        color: 0xffd17c,
        transparent: true,
        opacity: 0.65,
    }));
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6;
        handle.addComponent('spines', {
            batchKey: 'portal-gate:boost:spines',
            geometry: spineGeometry,
            material: spineMaterial,
            colorHex: 0xffd17c,
            localPosition: new THREE.Vector3(Math.cos(angle) * 1.75, Math.sin(angle) * 1.75, 0),
            localQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, angle)),
        });
    }

    handle.userData.outerRing = outerRing;
    handle.userData.innerDisk = innerDisk;
    return handle;
}

export function createSlingshotGateMesh(position, rotation, color, visualRegistry) {
    const handle = new InstancedVisualHandle(visualRegistry, position);
    handle.setRotationFromEuler(rotation);

    const displayColor = toColorHex(color, 0x7dfbff);
    const displayColorKey = toColorKey(displayColor);
    const frontRing = handle.addComponent('frontRing', {
        batchKey: `portal-gate:slingshot:front-ring:${displayColorKey}`,
        geometry: getSharedGeometry('slingshot:frontRing', () => new THREE.TorusGeometry(2.9, 0.12, 10, 44)),
        material: createColoredStandardMaterial(`slingshot:frontRingMaterial:${displayColorKey}`, {
            color: displayColor,
            emissive: displayColor,
            emissiveIntensity: 0.95,
            roughness: 0.3,
            metalness: 0.6,
            vertexColors: false,
        }),
        colorHex: displayColor,
        localPosition: new THREE.Vector3(0, 0, 0.55),
    });

    const backRing = handle.addComponent('backRing', {
        batchKey: `portal-gate:slingshot:back-ring:${displayColorKey}`,
        geometry: getSharedGeometry('slingshot:backRing', () => new THREE.TorusGeometry(2.2, 0.1, 10, 36)),
        material: createColoredStandardMaterial(`slingshot:backRingMaterial:${displayColorKey}`, {
            color: 0xffffff,
            emissive: displayColor,
            emissiveIntensity: 0.6,
            roughness: 0.4,
            metalness: 0.45,
            vertexColors: false,
        }),
        colorHex: displayColor,
        localPosition: new THREE.Vector3(0, 0, -0.55),
    });

    const axisBeam = handle.addComponent('axisBeam', {
        batchKey: 'portal-gate:slingshot:axis-beam',
        geometry: getSharedGeometry('slingshot:axisBeamGeometry', () => new THREE.CylinderGeometry(0.05, 0.05, 2.1, 8)),
        material: getSharedMaterial('slingshot:axisBeamMaterial', () => new THREE.MeshBasicMaterial({
            color: 0xa7fcff,
            transparent: true,
            opacity: 0.25,
        })),
        colorHex: 0xa7fcff,
        localQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
    });

    handle.userData.frontRing = frontRing;
    handle.userData.backRing = backRing;
    handle.userData.axisBeam = axisBeam;
    return handle;
}

export function createPortalMesh(position, color, direction, visualRegistry, options = {}) {
    const ringSize = Math.max(0.01, Number(resolveGameplayConfig(options.configSource).PORTAL.RING_SIZE) || 4);
    const compactMode = options?.compact === true;
    const ringSizeKey = ringSize.toFixed(3);
    const displayColor = resolvePortalDisplayColor(color, direction);
    const displayColorKey = toColorKey(displayColor);
    const handle = new InstancedVisualHandle(visualRegistry, position);

    handle.addComponent('torus', {
        batchKey: `portal:torus:${ringSizeKey}:${compactMode ? 'compact' : 'full'}:${displayColorKey}`,
        geometry: getSharedGeometry(
            `portal:torusGeometry:${ringSizeKey}:${compactMode ? 'compact' : 'full'}`,
            () => new THREE.TorusGeometry(
                ringSize,
                compactMode ? 0.24 : 0.3,
                compactMode ? 10 : 16,
                compactMode ? 20 : 32
            )
        ),
        material: createColoredStandardMaterial(`portal:torusMaterial:${compactMode ? 'compact' : 'full'}:${displayColorKey}`, {
            color: displayColor,
            emissive: displayColor,
            emissiveIntensity: compactMode ? 0.95 : 1.2,
            roughness: 0.2,
            metalness: 0.8,
            vertexColors: false,
        }),
        colorHex: displayColor,
    });

    handle.addComponent('disc', {
        batchKey: `portal:disc:${ringSizeKey}:${compactMode ? 'compact' : 'full'}:${displayColorKey}`,
        geometry: getSharedGeometry(
            `portal:discGeometry:${ringSizeKey}:${compactMode ? 'compact' : 'full'}`,
            () => new THREE.CircleGeometry(ringSize * (compactMode ? 0.82 : 0.85), compactMode ? 20 : 32)
        ),
        material: createColoredBasicMaterial(`portal:discMaterial:${compactMode ? 'compact' : 'full'}:${displayColorKey}`, {
            color: displayColor,
            transparent: true,
            opacity: compactMode ? 0.12 : 0.15,
            side: THREE.DoubleSide,
            vertexColors: false,
        }),
        colorHex: displayColor,
    });

    if (!compactMode) {
        handle.addComponent('innerTorus', {
            batchKey: `portal:inner-torus:${ringSizeKey}:${displayColorKey}`,
            geometry: getSharedGeometry(
                `portal:innerTorusGeometry:${ringSizeKey}`,
                () => new THREE.TorusGeometry(ringSize * 0.6, 0.15, 12, 24)
            ),
            material: createColoredStandardMaterial(`portal:innerTorusMaterial:${displayColorKey}`, {
                color: 0xffffff,
                emissive: displayColor,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.6,
                metalness: 0.35,
                roughness: 0.35,
                vertexColors: false,
            }),
            colorHex: displayColor,
        });

        if (direction !== 'NEUTRAL') {
            const arrowQuaternion = direction === 'DOWN'
                ? new THREE.Quaternion().setFromAxisAngle(AXIS_X, Math.PI)
                : new THREE.Quaternion();
            handle.userData.arrow = handle.addComponent('arrow', {
                batchKey: `portal:arrow:${displayColorKey}`,
                geometry: getSharedGeometry('portal:arrowGeometry', () => new THREE.ConeGeometry(0.8, 2.5, 8)),
                material: createColoredBasicMaterial(`portal:arrowMaterial:${displayColorKey}`, {
                    color: displayColor,
                    transparent: true,
                    opacity: 0.8,
                    vertexColors: false,
                }),
                colorHex: displayColor,
                localQuaternion: arrowQuaternion,
            });
        }
    }

    handle.userData.direction = direction;
    handle.userData.compact = compactMode;
    return handle;
}
