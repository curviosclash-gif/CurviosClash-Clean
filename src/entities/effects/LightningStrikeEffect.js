import * as THREE from 'three';

/**
 * The picture of the lightning item (E24, E32). During the warning short bolts flicker in the sky
 * all over the map, so nobody knows for sure whether they are meant; the strike is one bright bolt
 * from the top of the arena down to every target. A fixed pool of line meshes is built once and
 * reused - nothing is allocated per frame.
 *
 * The flicker uses its own small generator seeded from the strike id instead of the round's seeded
 * generator: a draw there would shift every later gameplay draw and make host and replay disagree.
 */

const WARNING_BOLTS = 6;
const STRIKE_BOLTS = 8;
const POINTS_PER_BOLT = 9;
const FLICKER_SECONDS = 0.12;
const STRIKE_SECONDS = 0.3;
const WARNING_COLOR = 0x9cc8ff;
const STRIKE_COLOR = 0xeaf4ff;

function createBolt(material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINTS_PER_BOLT * 3), 3));
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.visible = false;
    return line;
}

export class LightningStrikeEffect {
    constructor(renderer) {
        this.renderer = renderer || null;
        this._warningMaterial = new THREE.LineBasicMaterial({ color: WARNING_COLOR, transparent: true, opacity: 0.75 });
        this._strikeMaterial = new THREE.LineBasicMaterial({ color: STRIKE_COLOR });
        this._warningBolts = Array.from({ length: WARNING_BOLTS }, () => createBolt(this._warningMaterial));
        this._strikeBolts = Array.from({ length: STRIKE_BOLTS }, () => createBolt(this._strikeMaterial));
        this._flickerRemaining = 0;
        this._strikeRemaining = 0;
        this._seed = 1;
        for (const bolt of [...this._warningBolts, ...this._strikeBolts]) this.renderer?.addToScene?.(bolt);
    }

    _random() {
        // Park-Miller: small, deterministic and independent of the gameplay generator.
        this._seed = (this._seed * 48271) % 2147483647;
        return this._seed / 2147483647;
    }

    _shapeBolt(bolt, fromX, fromY, fromZ, toX, toY, toZ, jitter) {
        const positions = bolt.geometry.attributes.position;
        for (let i = 0; i < POINTS_PER_BOLT; i += 1) {
            const t = i / (POINTS_PER_BOLT - 1);
            const wobble = i === 0 || i === POINTS_PER_BOLT - 1 ? 0 : jitter;
            positions.setXYZ(
                i,
                fromX + (toX - fromX) * t + (this._random() - 0.5) * wobble,
                fromY + (toY - fromY) * t,
                fromZ + (toZ - fromZ) * t + (this._random() - 0.5) * wobble,
            );
        }
        positions.needsUpdate = true;
        bolt.visible = true;
    }

    /**
     * One frame. `warning` is the state from LightningStrikeSystem.getWarningState() or null;
     * `bounds` the arena bounds the warning bolts are spread over.
     */
    update(dt, warning, bounds, strikeId = 1) {
        const safeDt = Math.max(0, Number(dt) || 0);
        this._strikeRemaining = Math.max(0, this._strikeRemaining - safeDt);
        if (this._strikeRemaining <= 0) for (const bolt of this._strikeBolts) bolt.visible = false;

        if (!warning || !bounds) {
            for (const bolt of this._warningBolts) bolt.visible = false;
            return;
        }
        this._flickerRemaining -= safeDt;
        if (this._flickerRemaining > 0) return;
        this._flickerRemaining = FLICKER_SECONDS;
        if (this._seed === 1) this._seed = (Math.abs(Math.trunc(strikeId)) % 2147483646) + 2;
        const top = bounds.maxY;
        const height = Math.max(4, (bounds.maxY - bounds.minY) * 0.25);
        for (const bolt of this._warningBolts) {
            if (this._random() < 0.35) {
                bolt.visible = false;
                continue;
            }
            const x = bounds.minX + (bounds.maxX - bounds.minX) * this._random();
            const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * this._random();
            this._shapeBolt(bolt, x, top, z, x, top - height, z, height * 0.25);
        }
    }

    /** The strike: one bolt from the top of the arena to each target position. */
    strike(targetPositions, bounds) {
        const top = Number.isFinite(bounds?.maxY) ? bounds.maxY : 200;
        let used = 0;
        for (const position of targetPositions || []) {
            if (!position || used >= this._strikeBolts.length) continue;
            const bolt = this._strikeBolts[used++];
            this._shapeBolt(bolt, position.x, top, position.z, position.x, position.y, position.z, Math.max(2, (top - position.y) * 0.06));
        }
        for (let i = used; i < this._strikeBolts.length; i += 1) this._strikeBolts[i].visible = false;
        this._strikeRemaining = STRIKE_SECONDS;
        this._seed = 1;
    }

    dispose() {
        for (const bolt of [...this._warningBolts, ...this._strikeBolts]) {
            this.renderer?.removeFromScene?.(bolt);
            bolt.geometry.dispose();
        }
        this._warningMaterial.dispose();
        this._strikeMaterial.dispose();
    }
}
