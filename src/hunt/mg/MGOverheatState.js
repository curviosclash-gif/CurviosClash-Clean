import { clamp } from '../../utils/MathOps.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

function getMgConfig(configSource = null) {
    return resolveGameplayConfig(configSource).HUNT?.MG || {};
}

function clearObject(target) {
    for (const key of Object.keys(target || {})) {
        delete target[key];
    }
}

export class MGOverheatState {
    constructor(configSource = null) {
        this.configSource = configSource || null;
        this.overheatByPlayer = {};
        this.lockoutByPlayer = {};
        this.overheatSnapshot = {};
        this.overheatSnapshotVersion = 0;
        this.overheatSnapshotDirty = true;
        Object.defineProperty(this.overheatSnapshot, '__version', {
            enumerable: false,
            configurable: false,
            get: () => this.overheatSnapshotVersion,
        });
        Object.defineProperty(this.overheatSnapshot, '__dirty', {
            enumerable: false,
            configurable: false,
            get: () => this.overheatSnapshotDirty,
        });
    }

    reset() {
        clearObject(this.overheatByPlayer);
        clearObject(this.lockoutByPlayer);
        clearObject(this.overheatSnapshot);
        this.markOverheatSnapshotDirty();
    }

    resetPlayer(playerIndex) {
        const key = String(playerIndex);
        this.lockoutByPlayer[key] = 0;
        this.setOverheatValue(key, 0);
    }

    update(players, dt, mg = getMgConfig(this.configSource)) {
        const coolPerSecond = Math.max(0, Number(mg.COOLING_PER_SECOND || 22));
        for (const player of players || []) {
            const idx = player.index;
            const currentHeat = Math.max(0, Number(this.overheatByPlayer[idx] || 0));
            this.setOverheatValue(idx, clamp(currentHeat - coolPerSecond * dt, 0, 100));
            this.lockoutByPlayer[idx] = Math.max(0, Number(this.lockoutByPlayer[idx] || 0) - dt);
        }
    }

    getOverheatValue(playerIndex) {
        return Math.max(0, Number(this.overheatByPlayer[playerIndex] || 0));
    }

    increaseOverheat(playerIndex, mg = getMgConfig(this.configSource)) {
        const perShot = Math.max(0, Number(mg.OVERHEAT_PER_SHOT || 6.5));
        const threshold = Math.max(1, Number(mg.LOCKOUT_THRESHOLD || 100));
        const lockoutSeconds = Math.max(0.1, Number(mg.LOCKOUT_SECONDS || 1.2));
        const nextHeat = clamp(this.getOverheatValue(playerIndex) + perShot, 0, 100);
        this.setOverheatValue(playerIndex, nextHeat);
        if (nextHeat >= threshold) {
            this.lockoutByPlayer[playerIndex] = lockoutSeconds;
        }
    }

    setOverheatValue(playerIndex, nextValue) {
        const key = String(playerIndex);
        const normalized = clamp(Math.max(0, Number(nextValue || 0)), 0, 100);
        const hasCurrent = Object.prototype.hasOwnProperty.call(this.overheatByPlayer, key);
        const current = hasCurrent ? Math.max(0, Number(this.overheatByPlayer[key] || 0)) : 0;
        if (hasCurrent && current === normalized) {
            return current;
        }
        this.overheatByPlayer[key] = normalized;
        this.overheatSnapshot[key] = normalized;
        this.markOverheatSnapshotDirty();
        return normalized;
    }

    markOverheatSnapshotDirty() {
        this.overheatSnapshotVersion += 1;
        this.overheatSnapshotDirty = true;
    }

    markOverheatSnapshotClean() {
        this.overheatSnapshotDirty = false;
    }
}
