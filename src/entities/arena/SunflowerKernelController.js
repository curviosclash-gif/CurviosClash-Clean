import * as THREE from 'three';
import { DandelionSeedRenderBatch } from './DandelionSeedRenderBatch.js';

const HEAD_ROLE = 'shootable_sunflower_head';
const KERNEL_ROLE = 'shootable_kernel';
const FLIGHT_SECONDS = 4.5;
const INITIAL_OUTWARD_SPEED = 7.4;
const HIT_TANGENT_SPEED = 1.15;
const UPWARD_SPEED = 0.85;
const GRAVITY = 9.81;
const MAX_HIT_PADDING_FRACTION = 0.22;
const UP = new THREE.Vector3(0, 1, 0);

function raySphereEntry(origin, direction, center, radius, maxDistance) {
    const ox = origin.x - center.x;
    const oy = origin.y - center.y;
    const oz = origin.z - center.z;
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    if (c <= 0) return 0;
    const b = ox * direction.x + oy * direction.y + oz * direction.z;
    const discriminant = b * b - c;
    if (discriminant < 0) return Infinity;
    const entry = -b - Math.sqrt(discriminant);
    return entry >= 0 && entry < maxDistance ? entry : Infinity;
}

function quantizeDirection(direction, out) {
    if (!direction || direction.lengthSq() <= 0.000001) return out.set(0, 0, 0);
    return out.copy(direction).normalize().set(
        Math.round(THREE.MathUtils.clamp(out.x, -1, 1) * 1000) / 1000,
        Math.round(THREE.MathUtils.clamp(out.y, -1, 1) * 1000) / 1000,
        Math.round(THREE.MathUtils.clamp(out.z, -1, 1) * 1000) / 1000,
    ).normalize();
}

function colorForKernel(index) {
    const value = (Math.imul(index, 0x9e3779b1) >>> 0) / 0xffffffff;
    const palette = [
        [0.73, 0.71, 0.69],
        [0.82, 0.75, 0.67],
        [0.70, 0.75, 0.81],
        [0.85, 0.81, 0.74],
    ];
    const shade = palette[index % palette.length];
    return new THREE.Color().setRGB(shade[0] * (0.94 + value * 0.09),
        shade[1] * (0.94 + value * 0.09), shade[2] * (0.94 + value * 0.09));
}

function matrixWorldScale(node, out) {
    const elements = node.matrixWorld.elements;
    return out.set(
        Math.hypot(elements[0], elements[1], elements[2]),
        Math.hypot(elements[4], elements[5], elements[6]),
        Math.hypot(elements[8], elements[9], elements[10]),
    );
}

/** Keeps each heavy achene addressable while batching its attached and airborne rendering. */
export class SunflowerKernelController {
    constructor(scene) {
        this.scene = scene || null;
        this.kernels = [];
        this.byName = new Map();
        this.byIndex = new Map();
        this.heads = [];
        this.events = [];
        this._center = new THREE.Vector3();
        this._scale = new THREE.Vector3(1, 1, 1);
        this._localOrigin = new THREE.Vector3();
        this._localDirection = new THREE.Vector3();
        this._rayPoint = new THREE.Vector3();
        this._normal = new THREE.Vector3();
        this._direction = new THREE.Vector3();
        this._tangent = new THREE.Vector3();
        this._side = new THREE.Vector3();
        this._target = new THREE.Vector3();
        this._tumble = new THREE.Quaternion();
        this._worldQuaternion = new THREE.Quaternion();
        this._parentWorldQuaternionInverse = new THREE.Quaternion();
        this._inverseMatrix = new THREE.Matrix4();

        scene?.updateWorldMatrix?.(true, true);
        scene?.traverse?.((node) => {
            const role = node?.userData?.role;
            if (role === HEAD_ROLE) {
                const radius = Number(node.userData.kernel_hit_radius);
                if (radius > 0) this.heads.push({ node, radius });
                return;
            }
            if (role !== KERNEL_ROLE) return;
            const index = Number(node.userData.kernel_index);
            const radiusX = Number(node.userData.hit_radius_x);
            const radiusY = Number(node.userData.hit_radius_y);
            const radiusZ = Number(node.userData.hit_radius_z);
            if (!Number.isInteger(index) || index <= 0
                || !(radiusX > 0) || !(radiusY > 0) || !(radiusZ > 0)
                || !node.parent || this.byIndex.has(index) || this.byName.has(node.name)) return;

            const kernel = {
                index,
                node,
                homeParent: node.parent,
                restPosition: node.position.clone(),
                restQuaternion: node.quaternion.clone(),
                restScale: node.scale.clone(),
                radii: new THREE.Vector3(radiusX, radiusY, radiusZ),
                worldStart: node.getWorldPosition(new THREE.Vector3()),
                velocity: new THREE.Vector3(),
                hitDirection: new THREE.Vector3(),
                flightQuaternion: new THREE.Quaternion(),
                color: colorForKernel(index),
                releasedAt: null,
                visible: true,
                spin: 0.75 + ((index * 37) % 41) * 0.014,
            };
            this.kernels.push(kernel);
            this.byName.set(node.name, kernel);
            this.byIndex.set(index, kernel);
        });
        this.kernels.sort((a, b) => a.index - b.index);
        if (this.kernels.length === 0) {
            this.flightRoot = null;
            this._renderBatch = null;
            return;
        }

        this.flightRoot = new THREE.Group();
        this.flightRoot.name = 'SunflowerKernelFlightRoot_nocol';
        this.flightRoot.userData.role = 'sunflower_kernel_flight_root';
        if (scene?.isObject3D) scene.add(this.flightRoot);
        for (const kernel of this.kernels) kernel.height = 1;
        this._renderBatch = DandelionSeedRenderBatch.create(scene, this.kernels, {
            name: 'SunflowerKernelRenderBatches',
            role: 'sunflower_kernel_render_batches',
        });
    }

    get count() { return this.kernels.length; }

    getRenderBatchMetrics() {
        return this._renderBatch?.getMetrics()
            || { enabled: false, batches: 0, instances: 0, estimatedDrawCalls: 0 };
    }

    _kernelEntry(origin, direction, kernel, padding, maxDistance) {
        const node = kernel.node;
        this._inverseMatrix.copy(node.matrixWorld).invert();
        this._localOrigin.copy(origin).applyMatrix4(this._inverseMatrix);
        const e = this._inverseMatrix.elements;
        this._localDirection.set(
            e[0] * direction.x + e[4] * direction.y + e[8] * direction.z,
            e[1] * direction.x + e[5] * direction.y + e[9] * direction.z,
            e[2] * direction.x + e[6] * direction.y + e[10] * direction.z,
        );
        matrixWorldScale(node, this._scale);
        const maxScale = Math.max(this._scale.x, this._scale.y, this._scale.z, 0.0001);
        const maximumRadius = Math.max(kernel.radii.x, kernel.radii.y, kernel.radii.z) * maxScale;
        const localPadding = Math.min(
            Math.max(0, Number(padding) || 0),
            maximumRadius * MAX_HIT_PADDING_FRACTION,
        ) / maxScale;
        const rx = kernel.radii.x + localPadding;
        const ry = kernel.radii.y + localPadding;
        const rz = kernel.radii.z + localPadding;
        const px = this._localOrigin.x / rx;
        const py = this._localOrigin.y / ry;
        const pz = this._localOrigin.z / rz;
        const dx = this._localDirection.x / rx;
        const dy = this._localDirection.y / ry;
        const dz = this._localDirection.z / rz;
        const a = dx * dx + dy * dy + dz * dz;
        if (a <= 0.000001) return Infinity;
        const b = px * dx + py * dy + pz * dz;
        const c = px * px + py * py + pz * pz - 1;
        if (c <= 0) return 0;
        const discriminant = b * b - a * c;
        if (discriminant < 0) return Infinity;
        const entry = (-b - Math.sqrt(discriminant)) / a;
        return entry >= 0 && entry < maxDistance ? entry : Infinity;
    }

    /** Nearest attached kernel on a coarse-tested head, using each achene's transformed ellipsoid. */
    raycast(origin, direction, maxDistance, padding = 0) {
        if (!origin || !direction || !(maxDistance > 0) || this.kernels.length === 0) return null;
        this.scene?.updateWorldMatrix?.(true, true);
        let headCandidate = false;
        for (const head of this.heads) {
            head.node.getWorldPosition(this._center);
            matrixWorldScale(head.node, this._scale);
            const radius = head.radius * Math.max(this._scale.x, this._scale.y, this._scale.z);
            if (raySphereEntry(origin, direction, this._center, radius, maxDistance) < maxDistance) {
                headCandidate = true;
                break;
            }
        }
        if (!headCandidate) return null;

        let nearest = null;
        let distance = maxDistance;
        for (const kernel of this.kernels) {
            if (kernel.releasedAt !== null) continue;
            const entry = this._kernelEntry(origin, direction, kernel, padding, distance);
            if (!(entry < distance)) continue;
            distance = entry;
            nearest = kernel;
        }
        if (!nearest) return null;
        this._rayPoint.copy(direction).multiplyScalar(distance).add(origin);
        return {
            kind: 'sunflower_kernel',
            sourceName: nearest.node.name,
            kernelIndex: nearest.index,
            distance,
            point: { x: this._rayPoint.x, y: this._rayPoint.y, z: this._rayPoint.z },
        };
    }

    releaseByName(name, seconds, hitDirection = null) {
        const kernel = this.byName.get(String(name || ''));
        if (!kernel || kernel.releasedAt !== null) return false;
        this.scene?.updateWorldMatrix?.(true, true);
        const at = Math.round(Math.max(0, Number(seconds) || 0) * 1000) / 1000;
        kernel.releasedAt = at;
        kernel.worldStart.copy(kernel.node.getWorldPosition(this._center));
        kernel.node.getWorldQuaternion(this._worldQuaternion);
        quantizeDirection(hitDirection, kernel.hitDirection);

        this._normal.set(0, 0, 1).applyQuaternion(this._worldQuaternion).normalize();
        this._direction.copy(kernel.hitDirection);
        this._tangent.copy(this._direction)
            .addScaledVector(this._normal, -this._direction.dot(this._normal));
        if (this._tangent.lengthSq() > 0.000001) this._tangent.normalize();
        const sidePhase = ((kernel.index * 0.61803398875) % 1) * Math.PI * 2;
        this._side.set(Math.cos(sidePhase), 0, Math.sin(sidePhase));
        this._side.addScaledVector(this._normal, -this._side.dot(this._normal));
        if (this._side.lengthSq() > 0.000001) this._side.normalize();
        kernel.velocity.copy(this._normal).multiplyScalar(INITIAL_OUTWARD_SPEED)
            .addScaledVector(this._tangent, HIT_TANGENT_SPEED)
            .addScaledVector(UP, UPWARD_SPEED)
            .addScaledVector(this._side, ((kernel.index % 5) - 2) * 0.14);

        this.flightRoot.attach(kernel.node);
        this.flightRoot.updateWorldMatrix(true, false);
        this._parentWorldQuaternionInverse.copy(this.flightRoot.getWorldQuaternion(this._worldQuaternion)).invert();
        kernel.node.getWorldQuaternion(this._worldQuaternion);
        kernel.flightQuaternion.copy(this._parentWorldQuaternionInverse).multiply(this._worldQuaternion);
        this._target.copy(kernel.worldStart);
        kernel.node.position.copy(this.flightRoot.worldToLocal(this._target));
        kernel.node.updateWorldMatrix(true, false);
        kernel.visible = true;
        kernel.node.visible = this._renderBatch ? false : true;
        this._renderBatch?.beginUpdate();
        this._renderBatch?.updateSeed(kernel, true, true);
        this._renderBatch?.commit();
        this.events.push([
            kernel.index,
            Math.round(at * 1000),
            Math.round(kernel.hitDirection.x * 1000),
            Math.round(kernel.hitDirection.y * 1000),
            Math.round(kernel.hitDirection.z * 1000),
        ]);
        return true;
    }

    update(seconds) {
        const now = Math.max(0, Number(seconds) || 0);
        this._renderBatch?.beginUpdate();
        for (const kernel of this.kernels) {
            if (kernel.releasedAt === null) continue;
            const age = Math.max(0, now - kernel.releasedAt);
            if (age >= FLIGHT_SECONDS) {
                if (!kernel.visible) continue;
                this._returnToAttachment(kernel, false);
                this._renderBatch?.updateSeed(kernel, false);
                continue;
            }

            this._target.copy(kernel.worldStart)
                .addScaledVector(kernel.velocity, age);
            this._target.y -= 0.5 * GRAVITY * age * age;
            this.flightRoot.worldToLocal(this._target);
            kernel.node.position.copy(this._target);
            this._tumble.setFromAxisAngle(UP, age * kernel.spin);
            kernel.node.quaternion.copy(kernel.flightQuaternion).multiply(this._tumble);
            kernel.node.updateWorldMatrix(true, false);
            kernel.visible = true;
            kernel.node.visible = this._renderBatch ? false : true;
            this._renderBatch?.updateSeed(kernel, true, true);
        }
        this._renderBatch?.commit();
    }

    _returnToAttachment(kernel, visible) {
        if (kernel.node.parent !== kernel.homeParent) kernel.homeParent.attach(kernel.node);
        kernel.node.position.copy(kernel.restPosition);
        kernel.node.quaternion.copy(kernel.restQuaternion);
        kernel.node.scale.copy(kernel.restScale);
        kernel.node.updateWorldMatrix(true, false);
        kernel.visible = visible;
        kernel.node.visible = this._renderBatch ? false : visible;
    }

    reset() {
        this.scene?.updateWorldMatrix?.(true, true);
        this._renderBatch?.beginUpdate();
        for (const kernel of this.kernels) {
            kernel.releasedAt = null;
            kernel.velocity.set(0, 0, 0);
            kernel.hitDirection.set(0, 0, 0);
            this._returnToAttachment(kernel, true);
            this._renderBatch?.updateSeed(kernel, true);
        }
        this._renderBatch?.commit();
        this.events.length = 0;
    }

    serialize() { return this.events.map((event) => [...event]); }

    applyNetworkState(events) {
        if (!Array.isArray(events)) return;
        const safeEvents = events.slice(0, this.kernels.length);
        let diverged = this.events.length > safeEvents.length;
        for (let index = 0; !diverged && index < this.events.length; index += 1) {
            const current = this.events[index];
            const incoming = safeEvents[index];
            diverged = !Array.isArray(incoming) || current.some(
                (value, axis) => value !== Number(incoming[axis]),
            );
        }
        if (diverged) this.reset();
        for (let index = this.events.length; index < safeEvents.length; index += 1) {
            const event = safeEvents[index];
            const kernel = this.byIndex.get(Number(event?.[0]));
            if (!kernel || !Number.isFinite(Number(event?.[1]))) continue;
            this._direction.set(
                (Number(event?.[2]) || 0) / 1000,
                (Number(event?.[3]) || 0) / 1000,
                (Number(event?.[4]) || 0) / 1000,
            );
            this.releaseByName(kernel.node.name, Number(event[1]) / 1000, this._direction);
        }
    }
}
