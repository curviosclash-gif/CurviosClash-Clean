import * as THREE from 'three';
import { validateGhostClip } from '../shared/contracts/GhostClipContract.js';
import { Trail } from './Trail.js';

const SHARED_GHOST_GEOMETRIES = {};
const GHOST_TRAIL_PLAYER_INDEX_OFFSET = 10000;
const GHOST_TRAIL_COLOR = 0xffffff;

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function markSharedGeometry(geometry) {
    if (!geometry) return;
    geometry.userData = geometry.userData || {};
    geometry.userData.__sharedNoDispose = true;
}

function ensureSharedGhostGeometries() {
    if (SHARED_GHOST_GEOMETRIES.body) return;

    SHARED_GHOST_GEOMETRIES.body = new THREE.ConeGeometry(0.34, 1.9, 8);
    SHARED_GHOST_GEOMETRIES.body.rotateX(-Math.PI / 2);
    SHARED_GHOST_GEOMETRIES.wings = new THREE.BoxGeometry(1.45, 0.08, 0.32);
    SHARED_GHOST_GEOMETRIES.tail = new THREE.BoxGeometry(0.08, 0.5, 0.42);
    SHARED_GHOST_GEOMETRIES.halo = new THREE.BoxGeometry(1.18, 0.64, 2.24);
    SHARED_GHOST_GEOMETRIES.glow = new THREE.SphereGeometry(0.38, 12, 12);

    for (const geometry of Object.values(SHARED_GHOST_GEOMETRIES)) {
        markSharedGeometry(geometry);
    }
}

function createGhostTrailCollisionSource(entityManager) {
    const trailSpatialIndex = entityManager?.getTrailSpatialIndex?.() || null;
    if (!trailSpatialIndex?.registerTrailSegment) return null;
    return {
        entityRuntimeConfig: entityManager.entityRuntimeConfig || null,
        getTrailSpatialIndex() {
            return entityManager?.getTrailSpatialIndex?.() || trailSpatialIndex;
        },
    };
}

function resolveGhostTrailPlayerIndex(playerIdx, collisionEnabled) {
    return collisionEnabled ? GHOST_TRAIL_PLAYER_INDEX_OFFSET + playerIdx : playerIdx;
}

function createGhostTrail(renderer, playerMeta = {}, options = {}) {
    const playerIdx = Number(playerMeta?.idx);
    if (!Number.isInteger(playerIdx) || playerIdx < 0) return null;
    if (!renderer?.addToScene || !renderer?.removeFromScene) return null;

    const collisionSource = options.trailCollisionEnabled === true
        ? createGhostTrailCollisionSource(options.entityManager || null)
        : null;
    const trailCollisionEnabled = !!collisionSource;
    const trailPlayerIndex = resolveGhostTrailPlayerIndex(playerIdx, trailCollisionEnabled);
    const trail = new Trail(renderer, GHOST_TRAIL_COLOR, trailPlayerIndex, collisionSource);
    trail.clear();
    if (trail.mesh) {
        trail.mesh.name = `lastRoundGhostTrail-${playerIdx}`;
        trail.mesh.renderOrder = 3;
        trail.mesh.userData = {
            ...(trail.mesh.userData || {}),
            entityViewType: 'last-round-ghost-trail',
            playerIdx,
            trailPlayerIndex,
            trailCollisionEnabled,
        };
    }
    return trail;
}

function buildGhostEntry(renderer, playerMeta = {}, options = {}) {
    ensureSharedGhostGeometries();

    const color = new THREE.Color(Number(playerMeta?.color) || 0xffffff);
    color.lerp(new THREE.Color(0xffffff), 0.55);
    const coreMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
    });
    const frameMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        wireframe: true,
        depthWrite: false,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const group = new THREE.Group();
    group.name = `lastRoundGhost-${playerMeta?.idx ?? 'unknown'}`;
    group.visible = false;
    group.renderOrder = 4;

    const body = new THREE.Mesh(SHARED_GHOST_GEOMETRIES.body, coreMaterial);
    body.position.z = -0.08;
    const wings = new THREE.Mesh(SHARED_GHOST_GEOMETRIES.wings, coreMaterial);
    wings.position.z = 0.12;
    const tail = new THREE.Mesh(SHARED_GHOST_GEOMETRIES.tail, coreMaterial);
    tail.position.set(0, 0.2, 0.42);
    const halo = new THREE.Mesh(SHARED_GHOST_GEOMETRIES.halo, frameMaterial);
    const glow = new THREE.Mesh(SHARED_GHOST_GEOMETRIES.glow, glowMaterial);
    glow.scale.set(1.5, 1.0, 2.1);

    group.add(body);
    group.add(wings);
    group.add(tail);
    group.add(halo);
    group.add(glow);
    group.scale.setScalar(Math.max(0.6, Number(playerMeta?.modelScale) || 1));
    const trail = createGhostTrail(renderer, playerMeta, options);

    return {
        idx: Number(playerMeta?.idx),
        group,
        materials: [coreMaterial, frameMaterial, glowMaterial],
        trail,
        trailCollisionEnabled: trail?.mesh?.userData?.trailCollisionEnabled === true,
    };
}

function disposeEntry(entry) {
    const materials = Array.isArray(entry?.materials) ? entry.materials : [];
    for (let i = 0; i < materials.length; i++) {
        materials[i]?.dispose?.();
    }
    entry?.trail?.clear?.();
    entry?.trail?.dispose?.();
}

function buildPlaybackFrames(frames) {
    const safeFrames = Array.isArray(frames) ? frames : [];
    const playbackFrames = new Array(safeFrames.length);
    for (let frameIndex = 0; frameIndex < safeFrames.length; frameIndex += 1) {
        const sourceFrame = safeFrames[frameIndex];
        const sourcePlayers = Array.isArray(sourceFrame?.players) ? sourceFrame.players : [];
        const playerLookup = Object.create(null);
        for (let poseIndex = 0; poseIndex < sourcePlayers.length; poseIndex += 1) {
            const pose = sourcePlayers[poseIndex];
            playerLookup[pose.idx] = pose;
        }
        playbackFrames[frameIndex] = {
            time: Number(sourceFrame?.time) || 0,
            players: sourcePlayers,
            playerLookup,
        };
    }
    return playbackFrames;
}

export class LastRoundGhostSystem {
    constructor(renderer, options = {}) {
        this.renderer = renderer || null;
        this.entityManager = options?.entityManager || null;
        this._ghostTrailCollisionEnabled = options?.ghostTrailCollisionEnabled === true;
        this.root = new THREE.Group();
        this.root.name = 'lastRoundGhostRoot';
        this.root.visible = false;
        this.root.userData = this.root.userData || {};
        this.root.userData.entityViewType = 'last-round-ghost';

        this._entries = [];
        this._frames = [];
        this._active = false;
        this._elapsed = 0;
        this._lastPlaybackTime = 0;
        this._frameCursor = 1;
        this._displayDuration = 3;
        this._sourceDuration = 0;
        this._playbackRate = 1;
        this._routeId = '';
        this._tmpQuatA = new THREE.Quaternion();
        this._tmpQuatB = new THREE.Quaternion();
        this._tmpTrailPosition = new THREE.Vector3();
        this._tmpTrailDirection = new THREE.Vector3();
    }

    configure(options = {}) {
        if (Object.prototype.hasOwnProperty.call(options, 'entityManager')) {
            this.entityManager = options.entityManager || null;
        }
        if (Object.prototype.hasOwnProperty.call(options, 'ghostTrailCollisionEnabled')) {
            this._ghostTrailCollisionEnabled = options.ghostTrailCollisionEnabled === true;
        }
    }

    _ensureAttached() {
        if (this.root.parent || !this.renderer?.addToScene) return;
        this.renderer.addToScene(this.root);
    }

    _clearEntries() {
        for (let i = 0; i < this._entries.length; i++) {
            const entry = this._entries[i];
            if (entry?.trail?.parent === this.root) {
                this.root.remove(entry.trail);
            }
            if (entry?.group?.parent === this.root) {
                this.root.remove(entry.group);
            }
            disposeEntry(entry);
        }
        this._entries.length = 0;
    }

    clear() {
        this._active = false;
        this._elapsed = 0;
        this._frames = [];
        this._lastPlaybackTime = 0;
        this._frameCursor = 1;
        this._displayDuration = 0;
        this._sourceDuration = 0;
        this._playbackRate = 1;
        this.root.visible = false;
        this._routeId = '';
        this._clearEntries();
    }

    playClip(clip = null) {
        this.clear();
        const clipValidation = validateGhostClip(clip);
        if (!clipValidation.valid || !clipValidation.clip) {
            return false;
        }
        const safeClip = clipValidation.clip;

        const playerMeta = Array.isArray(safeClip.players) ? safeClip.players : [];
        for (let i = 0; i < playerMeta.length; i++) {
            const entry = buildGhostEntry(this.renderer, playerMeta[i], {
                entityManager: this.entityManager,
                trailCollisionEnabled: this._ghostTrailCollisionEnabled,
            });
            this._entries.push(entry);
            this.root.add(entry.group);
        }

        if (this._entries.length === 0) {
            this.clear();
            return false;
        }

        this._frames = buildPlaybackFrames(safeClip.frames);
        this._sourceDuration = Math.max(0.0001, Number(safeClip.sourceDuration) || Number(safeClip.frames[safeClip.frames.length - 1]?.time) || 0.0001);
        this._displayDuration = Math.max(0.35, Number(safeClip.displayDuration) || this._sourceDuration);
        this._playbackRate = this._sourceDuration / this._displayDuration;
        this._active = true;
        this._frameCursor = Math.min(1, Math.max(0, this._frames.length - 1));
        this._lastPlaybackTime = 0;
        this._routeId = typeof safeClip.routeId === 'string' ? safeClip.routeId : '';
        this._ensureAttached();
        this.root.visible = true;
        this.update(0);
        return true;
    }

    update(dt) {
        if (!this._active || this._entries.length === 0 || this._frames.length === 0) {
            return;
        }

        this._elapsed += Math.max(0, Number(dt) || 0);
        const cycleTime = this._displayDuration > 0
            ? (this._elapsed % this._displayDuration)
            : this._elapsed;
        const playbackTime = Math.min(this._sourceDuration, cycleTime * this._playbackRate);
        const loopedPlayback = playbackTime < this._lastPlaybackTime;
        if (loopedPlayback) {
            this._frameCursor = Math.min(1, Math.max(0, this._frames.length - 1));
            for (let entryIndex = 0; entryIndex < this._entries.length; entryIndex += 1) {
                this._entries[entryIndex]?.trail?.clear?.();
            }
        }
        while (
            this._frameCursor < this._frames.length - 1
            && playbackTime > (Number(this._frames[this._frameCursor]?.time) || 0)
        ) {
            this._frameCursor += 1;
        }
        const nextFrame = this._frames[this._frameCursor] || this._frames[this._frames.length - 1] || null;
        const previousFrame = this._frames[Math.max(0, this._frameCursor - 1)] || nextFrame;
        const previousTime = Number(previousFrame?.time) || 0;
        const nextTime = Number(nextFrame?.time) || previousTime;
        const alpha = nextTime > previousTime
            ? THREE.MathUtils.clamp((playbackTime - previousTime) / (nextTime - previousTime), 0, 1)
            : 0;
        const bobPhase = this._elapsed * 4;
        this._lastPlaybackTime = playbackTime;

        for (let i = 0; i < this._entries.length; i++) {
            const entry = this._entries[i];
            const prevPose = previousFrame?.playerLookup?.[entry.idx] || null;
            const nextPose = nextFrame?.playerLookup?.[entry.idx] || null;
            const poseA = prevPose || nextPose;
            const poseB = nextPose || prevPose;

            if (!poseA || !poseB || (!poseA.alive && !poseB.alive)) {
                entry.group.visible = false;
                continue;
            }

            const currentPosition = this._tmpTrailPosition.set(
                THREE.MathUtils.lerp(Number(poseA.x) || 0, Number(poseB.x) || 0, alpha),
                THREE.MathUtils.lerp(Number(poseA.y) || 0, Number(poseB.y) || 0, alpha),
                THREE.MathUtils.lerp(Number(poseA.z) || 0, Number(poseB.z) || 0, alpha)
            );
            entry.group.visible = true;
            entry.group.position.set(
                currentPosition.x,
                currentPosition.y
                    + 0.55
                    + Math.sin(bobPhase + entry.idx) * 0.08,
                currentPosition.z
            );

            this._tmpQuatA.set(
                toFiniteNumber(poseA.qx, 0),
                toFiniteNumber(poseA.qy, 0),
                toFiniteNumber(poseA.qz, 0),
                toFiniteNumber(poseA.qw, 1)
            );
            if (this._tmpQuatA.lengthSq() <= 0.000001) this._tmpQuatA.identity();
            else this._tmpQuatA.normalize();
            this._tmpQuatB.set(
                toFiniteNumber(poseB.qx, 0),
                toFiniteNumber(poseB.qy, 0),
                toFiniteNumber(poseB.qz, 0),
                toFiniteNumber(poseB.qw, 1)
            );
            if (this._tmpQuatB.lengthSq() <= 0.000001) this._tmpQuatB.identity();
            else this._tmpQuatB.normalize();
            entry.group.quaternion.copy(this._tmpQuatA).slerp(this._tmpQuatB, alpha);
            this._tmpTrailDirection.set(0, 0, -1).applyQuaternion(entry.group.quaternion).normalize();
            entry.trail?.update?.(Math.max(0, Number(dt) || 0), currentPosition, this._tmpTrailDirection);
        }
    }

    getState() {
        const ghosts = [];
        let trailCount = 0;
        let trailPointCount = 0;
        let trailSegmentCount = 0;
        for (let i = 0; i < this._entries.length; i++) {
            const entry = this._entries[i];
            const entryTrailSegments = Math.max(0, Number(entry?.trail?.segmentCount) || 0);
            const entryTrailPoints = entryTrailSegments > 0 ? entryTrailSegments + 1 : 0;
            if (entry?.trail) {
                trailCount += 1;
                trailPointCount += entryTrailPoints;
                trailSegmentCount += entryTrailSegments;
            }
            ghosts.push({
                idx: entry.idx,
                visible: !!entry?.group?.visible,
                trailCollisionEnabled: entry?.trailCollisionEnabled === true,
                trailPoints: entryTrailPoints,
                trailSegments: entryTrailSegments,
                x: Number(entry?.group?.position?.x?.toFixed?.(2) || 0),
                y: Number(entry?.group?.position?.y?.toFixed?.(2) || 0),
                z: Number(entry?.group?.position?.z?.toFixed?.(2) || 0),
            });
        }

        return {
            active: this._active,
            routeId: this._routeId,
            frameCount: this._frames.length,
            entryCount: this._entries.length,
            trailCollisionEnabled: this._entries.some((entry) => entry?.trailCollisionEnabled === true),
            configuredTrailCollisionEnabled: this._ghostTrailCollisionEnabled,
            trailCount,
            trailPointCount,
            trailSegmentCount,
            frameCursor: this._frameCursor,
            elapsed: Number(this._elapsed.toFixed(3)),
            displayDuration: Number(this._displayDuration.toFixed(3)),
            sourceDuration: Number(this._sourceDuration.toFixed(3)),
            ghosts,
        };
    }

    dispose() {
        this.clear();
        if (this.root.parent) {
            this.root.parent.remove(this.root);
        }
    }
}
