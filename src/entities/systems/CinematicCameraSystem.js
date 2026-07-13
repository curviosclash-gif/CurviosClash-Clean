import * as THREE from 'three';

const DIRECTION_MIN_LENGTH_SQ = 1e-6;
const SIDE_MIN_LENGTH_SQ = 1e-6;
const BLEND_EPSILON = 0.0001;
const SWAY_PLAYER_PHASE_OFFSET = 0.7;
const MAX_PLAYER_INDEX = 7;
const DEFAULT_REFERENCE_SPEED = 18;

export class CinematicCameraSystem {
    constructor({
        enabled = true,
        enterSpeed = 5.5,
        exitSpeed = 8.0,
        boostOffset = 0.85,
        baseLookAhead = 1.6,
        swayFrequency = 0.8,
        swayAmount = 0.5,
        liftAmount = 0.35,
        referenceSpeed = DEFAULT_REFERENCE_SPEED,
    } = {}) {
        this.enabled = enabled !== false;
        this.enterSpeed = Math.max(0.001, Number(enterSpeed) || 5.5);
        this.exitSpeed = Math.max(0.001, Number(exitSpeed) || 8.0);
        this.boostOffset = Math.max(0, Number.isFinite(Number(boostOffset)) ? Number(boostOffset) : 0.85);
        this.baseLookAhead = Math.max(0, Number.isFinite(Number(baseLookAhead)) ? Number(baseLookAhead) : 1.6);
        this.swayFrequency = Math.max(0, Number(swayFrequency) || 0.8);
        this.swayAmount = Number.isFinite(Number(swayAmount)) ? Number(swayAmount) : 0.5;
        this.liftAmount = Number.isFinite(Number(liftAmount)) ? Number(liftAmount) : 0.35;
        this.referenceSpeed = Math.max(0.001, Number(referenceSpeed) || DEFAULT_REFERENCE_SPEED);

        this._blendByPlayer = [];
        this._timeByPlayer = [];

        this._tmpDir = new THREE.Vector3();
        this._tmpSide = new THREE.Vector3();
        this._up = new THREE.Vector3(0, 1, 0);
    }

    isEnabled() {
        return this.enabled;
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
    }

    getPlayerBlend(playerIndex) {
        return this._blendByPlayer[playerIndex] || 0;
    }

    apply({
        playerIndex,
        mode,
        target,
        playerDirection,
        playerPosition,
        dt,
        boostBlend = null,
        speed = null,
        isBoosting = false,
    }) {
        if (!target || !playerDirection || !playerPosition) return;
        if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex > MAX_PLAYER_INDEX) return;

        const cinematicPreferred = this.enabled && mode === 'THIRD_PERSON';
        const targetBlend = cinematicPreferred ? 1 : 0;
        const previousBlend = this._blendByPlayer[playerIndex] || 0;
        const blendSpeed = targetBlend > previousBlend ? this.enterSpeed : this.exitSpeed;
        const alpha = 1 - Math.exp(-blendSpeed * Math.max(0, Number(dt) || 0));
        const blend = THREE.MathUtils.clamp(THREE.MathUtils.lerp(previousBlend, targetBlend, alpha), 0, 1);
        this._blendByPlayer[playerIndex] = blend;

        if (mode !== 'THIRD_PERSON') {
            return;
        }

        if (blend <= BLEND_EPSILON) {
            return;
        }

        const elapsed = (this._timeByPlayer[playerIndex] || 0) + Math.max(0, Number(dt) || 0);
        this._timeByPlayer[playerIndex] = elapsed;

        this._tmpDir.copy(playerDirection);
        if (this._tmpDir.lengthSq() <= DIRECTION_MIN_LENGTH_SQ) {
            this._tmpDir.set(0, 0, -1);
        } else {
            this._tmpDir.normalize();
        }

        this._tmpSide.crossVectors(this._up, this._tmpDir);
        if (this._tmpSide.lengthSq() <= SIDE_MIN_LENGTH_SQ) {
            this._tmpSide.set(1, 0, 0);
        } else {
            this._tmpSide.normalize();
        }

        const fallbackBoostBlend = isBoosting ? 1 : 0;
        const resolvedBoostBlend = THREE.MathUtils.clamp(
            Number.isFinite(Number(boostBlend)) ? Number(boostBlend) : fallbackBoostBlend,
            0,
            1
        );
        const speedValue = Number(speed);
        const speedScale = Number.isFinite(speedValue)
            ? THREE.MathUtils.clamp(speedValue / this.referenceSpeed, 0.1, 1.0)
            : 1;
        const swayBoostDamping = 1 - (resolvedBoostBlend * 0.6);
        const sway = Math.sin((elapsed * this.swayFrequency) + playerIndex * SWAY_PLAYER_PHASE_OFFSET)
            * this.swayAmount
            * speedScale
            * swayBoostDamping
            * blend;
        const lift = this.liftAmount * blend;
        const lookAhead = (this.baseLookAhead + this.boostOffset * resolvedBoostBlend) * blend;

        target.position.addScaledVector(this._tmpSide, sway);
        target.position.y += lift;
        target.lookAt.copy(playerPosition).addScaledVector(this._tmpDir, lookAhead);
    }

    reset() {
        this._blendByPlayer.length = 0;
        this._timeByPlayer.length = 0;
    }
}
