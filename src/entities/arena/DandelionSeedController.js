import * as THREE from 'three';

const FLIGHT_SECONDS = 18;
const UP = new THREE.Vector3(0, 1, 0);
const TUMBLE_AXIS = new THREE.Vector3(1, 0.3, 0).normalize();

/** A slowly turning, deterministic wind shared by the host and every replica. */
export function dandelionWindAt(seconds, out = new THREE.Vector3()) {
    const time = Math.max(0, Number(seconds) || 0);
    const heading = time * 0.022 + 0.55 * Math.sin(time * 0.012)
        + 0.18 * Math.sin(time * 0.005 + 1.4);
    return out.set(Math.cos(heading), 0, Math.sin(heading));
}

/** Keeps the scalable GLB's seed meshes addressable without hundreds of animation tracks. */
export class DandelionSeedController {
    constructor(scene) {
        this.seeds = [];
        this.byName = new Map();
        this.events = [];
        this._wind = new THREE.Vector3();
        this._target = new THREE.Vector3();
        this._tumble = new THREE.Quaternion();
        scene?.updateWorldMatrix?.(true, true);
        scene?.traverse?.((node) => {
            // glTF splits the two seed materials into child meshes; the exported extras and
            // transform live on their shared parent node, which is the object we detach.
            if (node?.userData?.role !== 'shootable_seed') return;
            const index = Number(node.userData.seed_index);
            const height = Number(node.userData.pappus_height);
            if (!Number.isInteger(index) || index <= 0 || !(height > 0)) return;
            const root = node.getWorldPosition(new THREE.Vector3());
            const tip = node.localToWorld(new THREE.Vector3(0, height, 0));
            const normal = tip.clone().sub(root).normalize();
            const scale = node.getWorldScale(new THREE.Vector3());
            const size = Math.max(scale.x, scale.y, scale.z);
            const seed = {
                index, node, root, tip, normal, height,
                radius: size * 0.43,
                speed: size * 0.55,
                restPosition: node.position.clone(),
                restQuaternion: node.quaternion.clone(),
                releasedAt: null,
                launch: new THREE.Vector3(),
                releaseWind: new THREE.Vector3(),
                collisionCenter: tip.clone(),
                hitPlayers: null,
            };
            this.seeds.push(seed);
            this.byName.set(node.name, seed);
        });
        this.seeds.sort((a, b) => a.index - b.index);
        this._collision = { seedIndex: 0, normal: new THREE.Vector3() };
    }

    get count() { return this.seeds.length; }

    /** Nearest still-attached pappus along a normalized shot ray. */
    raycast(origin, direction, maxDistance, padding = 0) {
        if (!origin || !direction || !(maxDistance > 0)) return null;
        let nearest = null;
        let distance = maxDistance;
        for (const seed of this.seeds) {
            if (seed.releasedAt !== null) continue;
            const dx = seed.tip.x - origin.x;
            const dy = seed.tip.y - origin.y;
            const dz = seed.tip.z - origin.z;
            const forward = dx * direction.x + dy * direction.y + dz * direction.z;
            const radius = seed.radius + Math.max(0, padding);
            if (forward < -radius || forward > distance + radius) continue;
            const sideSquared = dx * dx + dy * dy + dz * dz - forward * forward;
            if (sideSquared > radius * radius) continue;
            const entry = Math.max(0, forward - Math.sqrt(Math.max(0, radius * radius - sideSquared)));
            if (entry >= distance) continue;
            distance = entry;
            nearest = seed;
        }
        if (!nearest) return null;
        return {
            sourceName: nearest.node.name,
            seedIndex: nearest.index,
            distance,
            point: {
                x: origin.x + direction.x * distance,
                y: origin.y + direction.y * distance,
                z: origin.z + direction.z * distance,
            },
        };
    }

    releaseByName(name, seconds) {
        const seed = this.byName.get(String(name || ''));
        if (!seed || seed.releasedAt !== null) return false;
        const at = Math.round(Math.max(0, Number(seconds) || 0) * 1000) / 1000;
        seed.releasedAt = at;
        dandelionWindAt(at, seed.releaseWind);
        seed.launch.copy(seed.normal).multiplyScalar(0.48)
            .addScaledVector(seed.releaseWind, 0.78)
            .addScaledVector(UP, 0.22).normalize();
        seed.hitPlayers = null;
        this.events.push([seed.index, at]);
        return true;
    }

    update(seconds) {
        const now = Math.max(0, Number(seconds) || 0);
        dandelionWindAt(now, this._wind);
        for (const seed of this.seeds) {
            if (seed.releasedAt === null) continue;
            const age = Math.max(0, now - seed.releasedAt);
            if (age >= FLIGHT_SECONDS) {
                seed.node.visible = false;
                continue;
            }
            seed.node.visible = true;
            const travel = seed.speed * age;
            this._target.copy(seed.root)
                .addScaledVector(seed.launch, travel * 0.72)
                .addScaledVector(seed.releaseWind, travel * 0.13)
                .addScaledVector(this._wind, travel * 0.36);
            this._target.y += seed.speed * (0.14 * age + 0.16 * Math.sin(age * 1.3 + seed.index));
            seed.node.parent.worldToLocal(this._target);
            seed.node.position.copy(this._target);
            this._tumble.setFromAxisAngle(TUMBLE_AXIS, age * (0.32 + (seed.index % 7) * 0.06));
            seed.node.quaternion.copy(seed.restQuaternion).multiply(this._tumble);
            seed.node.updateWorldMatrix(true, false);
            seed.collisionCenter.set(0, seed.height, 0);
            seed.node.localToWorld(seed.collisionCenter);
        }
    }

    /** A released pappus gives each vehicle one soft, damage-free bump. */
    consumeCollision(position, playerRadius = 0, playerIndex = -1) {
        if (!position) return null;
        const entityKey = Number.isInteger(Number(playerIndex)) ? Number(playerIndex) : String(playerIndex);
        const safePlayerRadius = Math.max(0, Number(playerRadius) || 0);
        for (const seed of this.seeds) {
            if (seed.releasedAt === null || seed.node.visible === false) continue;
            if (seed.hitPlayers?.has(entityKey)) continue;
            const contactRadius = seed.radius + safePlayerRadius;
            if (seed.collisionCenter.distanceToSquared(position) > contactRadius * contactRadius) continue;

            if (!seed.hitPlayers) seed.hitPlayers = new Set();
            seed.hitPlayers.add(entityKey);
            const collision = this._collision;
            collision.seedIndex = seed.index;
            collision.normal.subVectors(position, seed.collisionCenter);
            if (collision.normal.lengthSq() <= 0.000001) collision.normal.copy(seed.launch);
            if (collision.normal.lengthSq() <= 0.000001) collision.normal.copy(UP);
            collision.normal.normalize();
            return collision;
        }
        return null;
    }

    reset() {
        for (const seed of this.seeds) {
            seed.releasedAt = null;
            seed.node.position.copy(seed.restPosition);
            seed.node.quaternion.copy(seed.restQuaternion);
            seed.node.visible = true;
            seed.collisionCenter.copy(seed.tip);
            seed.hitPlayers = null;
        }
        this.events.length = 0;
    }

    serialize() { return this.events.map(([index, at]) => [index, at]); }

    applyNetworkState(events) {
        if (!Array.isArray(events)) return;
        const diverged = this.events.length > events.length || this.events.some(
            ([index, at], i) => index !== Number(events[i]?.[0]) || at !== Number(events[i]?.[1]),
        );
        if (diverged) this.reset();
        for (let i = this.events.length; i < Math.min(events.length, this.seeds.length); i += 1) {
            this.releaseByName(
                this.seeds.find((seed) => seed.index === Number(events[i]?.[0]))?.node.name,
                events[i]?.[1],
            );
        }
    }
}
