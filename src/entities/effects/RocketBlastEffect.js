import * as THREE from 'three';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';
import { resolveBlastShake } from './BlastCameraShake.js';

const MAX_ROCKET_BLASTS = 32;
const DUMMY = new THREE.Object3D();

// How long a blast lights the world. After this its core is glowing debris rather
// than a flash, and lighting the arena from it would read as a lamp, not a bang.
const LIGHT_FLASH_SECONDS = 0.15;
// Lights fall off with the square of the distance, so intensity has to grow the
// same way for a bigger blast to read as brighter instead of merely wider.
const LIGHT_CANDELA_SCALE = 2;
// Range cap as a multiple of the blast radius. Without it a single explosion
// would tint the whole arena and pay for every fragment in it.
const LIGHT_RANGE_FACTOR = 3.5;

// The core-and-shockwave pass is not rocket-specific - it is the only effect in the
// game that reads as a detonation rather than as flying debris, so every blast-scale
// event picks its size here instead of growing its own effect.
const BLAST_PROFILES = Object.freeze({
    ROCKET_WEAK: Object.freeze({ radius: 2.6, lifetime: 0.48 }),
    ROCKET_MEDIUM: Object.freeze({ radius: 3.1, lifetime: 0.56 }),
    ROCKET_HEAVY: Object.freeze({ radius: 3.8, lifetime: 0.64 }),
    ROCKET_MEGA: Object.freeze({ radius: 4.8, lifetime: 0.72 }),
    // A wrecked vehicle detonates wider and slower than the rocket that killed it,
    // so a rocket kill reads as impact first and wreck second rather than as one
    // doubled sphere.
    DEATH: Object.freeze({ radius: 5.2, lifetime: 0.8 }),
    REACTOR_BREACH: Object.freeze({ radius: 18, lifetime: 0.65, mode: 1 }),
    REACTOR_PRESSURE: Object.freeze({ radius: 150, lifetime: 1.1, mode: 2 }),
    // Knocking an item loose is a pickup-scale event, not a kill.
    ITEM_BURST: Object.freeze({ radius: 1.6, lifetime: 0.34 }),
});

export class RocketBlastEffect {
    constructor(renderer, { modernGraphics = true } = {}) {
        this.renderer = renderer;
        this.count = 0;
        this.positions = new Float32Array(MAX_ROCKET_BLASTS * 3);
        this.lifetimes = new Float32Array(MAX_ROCKET_BLASTS);
        this.maxLifetimes = new Float32Array(MAX_ROCKET_BLASTS);
        this.radii = new Float32Array(MAX_ROCKET_BLASTS);
        this.modes = new Uint8Array(MAX_ROCKET_BLASTS); // 0: ordinary, 1: flash, 2: pressure only
        this.colors = new Float32Array(MAX_ROCKET_BLASTS * 3);
        this._tmpColor = new THREE.Color();
        this._coreTint = new THREE.Color(0xffffcc);

        this.coreMesh = this._createMesh(
            new THREE.IcosahedronGeometry(1, 2),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: modernGraphics ? 0.82 : 0.72,
                blending: modernGraphics ? THREE.AdditiveBlending : THREE.NormalBlending,
                depthWrite: false,
                toneMapped: false,
            })
        );
        this.waveMesh = this._createMesh(
            new THREE.IcosahedronGeometry(1, 1),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: modernGraphics ? 0.34 : 0.28,
                blending: modernGraphics ? THREE.AdditiveBlending : THREE.NormalBlending,
                depthWrite: false,
                toneMapped: false,
                wireframe: true,
            })
        );

        // One light for the whole game, created once and left in the scene for good.
        // Adding or removing a light at runtime makes three.js recompile every
        // shader that can see it, which would stutter at exactly the moment things
        // are exploding - so it is driven to zero intensity instead of detached.
        // The classic style skips it altogether: a light that is never used still
        // costs a shader variant and per-fragment work, so not creating it is the
        // only saving that is actually real.
        this.light = null;
        if (modernGraphics) {
            this.light = new THREE.PointLight(0xffffff, 0, 0);
            this.renderer?.addToScene?.(this.light);
        }
    }

    _createMesh(geometry, material) {
        const mesh = new THREE.InstancedMesh(geometry, material, MAX_ROCKET_BLASTS);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        // Culling would use the bounding sphere cached while this mesh was still empty,
        // which hides the core and the shockwave for good. Blasts are short and rare,
        // so drawing them unconditionally is cheaper than keeping a hull up to date.
        mesh.frustumCulled = false;
        this.renderer?.addToScene?.(mesh);
        return mesh;
    }

    // `radiusScale` widens a profile without inventing a new one: a death caused by
    // a mega rocket is the same kind of event as a death against a wall, just
    // bigger. The lifetime deliberately stays at the profile value so a larger
    // blast hits harder rather than hanging around longer.
    spawn(position, blastType, color, radiusScale = 1) {
        if (!position || !this.coreMesh || !this.waveMesh) return;

        const profile = BLAST_PROFILES[blastType] || BLAST_PROFILES.ROCKET_MEDIUM;
        const scale = Number.isFinite(Number(radiusScale)) && Number(radiusScale) > 0 ? Number(radiusScale) : 1;
        const radius = profile.radius * scale;
        const lifetime = profile.lifetime;

        let index = this.count;
        if (this.count < MAX_ROCKET_BLASTS) {
            this.count++;
        } else {
            index = 0;
            for (let i = 1; i < this.count; i++) {
                if (this.lifetimes[i] < this.lifetimes[index]) index = i;
            }
        }
        const index3 = index * 3;
        this.positions[index3] = position.x;
        this.positions[index3 + 1] = position.y;
        this.positions[index3 + 2] = position.z;
        this.lifetimes[index] = lifetime;
        this.maxLifetimes[index] = lifetime;
        this.radii[index] = radius;
        this.modes[index] = profile.mode || 0;

        this._tmpColor.setHex(color);
        this.colors[index3] = this._tmpColor.r;
        this.colors[index3 + 1] = this._tmpColor.g;
        this.colors[index3 + 2] = this._tmpColor.b;
        this.waveMesh.setColorAt(index, this._tmpColor);
        this._tmpColor.lerp(this._coreTint, 0.72);
        this.coreMesh.setColorAt(index, this._tmpColor);

        if (!this.modes[index]) this._shakeNearbyCameras(position, radius);
        this._writeMatrices(index, 0);
        this.coreMesh.count = this.count;
        this.waveMesh.count = this.count;
        this.coreMesh.instanceMatrix.needsUpdate = true;
        this.waveMesh.instanceMatrix.needsUpdate = true;
        if (this.coreMesh.instanceColor) this.coreMesh.instanceColor.needsUpdate = true;
        if (this.waveMesh.instanceColor) this.waveMesh.instanceColor.needsUpdate = true;
    }

    // Every local view gets its own distance check. That is what makes split-screen
    // correct - two players sitting apart must not share one shake - and it also
    // keeps bots out for free: a bot has no camera, so it can never be shaken.
    _shakeNearbyCameras(position, radius) {
        const renderer = this.renderer;
        const cameras = renderer?.cameras;
        if (!Array.isArray(cameras) || typeof renderer.triggerCameraShake !== 'function') return;
        // Reduced motion keeps the picture still, but the blast is still reported
        // so the player's controller can rumble.
        const reduceMotion = renderer.getCameraPerspectiveSettings?.()?.reduceMotion === true;

        for (let i = 0; i < cameras.length; i += 1) {
            const view = cameras[i]?.position;
            if (!view) continue;
            const dx = view.x - position.x;
            const dy = view.y - position.y;
            const dz = view.z - position.z;
            const { intensity, duration } = resolveBlastShake(Math.sqrt(dx * dx + dy * dy + dz * dz), radius);
            if (intensity <= 0) continue;
            if (reduceMotion) renderer.reportImpact?.(i, intensity, duration);
            else renderer.triggerCameraShake(i, intensity, duration);
        }
    }

    _writeMatrices(index, progress) {
        const index3 = index * 3;
        const radius = this.radii[index];
        const easedProgress = 1 - ((1 - progress) ** 3);
        const corePulse = Math.sin(Math.PI * progress);
        const coreScale = radius * (0.12 + corePulse * 0.88) * (1 - progress * 0.35);
        const waveScale = radius * (0.2 + easedProgress * 1.35);

        DUMMY.position.set(this.positions[index3], this.positions[index3 + 1], this.positions[index3 + 2]);
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.scale.setScalar(this.modes[index] === 2 ? 0 : coreScale);
        DUMMY.updateMatrix();
        this.coreMesh.setMatrixAt(index, DUMMY.matrix);

        DUMMY.scale.setScalar(this.modes[index] === 1 ? 0 : waveScale);
        DUMMY.updateMatrix();
        this.waveMesh.setMatrixAt(index, DUMMY.matrix);
    }

    update(dt) {
        if (!this.coreMesh || !this.waveMesh) return;
        let aliveCount = 0;
        let dirtyColor = false;
        for (let i = 0; i < this.count; i++) {
            const remaining = this.lifetimes[i] - dt;
            if (remaining <= 0) continue;

            if (i !== aliveCount) {
                this._compact(i, aliveCount, remaining);
                dirtyColor = true;
            } else {
                this.lifetimes[aliveCount] = remaining;
            }

            const progress = 1 - (this.lifetimes[aliveCount] / this.maxLifetimes[aliveCount]);
            this._writeMatrices(aliveCount, progress);
            aliveCount++;
        }

        this.count = aliveCount;
        this.coreMesh.count = aliveCount;
        this.waveMesh.count = aliveCount;
        this.coreMesh.instanceMatrix.needsUpdate = true;
        this.waveMesh.instanceMatrix.needsUpdate = true;
        if (dirtyColor) {
            if (this.coreMesh.instanceColor) this.coreMesh.instanceColor.needsUpdate = true;
            if (this.waveMesh.instanceColor) this.waveMesh.instanceColor.needsUpdate = true;
        }
        this._updateBlastLight();
    }

    // The brightest blast owns the light. Which one that is changes as blasts age,
    // so it is resolved every frame instead of latched on spawn: a big explosion
    // going off beside a fading one takes the light over immediately, and the
    // light returns to zero on its own once every flash has burned out.
    _updateBlastLight() {
        const light = this.light;
        if (!light) return;

        let bestScore = 0;
        let bestIndex = -1;
        for (let i = 0; i < this.count; i += 1) {
            const age = this.maxLifetimes[i] - this.lifetimes[i];
            if (age >= LIGHT_FLASH_SECONDS || this.modes[i] === 2) continue;
            const score = this.radii[i] * (1 - (age / LIGHT_FLASH_SECONDS));
            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        if (bestIndex < 0) {
            light.intensity = 0;
            return;
        }

        const index3 = bestIndex * 3;
        const radius = this.radii[bestIndex];
        light.position.set(this.positions[index3], this.positions[index3 + 1], this.positions[index3 + 2]);
        this._tmpColor.setRGB(this.colors[index3], this.colors[index3 + 1], this.colors[index3 + 2]);
        light.color.copy(this._tmpColor.lerp(this._coreTint, 0.72));
        light.intensity = bestScore * radius * LIGHT_CANDELA_SCALE;
        light.distance = radius * LIGHT_RANGE_FACTOR;
    }

    _compact(source, target, remaining) {
        const source3 = source * 3;
        const target3 = target * 3;
        this.positions[target3] = this.positions[source3];
        this.positions[target3 + 1] = this.positions[source3 + 1];
        this.positions[target3 + 2] = this.positions[source3 + 2];
        this.lifetimes[target] = remaining;
        this.maxLifetimes[target] = this.maxLifetimes[source];
        this.radii[target] = this.radii[source];
        this.modes[target] = this.modes[source];
        this.colors[target3] = this.colors[source3];
        this.colors[target3 + 1] = this.colors[source3 + 1];
        this.colors[target3 + 2] = this.colors[source3 + 2];

        this._tmpColor.setRGB(this.colors[target3], this.colors[target3 + 1], this.colors[target3 + 2]);
        this.waveMesh.setColorAt(target, this._tmpColor);
        this._tmpColor.lerp(this._coreTint, 0.72);
        this.coreMesh.setColorAt(target, this._tmpColor);
    }

    clear() {
        this.count = 0;
        if (this.coreMesh) this.coreMesh.count = 0;
        if (this.waveMesh) this.waveMesh.count = 0;
        // Darkened rather than detached, so a round change cannot leave the arena
        // lit by an explosion that no longer exists.
        if (this.light) this.light.intensity = 0;
    }

    dispose() {
        this.clear();
        if (this.coreMesh) {
            this.renderer?.removeFromScene?.(this.coreMesh);
            disposeObject3DResources(this.coreMesh);
            this.coreMesh = null;
        }
        if (this.waveMesh) {
            this.renderer?.removeFromScene?.(this.waveMesh);
            disposeObject3DResources(this.waveMesh);
            this.waveMesh = null;
        }
        if (this.light) {
            this.renderer?.removeFromScene?.(this.light);
            this.light.dispose?.();
            this.light = null;
        }
        this.renderer = null;
    }
}
