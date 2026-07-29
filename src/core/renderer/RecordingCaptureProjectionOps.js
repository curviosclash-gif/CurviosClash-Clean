// @ts-nocheck

export function toPositiveEven(value, fallback) {
    const numeric = Number(value);
    const safe = Number.isFinite(numeric) && numeric >= 2 ? Math.floor(numeric) : fallback;
    return Math.max(2, safe - (safe % 2));
}

export function toRatio(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function applyProjectionVector3(
    target,
    source,
    fallbackX = 0,
    fallbackY = 0,
    fallbackZ = 0
) {
    if (!target) return null;
    const x = Number(source?.x);
    const y = Number(source?.y);
    const z = Number(source?.z);
    target.set(
        Number.isFinite(x) ? x : fallbackX,
        Number.isFinite(y) ? y : fallbackY,
        Number.isFinite(z) ? z : fallbackZ
    );
    return target;
}

export function applyProjectionQuaternion(target, source) {
    if (!target) return null;
    const x = Number(source?.x);
    const y = Number(source?.y);
    const z = Number(source?.z);
    const w = Number(source?.w);
    target.set(
        Number.isFinite(x) ? x : 0,
        Number.isFinite(y) ? y : 0,
        Number.isFinite(z) ? z : 0,
        Number.isFinite(w) ? w : 1
    );
    return target;
}

export function createCanvasClone(sourceCanvas, width, height) {
    let canvasClone = null;
    if (sourceCanvas && typeof sourceCanvas.cloneNode === 'function') {
        canvasClone = sourceCanvas.cloneNode(false);
    } else if (typeof OffscreenCanvas === 'function') {
        canvasClone = new OffscreenCanvas(Math.max(2, Math.floor(width)), Math.max(2, Math.floor(height)));
    }
    if (!canvasClone) return null;
    canvasClone.width = Math.max(2, Math.floor(width));
    canvasClone.height = Math.max(2, Math.floor(height));
    return canvasClone;
}

export class CinematicCaptureSubjectSelector {
    constructor() {
        this.reset();
    }

    reset() {
        this.elapsed = 0;
        this.activity = [];
        this.previousHp = [];
        this.previousScore = [];
        this.previousBoost = [];
    }

    select(players, aliveCount, renderDelta) {
        const dt = Math.max(0, Number(renderDelta) || 0);
        this.elapsed += dt;
        let active = null;
        let strongestActivity = 0;
        for (let index = 0; index < players.length; index++) {
            const candidate = players[index];
            if (!candidate || (aliveCount > 0 && candidate.alive === false)) continue;
            const playerIndex = Math.max(0, Number(candidate.playerIndex) || 0);
            const hp = Math.max(0, Number(candidate.hp) || 0);
            const score = Math.max(0, Number(candidate.score) || 0);
            const boosting = candidate.isBoosting === true;
            let activity = Math.max(0, (Number(this.activity[playerIndex]) || 0) - dt);
            if (Number.isFinite(this.previousHp[playerIndex]) && hp < this.previousHp[playerIndex]) {
                activity = Math.max(activity, 3.2);
            }
            if (
                Number.isFinite(this.previousScore[playerIndex])
                && score > this.previousScore[playerIndex]
            ) {
                activity = Math.max(activity, 4);
            }
            if (boosting && this.previousBoost[playerIndex] === false) {
                activity = Math.max(activity, 1.8);
            }
            this.previousHp[playerIndex] = hp;
            this.previousScore[playerIndex] = score;
            this.previousBoost[playerIndex] = boosting;
            this.activity[playerIndex] = activity;
            if (activity > strongestActivity) {
                strongestActivity = activity;
                active = candidate;
            }
        }
        if (active) return active;

        const subjectCount = aliveCount > 0 ? aliveCount : players.length;
        const subjectIndex = subjectCount > 0
            ? Math.floor(this.elapsed / 6) % subjectCount
            : 0;
        let cursor = 0;
        for (let index = 0; index < players.length; index++) {
            const candidate = players[index];
            if (aliveCount > 0 && candidate?.alive === false) continue;
            if (cursor === subjectIndex) return candidate || null;
            cursor++;
        }
        return players[0] || null;
    }

    findNearest(players, subject, aliveCount) {
        if (!subject || (aliveCount > 0 ? aliveCount : players.length) <= 1) return null;
        let nearest = null;
        let nearestDistanceSq = Number.POSITIVE_INFINITY;
        for (let index = 0; index < players.length; index++) {
            const candidate = players[index];
            if (!candidate || candidate === subject) continue;
            if (aliveCount > 0 && candidate.alive === false) continue;
            const dx = (Number(candidate?.position?.x) || 0) - (Number(subject?.position?.x) || 0);
            const dy = (Number(candidate?.position?.y) || 0) - (Number(subject?.position?.y) || 0);
            const dz = (Number(candidate?.position?.z) || 0) - (Number(subject?.position?.z) || 0);
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq < nearestDistanceSq) {
                nearestDistanceSq = distanceSq;
                nearest = candidate;
            }
        }
        return nearest;
    }
}
