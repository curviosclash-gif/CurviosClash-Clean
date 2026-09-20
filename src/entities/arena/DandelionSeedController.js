import * as THREE from 'three';

const FLIGHT_SECONDS = 18;
const SHAFT_RADIUS_SCALE = 0.07;
// The generated bristles reach up to 0.69 local units from the pappus centre.
const PAPPUS_RADIUS_SCALE = 0.7;
const GRAVITY_RESPONSE_SECONDS = 2.5;
const GRAVITY_TERMINAL_SPEED_FACTOR = 0.25;
const MOVING_SHAFT_SWEEP_STEPS = 4;
const UP = new THREE.Vector3(0, 1, 0);
const TUMBLE_AXIS = new THREE.Vector3(1, 0.3, 0).normalize();

function dot(ax, ay, az, bx, by, bz) {
    return ax * bx + ay * by + az * bz;
}

function raySphereEntry(origin, direction, center, radius, maxDistance) {
    const ox = origin.x - center.x;
    const oy = origin.y - center.y;
    const oz = origin.z - center.z;
    const c = dot(ox, oy, oz, ox, oy, oz) - radius * radius;
    if (c <= 0) return 0;
    const b = dot(ox, oy, oz, direction.x, direction.y, direction.z);
    const discriminant = b * b - c;
    if (discriminant < 0) return Infinity;
    const entry = -b - Math.sqrt(discriminant);
    return entry >= 0 && entry < maxDistance ? entry : Infinity;
}

function pointSegmentDistanceSquared(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    const t = lengthSq > 0.000001
        ? Math.max(0, Math.min(1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz)
            / lengthSq))
        : 0;
    const offsetX = point.x - (start.x + dx * t);
    const offsetY = point.y - (start.y + dy * t);
    const offsetZ = point.z - (start.z + dz * t);
    return offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
}

/** Entry distance for a normalized ray against a capsule from start to end. */
function rayCapsuleEntry(origin, direction, start, end, radius, maxDistance) {
    if (pointSegmentDistanceSquared(origin, start, end) <= radius * radius) return 0;
    const bax = end.x - start.x;
    const bay = end.y - start.y;
    const baz = end.z - start.z;
    const oax = origin.x - start.x;
    const oay = origin.y - start.y;
    const oaz = origin.z - start.z;
    const baba = dot(bax, bay, baz, bax, bay, baz);
    if (baba <= 0.000001) {
        return raySphereEntry(origin, direction, start, radius, maxDistance);
    }

    const bard = dot(bax, bay, baz, direction.x, direction.y, direction.z);
    const baoa = dot(bax, bay, baz, oax, oay, oaz);
    const rdoa = dot(direction.x, direction.y, direction.z, oax, oay, oaz);
    const oaoa = dot(oax, oay, oaz, oax, oay, oaz);
    const a = baba - bard * bard;
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - radius * radius * baba;
    let entry = Infinity;
    if (Math.abs(a) > 0.000001) {
        const discriminant = b * b - a * c;
        if (discriminant >= 0) {
            const bodyEntry = (-b - Math.sqrt(discriminant)) / a;
            const axisPosition = baoa + bodyEntry * bard;
            if (bodyEntry >= 0 && bodyEntry < maxDistance
                && axisPosition > 0 && axisPosition < baba) {
                entry = bodyEntry;
            }
        }
    }
    return Math.min(
        entry,
        raySphereEntry(origin, direction, start, radius, maxDistance),
        raySphereEntry(origin, direction, end, radius, maxDistance),
    );
}

/** Closest points between two finite line segments, written into a reusable result. */
function closestSegmentPoints(a0, a1, b0, b1, result) {
    const ux = a1.x - a0.x;
    const uy = a1.y - a0.y;
    const uz = a1.z - a0.z;
    const vx = b1.x - b0.x;
    const vy = b1.y - b0.y;
    const vz = b1.z - b0.z;
    const wx = a0.x - b0.x;
    const wy = a0.y - b0.y;
    const wz = a0.z - b0.z;
    const a = dot(ux, uy, uz, ux, uy, uz);
    const b = dot(ux, uy, uz, vx, vy, vz);
    const c = dot(vx, vy, vz, vx, vy, vz);
    const d = dot(ux, uy, uz, wx, wy, wz);
    const e = dot(vx, vy, vz, wx, wy, wz);
    const denominator = a * c - b * b;
    let sNumerator = denominator;
    let sDenominator = denominator;
    let tNumerator = denominator;
    let tDenominator = denominator;

    if (denominator < 0.000001) {
        sNumerator = 0;
        sDenominator = 1;
        tNumerator = e;
        tDenominator = c;
    } else {
        sNumerator = b * e - c * d;
        tNumerator = a * e - b * d;
        if (sNumerator < 0) {
            sNumerator = 0;
            tNumerator = e;
            tDenominator = c;
        } else if (sNumerator > sDenominator) {
            sNumerator = sDenominator;
            tNumerator = e + b;
            tDenominator = c;
        }
    }

    if (tNumerator < 0) {
        tNumerator = 0;
        if (-d < 0) {
            sNumerator = 0;
        } else if (-d > a) {
            sNumerator = sDenominator;
        } else {
            sNumerator = -d;
            sDenominator = a;
        }
    } else if (tNumerator > tDenominator) {
        tNumerator = tDenominator;
        if ((-d + b) < 0) {
            sNumerator = 0;
        } else if ((-d + b) > a) {
            sNumerator = sDenominator;
        } else {
            sNumerator = -d + b;
            sDenominator = a;
        }
    }

    const s = Math.abs(sNumerator) < 0.000001 ? 0 : sNumerator / sDenominator;
    const t = Math.abs(tNumerator) < 0.000001 ? 0 : tNumerator / tDenominator;
    result.ax = a0.x + s * ux;
    result.ay = a0.y + s * uy;
    result.az = a0.z + s * uz;
    result.bx = b0.x + t * vx;
    result.by = b0.y + t * vy;
    result.bz = b0.z + t * vz;
    const dx = result.ax - result.bx;
    const dy = result.ay - result.by;
    const dz = result.az - result.bz;
    result.distanceSq = dx * dx + dy * dy + dz * dz;
    return result;
}

/** A slowly turning, deterministic wind shared by the host and every replica. */
export function dandelionWindAt(seconds, out = new THREE.Vector3()) {
    const time = Math.max(0, Number(seconds) || 0);
    const heading = time * 0.022 + 0.55 * Math.sin(time * 0.012)
        + 0.18 * Math.sin(time * 0.005 + 1.4);
    return out.set(Math.cos(heading), 0, Math.sin(heading));
}

/** Keeps the scalable GLB's seed meshes addressable without hundreds of physics colliders. */
export class DandelionSeedController {
    constructor(scene) {
        this.seeds = [];
        this.byName = new Map();
        this.events = [];
        this._wind = new THREE.Vector3();
        this._target = new THREE.Vector3();
        this._tumble = new THREE.Quaternion();
        this._shaftStart = new THREE.Vector3();
        this._shaftEnd = new THREE.Vector3();
        this._playerSweepStart = new THREE.Vector3();
        this._playerSweepEnd = new THREE.Vector3();
        this._closest = { distanceSq: Infinity, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 };
        this._candidateNormal = new THREE.Vector3();
        this._releasedCandidateNormal = new THREE.Vector3();
        this._attachedContactPlayers = new Set();
        this._attachedBounds = {
            minX: Infinity, minY: Infinity, minZ: Infinity,
            maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
        };
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
            const currentRoot = root.clone();
            const currentTip = tip.clone();
            const previousRoot = root.clone();
            const previousTip = tip.clone();
            const seed = {
                index, node, root, tip, normal, height,
                shaftRadius: size * SHAFT_RADIUS_SCALE,
                radius: size * PAPPUS_RADIUS_SCALE,
                collisionRadius: size * PAPPUS_RADIUS_SCALE,
                speed: size * 0.55,
                restPosition: node.position.clone(),
                restQuaternion: node.quaternion.clone(),
                releasedAt: null,
                launch: new THREE.Vector3(),
                releaseWind: new THREE.Vector3(),
                currentRoot,
                previousRoot,
                currentTip,
                previousTip,
                // Kept as aliases for callers and tests written against the original crown-only proxy.
                collisionCenter: currentTip,
                previousCollisionCenter: previousTip,
                hitPlayers: null,
            };
            this.seeds.push(seed);
            this.byName.set(node.name, seed);
            const bounds = this._attachedBounds;
            const crownRadius = seed.collisionRadius;
            bounds.minX = Math.min(bounds.minX, root.x - seed.shaftRadius, tip.x - crownRadius);
            bounds.minY = Math.min(bounds.minY, root.y - seed.shaftRadius, tip.y - crownRadius);
            bounds.minZ = Math.min(bounds.minZ, root.z - seed.shaftRadius, tip.z - crownRadius);
            bounds.maxX = Math.max(bounds.maxX, root.x + seed.shaftRadius, tip.x + crownRadius);
            bounds.maxY = Math.max(bounds.maxY, root.y + seed.shaftRadius, tip.y + crownRadius);
            bounds.maxZ = Math.max(bounds.maxZ, root.z + seed.shaftRadius, tip.z + crownRadius);
        });
        this.seeds.sort((a, b) => a.index - b.index);
        // Reused by the secret-room unlock and the HUD. Keeping one object avoids turning a
        // per-frame status query into 60 short-lived allocations per second.
        this._progress = {
            total: this.seeds.length,
            released: 0,
            remaining: this.seeds.length,
            allReleased: false,
            completedAtSeconds: 0,
        };
        this._latestReleaseSeconds = 0;
        this._collision = { seedIndex: 0, normal: new THREE.Vector3(), attached: false };
    }

    get count() { return this.seeds.length; }

    /** Match-wide release progress. The returned object is owned and reused by this controller. */
    getProgress() { return this._progress; }

    /** Nearest still-attached seed body, shaft, or pappus along a normalized shot ray. */
    raycast(origin, direction, maxDistance, padding = 0) {
        if (!origin || !direction || !(maxDistance > 0)) return null;
        let nearest = null;
        let distance = maxDistance;
        const safePadding = Math.max(0, Number(padding) || 0);
        for (const seed of this.seeds) {
            if (seed.releasedAt !== null) continue;
            const shaftEntry = rayCapsuleEntry(
                origin, direction, seed.root, seed.tip, seed.shaftRadius + safePadding, distance,
            );
            const crownEntry = raySphereEntry(
                origin, direction, seed.tip, seed.radius + safePadding, distance,
            );
            const entry = Math.min(shaftEntry, crownEntry);
            if (!(entry < distance)) continue;
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
        seed.previousRoot.copy(seed.currentRoot);
        seed.previousTip.copy(seed.currentTip);
        this.events.push([seed.index, at]);
        this._latestReleaseSeconds = Math.max(this._latestReleaseSeconds, at);
        const progress = this._progress;
        progress.released += 1;
        progress.remaining = Math.max(0, progress.total - progress.released);
        progress.allReleased = progress.total > 0 && progress.remaining === 0;
        progress.completedAtSeconds = progress.allReleased ? this._latestReleaseSeconds : 0;
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
            seed.previousRoot.copy(seed.currentRoot);
            seed.previousTip.copy(seed.currentTip);
            const travel = seed.speed * age;
            this._target.copy(seed.root)
                .addScaledVector(seed.launch, travel * 0.72)
                .addScaledVector(seed.releaseWind, travel * 0.13)
                .addScaledVector(this._wind, travel * 0.36);
            this._target.y += seed.speed * (0.14 * age + 0.16 * Math.sin(age * 1.3 + seed.index));
            // Linear drag limits the downward velocity: early motion accelerates under gravity,
            // while the pappus approaches a gentle terminal fall instead of free-falling.
            const gravityAge = age - GRAVITY_RESPONSE_SECONDS
                * (1 - Math.exp(-age / GRAVITY_RESPONSE_SECONDS));
            this._target.y -= seed.speed * GRAVITY_TERMINAL_SPEED_FACTOR * gravityAge;
            seed.node.parent.worldToLocal(this._target);
            seed.node.position.copy(this._target);
            this._tumble.setFromAxisAngle(TUMBLE_AXIS, age * (0.32 + (seed.index % 7) * 0.06));
            seed.node.quaternion.copy(seed.restQuaternion).multiply(this._tumble);
            seed.node.updateWorldMatrix(true, false);
            seed.currentRoot.set(0, 0, 0);
            seed.node.localToWorld(seed.currentRoot);
            seed.currentTip.set(0, seed.height, 0);
            seed.node.localToWorld(seed.currentTip);
        }
    }

    _mayTouchAttached(playerStart, position, radius) {
        const bounds = this._attachedBounds;
        if (!Number.isFinite(bounds.minX)) return false;
        return Math.max(playerStart.x, position.x) >= bounds.minX - radius
            && Math.min(playerStart.x, position.x) <= bounds.maxX + radius
            && Math.max(playerStart.y, position.y) >= bounds.minY - radius
            && Math.min(playerStart.y, position.y) <= bounds.maxY + radius
            && Math.max(playerStart.z, position.z) >= bounds.minZ - radius
            && Math.min(playerStart.z, position.z) <= bounds.maxZ + radius;
    }

    _setContactNormalFromClosest(seed) {
        const closest = this._closest;
        this._candidateNormal.set(
            closest.ax - closest.bx,
            closest.ay - closest.by,
            closest.az - closest.bz,
        );
        if (this._candidateNormal.lengthSq() <= 0.000001) this._candidateNormal.copy(seed.launch);
        if (this._candidateNormal.lengthSq() <= 0.000001) this._candidateNormal.copy(seed.normal);
        if (this._candidateNormal.lengthSq() <= 0.000001) this._candidateNormal.copy(UP);
        this._candidateNormal.normalize();
    }

    _intersectsCrown(seed, playerStart, position, playerRadius) {
        const startX = playerStart.x - seed.previousTip.x;
        const startY = playerStart.y - seed.previousTip.y;
        const startZ = playerStart.z - seed.previousTip.z;
        const deltaX = (position.x - playerStart.x) - (seed.currentTip.x - seed.previousTip.x);
        const deltaY = (position.y - playerStart.y) - (seed.currentTip.y - seed.previousTip.y);
        const deltaZ = (position.z - playerStart.z) - (seed.currentTip.z - seed.previousTip.z);
        const travelSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
        const closestTime = travelSquared > 0.000001
            ? Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY + startZ * deltaZ) / travelSquared))
            : 0;
        const closestX = startX + deltaX * closestTime;
        const closestY = startY + deltaY * closestTime;
        const closestZ = startZ + deltaZ * closestTime;
        const contactRadius = seed.collisionRadius + playerRadius;
        if (closestX * closestX + closestY * closestY + closestZ * closestZ
            > contactRadius * contactRadius) return false;
        this._candidateNormal.set(closestX, closestY, closestZ);
        if (this._candidateNormal.lengthSq() <= 0.000001) this._candidateNormal.copy(seed.launch);
        if (this._candidateNormal.lengthSq() <= 0.000001) this._candidateNormal.copy(seed.normal);
        if (this._candidateNormal.lengthSq() <= 0.000001) this._candidateNormal.copy(UP);
        this._candidateNormal.normalize();
        return true;
    }

    _intersectsShaft(seed, playerStart, position, playerRadius) {
        const contactRadius = seed.shaftRadius + playerRadius;
        if (seed.releasedAt === null) {
            closestSegmentPoints(playerStart, position, seed.root, seed.tip, this._closest);
            if (this._closest.distanceSq > contactRadius * contactRadius) return false;
            this._setContactNormalFromClosest(seed);
            return true;
        }

        const rootTravel = seed.previousRoot.distanceTo(seed.currentRoot);
        const tipTravel = seed.previousTip.distanceTo(seed.currentTip);
        const movementAllowance = Math.max(rootTravel, tipTravel) / (MOVING_SHAFT_SWEEP_STEPS * 2);
        const expandedRadius = contactRadius + movementAllowance;
        for (let step = 0; step < MOVING_SHAFT_SWEEP_STEPS; step += 1) {
            const t0 = step / MOVING_SHAFT_SWEEP_STEPS;
            const t1 = (step + 1) / MOVING_SHAFT_SWEEP_STEPS;
            const mid = (t0 + t1) * 0.5;
            this._playerSweepStart.lerpVectors(playerStart, position, t0);
            this._playerSweepEnd.lerpVectors(playerStart, position, t1);
            this._shaftStart.lerpVectors(seed.previousRoot, seed.currentRoot, mid);
            this._shaftEnd.lerpVectors(seed.previousTip, seed.currentTip, mid);
            closestSegmentPoints(
                this._playerSweepStart, this._playerSweepEnd,
                this._shaftStart, this._shaftEnd,
                this._closest,
            );
            if (this._closest.distanceSq > expandedRadius * expandedRadius) continue;
            this._setContactNormalFromClosest(seed);
            return true;
        }
        return false;
    }

    /** Every attached or airborne seed gives a vehicle a soft, low-damage deflection. */
    consumeCollision(position, playerRadius = 0, playerIndex = -1, previousPosition = null) {
        if (!position) return null;
        const entityKey = Number.isInteger(Number(playerIndex)) ? Number(playerIndex) : String(playerIndex);
        const safePlayerRadius = Math.max(0, Number(playerRadius) || 0);
        const playerStart = previousPosition || position;
        const mayTouchAttached = this._mayTouchAttached(playerStart, position, safePlayerRadius);
        const wasTouchingAttached = this._attachedContactPlayers.has(entityKey);
        let touchingAttached = false;
        let attachedSeed = null;
        let releasedSeed = null;
        const attachedNormal = this._collision.normal;
        const releasedNormal = this._releasedCandidateNormal;

        for (const seed of this.seeds) {
            if (seed.node.visible === false) continue;
            const attached = seed.releasedAt === null;
            if (attached && !mayTouchAttached) continue;
            if (!attached && seed.hitPlayers?.has(entityKey)) continue;
            const intersects = this._intersectsCrown(seed, playerStart, position, safePlayerRadius)
                || this._intersectsShaft(seed, playerStart, position, safePlayerRadius);
            if (!intersects) continue;
            if (attached) {
                touchingAttached = true;
                if (!attachedSeed) {
                    attachedSeed = seed;
                    attachedNormal.copy(this._candidateNormal);
                }
                continue;
            }
            if (!releasedSeed) {
                releasedSeed = seed;
                releasedNormal.copy(this._candidateNormal);
            }
        }

        if (touchingAttached) this._attachedContactPlayers.add(entityKey);
        else this._attachedContactPlayers.delete(entityKey);

        const seed = releasedSeed || (!wasTouchingAttached ? attachedSeed : null);
        if (!seed) return null;
        if (releasedSeed) {
            if (!seed.hitPlayers) seed.hitPlayers = new Set();
            seed.hitPlayers.add(entityKey);
        }
        const collision = this._collision;
        collision.seedIndex = seed.index;
        collision.attached = seed.releasedAt === null;
        if (releasedSeed) collision.normal.copy(releasedNormal);
        return collision;
    }

    reset() {
        for (const seed of this.seeds) {
            seed.releasedAt = null;
            seed.node.position.copy(seed.restPosition);
            seed.node.quaternion.copy(seed.restQuaternion);
            seed.node.visible = true;
            seed.currentRoot.copy(seed.root);
            seed.previousRoot.copy(seed.root);
            seed.currentTip.copy(seed.tip);
            seed.previousTip.copy(seed.tip);
            seed.hitPlayers = null;
        }
        this._attachedContactPlayers.clear();
        this.events.length = 0;
        this._latestReleaseSeconds = 0;
        this._progress.released = 0;
        this._progress.remaining = this._progress.total;
        this._progress.allReleased = false;
        this._progress.completedAtSeconds = 0;
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
