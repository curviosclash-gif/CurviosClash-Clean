import * as THREE from 'three';

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function toColorHex(value, fallback = 0xffffff) {
    const num = Number(value);
    return Number.isFinite(num) ? num >>> 0 : fallback;
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

    setColor(index, colorHex) {
        const instance = this.instances[index];
        const nextColor = toColorHex(colorHex, 0xffffff);
        if (!instance || instance.colorHex === nextColor) return;
        instance.colorHex = nextColor;
        this._ensureMesh(this.instances.length);
        this.mesh.setColorAt(index, this._tmpColor.setHex(nextColor));
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
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
        for (let i = 0; i < this.instances.length; i++) this._applyInstance(i);
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
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
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
        if (handle._spinActive) this._tmpHandleQuaternion.multiply(handle._spinQuaternion);
        this._tmpWorldPosition.copy(component.localPosition)
            .applyQuaternion(this._tmpHandleQuaternion)
            .add(handle.position);
        this._tmpWorldQuaternion.copy(this._tmpHandleQuaternion).multiply(component.localQuaternion);
        if (component.rotationAxis) this._tmpWorldQuaternion.multiply(component.dynamicQuaternion);
        this._tmpScale.copy(component.localScale).multiply(handle._scaleVector);
        if (!handle.visible) this._tmpScale.set(0, 0, 0);
        this._tmpMatrix.compose(this._tmpWorldPosition, this._tmpWorldQuaternion, this._tmpScale);
        component.batch.setMatrix(component.instanceId, this._tmpMatrix);
    }

    composeLookAtQuaternion(handle, target, outQuaternion) {
        this._tmpLookAt.lookAt(target, handle.position, handle.up);
        outQuaternion.setFromRotationMatrix(this._tmpLookAt);
    }

    dispose() {
        for (const batch of this._batches.values()) batch?.dispose?.();
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

    setColor(colorHex) { this.batch.setColor(this.instanceId, colorHex); }

    setLocalPosition(x, y, z) {
        if (this.localPosition.x === x && this.localPosition.y === y && this.localPosition.z === z) return;
        this.localPosition.set(x, y, z);
        this.handle.syncComponent(this);
    }

    setLocalScale(x, y, z) {
        if (this.localScale.x === x && this.localScale.y === y && this.localScale.z === z) return;
        this.localScale.set(x, y, z);
        this.handle.syncComponent(this);
    }

    setRotation(axis, angle) {
        const nextAngle = Number.isFinite(angle) ? angle : 0;
        if (this.rotationAxis === axis && this.rotationAngle === nextAngle) return;
        this.rotationAxis = axis;
        this.rotationAngle = nextAngle;
        if (axis === 'x') this.dynamicQuaternion.setFromAxisAngle(AXIS_X, nextAngle);
        else if (axis === 'y') this.dynamicQuaternion.setFromAxisAngle(AXIS_Y, nextAngle);
        else if (axis === 'z') this.dynamicQuaternion.setFromAxisAngle(AXIS_Z, nextAngle);
        else {
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
        this._portalVisualUpdater = null;
        this._gateVisualUpdater = null;
    }

    get visible() { return this._visible; }

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
            if (Array.isArray(this.userData[name])) this.userData[name].push(component);
            else if (this.userData[name]) this.userData[name] = [this.userData[name], component];
            else this.userData[name] = component;
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
        if (this._spinActive) this._spinQuaternion.setFromAxisAngle(AXIS_Z, nextAngle);
        else this._spinQuaternion.identity();
        this.syncAll();
    }

    updatePortalVisualState(timeSeconds, pulseStrength = 0, destinationImpulse = false, active = true) {
        this._portalVisualUpdater?.(timeSeconds, pulseStrength, destinationImpulse, active);
    }

    updateGateVisualState(timeSeconds, pulseStrength = 0) {
        this._gateVisualUpdater?.(timeSeconds, pulseStrength);
    }

    syncComponent(component) { this.registry.syncComponent(this, component); }

    syncAll() {
        for (let i = 0; i < this._components.length; i++) {
            this.registry.syncComponent(this, this._components[i]);
        }
    }
}

export function createPortalGateVisualRegistry(renderer) {
    return new PortalGateVisualRegistry(renderer);
}

export function createInstancedVisualHandle(registry, position = null, quaternion = null) {
    return new InstancedVisualHandle(registry, position, quaternion);
}
