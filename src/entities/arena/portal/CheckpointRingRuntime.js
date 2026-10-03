import {
    setCheckpointRingState,
    RING_STATE_INACTIVE,
    RING_STATE_NEXT,
    RING_STATE_PASSED,
} from '../CheckpointRingMeshFactory.js';
import { SETTINGS_LIMITS } from '../../../shared/contracts/SettingsRuntimeContract.js';
import { findParcoursGuidanceWaypoint, isParcoursGuidanceRequiredAfterBranch, resolveActiveParcoursGuidance } from '../../../shared/utils/ParcoursGuidance.js';

const TRIGGER_PULSE_DURATION_MS = 300;
const TRIGGER_FLASH_ATTACK_MS = 65;
const TRIGGER_SCALE_PUNCH = 0.38;
const TRIGGER_EMISSIVE_FLASH = 2.8;
const FINISH_PULSE_CYCLE_MS = 500;
const FINISH_PULSE_CYCLES = 3;
const NEXT_PULSE_HZ = 2.5;
const NEXT_EMISSIVE_MIN = 0.5;
const NEXT_EMISSIVE_MAX = 1.5;
const NEXT_GLOW_STRENGTH_FALLBACK = 1.35;
const GUIDANCE_BREATH_MS = 1200;
// The trail starts just ahead of the ship and runs towards the target, so it reads as
// "fly this way" even while the ring itself is still far off or out of view.
const GUIDANCE_NEAR_OFFSET = 8;
const GUIDANCE_TRAIL_LENGTH = 36;
const GUIDANCE_BASE_OPACITY = 0.42;
// One slider drives ring glow, trail and edge arrow; the cap is only reached at its maximum.
const GUIDANCE_MAX_FACTOR = SETTINGS_LIMITS.gameplay.nextCheckpointGlowIntensity.max / NEXT_GLOW_STRENGTH_FALLBACK;
const GUIDANCE_OPACITY_CAP = 0.93;
// Help on demand: a new breath only when the player stops closing in on the target.
const GUIDANCE_PROGRESS_EPSILON = 2;
const GUIDANCE_STALL_MS = 3000;

export class CheckpointRingRuntime {
    constructor(arena) {
        this.arena = arena;
        this.spinEnabled = true;
        this.spinAngle = 0;
        this._progressProvider = null;
        this._particles = null;
        this._prevPassedCheckpointIds = new Set();
        this._passedCheckpointIdScratch = new Set();
        this._prevNextIndex = -1;
        this._prevCompleted = false;
        this._triggerAnimations = new Map(); // checkpointId -> { startMs, baseScale }
        this._finishAnimStartMs = -1;
        this._finishBaseScale = 1;
        // Game time, so slow motion and pauses slow or stop every ring animation with the match.
        this._clockMs = 0;
        this._guidanceProvider = null;
        this._guidanceTargets = [];
        this._previousGuidanceTargets = [];
        this._guidanceView = {
            active: false,
            intensity: 0,
            pulse: 0,
            player: null,
            targets: this._guidanceTargets,
        };
        this._guidanceTargetChangedAtMs = 0;
        this._guidanceBestDistance = Infinity;
        this._guidanceLastProgressMs = 0;
        this._guidancePathKey = '';
        this._guidanceWaypointIndex = -1;
        this._guidanceWaypointTarget = {
            checkpointId: 'guidance-waypoint',
            pos: { x: 0, y: 0, z: 0 },
            mesh: null,
        };
    }

    setProgressProvider(fn) {
        this._progressProvider = typeof fn === 'function' ? fn : null;
        this._prevPassedCheckpointIds.clear();
        this._prevNextIndex = -1;
        this._prevCompleted = false;
        this._triggerAnimations.clear();
        this._finishAnimStartMs = -1;
    }

    setParticleSystem(particles) {
        this._particles = particles && typeof particles.spawn === 'function' ? particles : null;
    }

    setGuidanceProvider(fn) {
        this._guidanceProvider = typeof fn === 'function' ? fn : null;
        this._resetGuidance();
    }

    getGuidanceView() {
        return this._guidanceView;
    }

    // The rings are built from the map definition alone, while running the route is a
    // per-round decision. Prewarmed arenas are reused across matches, so a mode that does
    // not run the route has to hide them again rather than rely on how they were built.
    setRingsVisible(isVisible) {
        const rings = Array.isArray(this.arena?.checkpointRings) ? this.arena.checkpointRings : [];
        for (const entry of rings) {
            if (entry?.mesh) entry.mesh.visible = isVisible !== false;
        }
    }

    resetRuntimeState() {
        this.spinAngle = 0;
        this._triggerAnimations.clear();
        this._finishAnimStartMs = -1;
        this._finishBaseScale = 1;
        this._prevPassedCheckpointIds.clear();
        this._prevNextIndex = -1;
        this._prevCompleted = false;
        this._clockMs = 0;
        this._guidancePathKey = '';
        this._guidanceWaypointIndex = -1;
        this._resetGuidance();
    }

    update(dt = 0) {
        const rings = this.arena.checkpointRings;
        if (!rings || rings.length === 0) return;

        const deltaSeconds = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this._clockMs += deltaSeconds * 1000;
        const now = this._clockMs;

        if (this.spinEnabled) {
            this.spinAngle = (this.spinAngle + deltaSeconds * 0.2) % (Math.PI * 2);
            for (const entry of rings) {
                const ringMesh = entry?.mesh?.userData?.ringMesh;
                if (ringMesh) ringMesh.rotation.z = this.spinAngle;
            }
        }

        const snapshot = this._progressProvider?.();
        if (snapshot) {
            this._syncRingStates(rings, snapshot, now);
        }

        this._animateNextPulse(rings, now);
        this._animateGuidance(rings, now, snapshot);
        this._animateTriggerPulses(rings, now);
        this._animateFinish(rings, now);
    }

    _syncRingStates(rings, snapshot, now) {
        const { passedMask, passedCheckpointIds, nextCheckpointIndex, completed } = snapshot;
        const passedCheckpointIdSet = this._passedCheckpointIdScratch;
        passedCheckpointIdSet.clear();
        if (Array.isArray(passedCheckpointIds)) {
            for (let i = 0; i < passedCheckpointIds.length; i += 1) {
                const checkpointId = String(passedCheckpointIds[i] || '').trim();
                if (checkpointId) passedCheckpointIdSet.add(checkpointId);
            }
        }
        const hasExplicitPassedCheckpointIds = passedCheckpointIdSet.size > 0;

        for (const entry of rings) {
            if (entry.isFinish) continue;
            const idx = entry.routeIndex;
            if (idx < 0) continue;
            const checkpointId = String(entry.checkpointId || '').trim();

            const prevPassed = checkpointId
                ? this._prevPassedCheckpointIds.has(checkpointId)
                : false;
            const isPassed = checkpointId
                ? (
                    hasExplicitPassedCheckpointIds
                        ? passedCheckpointIdSet.has(checkpointId)
                        : (Array.isArray(passedMask) && idx < passedMask.length && passedMask[idx] === 1)
                )
                : false;
            const isNext = !completed && nextCheckpointIndex === idx;

            if (isPassed && !prevPassed) {
                setCheckpointRingState(entry, RING_STATE_PASSED);
                const ringMesh = entry.mesh?.userData?.ringMesh;
                if (checkpointId) {
                    this._triggerAnimations.set(checkpointId, {
                        startMs: now,
                        baseScale: ringMesh?.scale?.x ?? 1,
                        baseEmissiveIntensity: ringMesh?.material?.emissiveIntensity ?? 0.45,
                    });
                }
                this._spawnCheckpointParticles(entry);
            } else if (!checkpointId || !this._triggerAnimations.has(checkpointId)) {
                const target = isPassed ? RING_STATE_PASSED : isNext ? RING_STATE_NEXT : RING_STATE_INACTIVE;
                if (entry.mesh?.userData?.ringState !== target) {
                    setCheckpointRingState(entry, target);
                }
            }
        }

        if (completed && !this._prevCompleted) {
            const finishEntry = rings.find((r) => r.isFinish);
            if (finishEntry) {
                const ringMesh = finishEntry.mesh?.userData?.ringMesh;
                this._finishBaseScale = ringMesh?.scale?.x ?? 1;
                this._finishAnimStartMs = now;
                this._spawnFinishParticles(finishEntry);
            }
        }

        // Swap the two sets instead of allocating a fresh one every frame.
        this._passedCheckpointIdScratch = this._prevPassedCheckpointIds;
        this._prevPassedCheckpointIds = passedCheckpointIdSet;
        this._prevNextIndex = nextCheckpointIndex;
        this._prevCompleted = !!completed;
    }

    _animateNextPulse(rings, now) {
        const configuredGlowStrength = Number(this.arena?.runtimeConfig?.gameplay?.nextCheckpointGlowIntensity);
        const glowStrength = Math.max(
            0,
            Number.isFinite(configuredGlowStrength) ? configuredGlowStrength : NEXT_GLOW_STRENGTH_FALLBACK
        );
        const t = (Math.sin((now / 1000) * Math.PI * 2 * NEXT_PULSE_HZ) + 1) * 0.5;
        const intensity = (NEXT_EMISSIVE_MIN + t * (NEXT_EMISSIVE_MAX - NEXT_EMISSIVE_MIN)) * glowStrength;
        for (const entry of rings) {
            if (entry.isFinish || entry.mesh?.userData?.ringState !== RING_STATE_NEXT) continue;
            const ringMesh = entry.mesh?.userData?.ringMesh;
            if (ringMesh?.material) ringMesh.material.emissiveIntensity = intensity;
        }
    }

    _resetGuidance() {
        this._guidanceTargets.length = 0;
        this._guidanceView.active = false;
        this._guidanceView.intensity = 0;
        this._guidanceView.pulse = 0;
        this._guidanceView.player = null;
        this._previousGuidanceTargets.length = 0;
        this._guidanceTargetChangedAtMs = 0;
        this._guidanceBestDistance = Infinity;
        this._guidanceLastProgressMs = 0;
        this._guidancePathKey = '';
        this._guidanceWaypointIndex = -1;
        const rings = Array.isArray(this.arena?.checkpointRings) ? this.arena.checkpointRings : [];
        for (const entry of rings) this._hideGuidanceMotifs(entry);
    }

    _hideGuidanceMotifs(entry) {
        const motifs = entry?.mesh?.userData?.guidanceMotifs;
        if (!Array.isArray(motifs)) return;
        for (let i = 0; i < motifs.length; i += 1) motifs[i].visible = false;
    }

    _animateGuidance(rings, now, snapshot = null) {
        const source = this._guidanceProvider?.();
        const guidanceSnapshot = snapshot || source;
        const player = source?.player;
        const configuredIntensity = Number(this.arena?.runtimeConfig?.gameplay?.nextCheckpointGlowIntensity);
        const rawIntensity = Number.isFinite(configuredIntensity)
            ? configuredIntensity
            : NEXT_GLOW_STRENGTH_FALLBACK;
        const factor = Math.min(GUIDANCE_MAX_FACTOR, Math.max(0, rawIntensity / NEXT_GLOW_STRENGTH_FALLBACK));
        const view = this._guidanceView;
        const targets = this._guidanceTargets;
        targets.length = 0;
        view.pulse = 0;
        let guidanceChanged = false;
        if (!player?.position || factor <= 0 || source?.active !== true) {
            view.active = false;
            view.intensity = factor;
            view.player = null;
            this._previousGuidanceTargets.length = 0;
            this._guidanceTargetChangedAtMs = 0;
            this._guidanceBestDistance = Infinity;
            this._guidancePathKey = '';
            this._guidanceWaypointIndex = -1;
            for (const entry of rings) this._hideGuidanceMotifs(entry);
            return;
        }

        const guidance = resolveActiveParcoursGuidance(source?.route, guidanceSnapshot);
        if (guidance) {
            const waypointIndex = findParcoursGuidanceWaypoint(guidance.points, player.position);
            const waypoint = guidance.points[waypointIndex];
            if (waypoint) {
                const target = this._guidanceWaypointTarget;
                target.checkpointId = `${guidance.endCheckpointId}:guidance`;
                target.pos.x = waypoint[0];
                target.pos.y = waypoint[1];
                target.pos.z = waypoint[2];
                const endRing = rings.find((entry) => entry.checkpointId === guidance.endCheckpointId) || null;
                target.mesh = endRing?.mesh || null;
                for (const entry of rings) {
                    if (entry !== endRing) this._hideGuidanceMotifs(entry);
                }
                targets.push(target);
                const pathKey = `${guidance.branchCheckpointId}:${guidance.endCheckpointId}`;
                guidanceChanged = pathKey !== this._guidancePathKey || waypointIndex !== this._guidanceWaypointIndex;
                this._guidancePathKey = pathKey;
                this._guidanceWaypointIndex = waypointIndex;
            }
        } else if (isParcoursGuidanceRequiredAfterBranch(source?.route, guidanceSnapshot)) {
            if (this._guidancePathKey) guidanceChanged = true;
            this._guidancePathKey = '';
            this._guidanceWaypointIndex = -1;
            for (const entry of rings) this._hideGuidanceMotifs(entry);
        } else {
            if (this._guidancePathKey) guidanceChanged = true;
            this._guidancePathKey = '';
            this._guidanceWaypointIndex = -1;
            for (const entry of rings) {
                const isTarget = entry?.isFinish
                    ? guidanceSnapshot?.completed !== true && guidanceSnapshot?.nextCheckpointIndex >= source.totalCheckpoints
                    : entry?.mesh?.userData?.ringState === RING_STATE_NEXT;
                if (!isTarget || !entry?.pos) {
                    this._hideGuidanceMotifs(entry);
                    continue;
                }
                targets.push(entry);
            }
        }
        let targetChanged = guidanceChanged || targets.length !== this._previousGuidanceTargets.length;
        for (let i = 0; i < targets.length; i += 1) {
            if (targets[i] !== this._previousGuidanceTargets[i]) targetChanged = true;
            this._previousGuidanceTargets[i] = targets[i];
        }
        this._previousGuidanceTargets.length = targets.length;
        if (targetChanged) {
            this._guidanceTargetChangedAtMs = now;
            this._guidanceLastProgressMs = now;
            this._guidanceBestDistance = Infinity;
        }
        // `active` means "there is something to point at": the edge arrow stays up between
        // breaths, only the world trail waits for the next breath.
        view.active = targets.length > 0;
        view.intensity = factor;
        view.player = player;
        if (targets.length === 0) return;
        this._trackGuidanceProgress(targets, player, now);

        const elapsed = Math.max(0, now - this._guidanceTargetChangedAtMs);
        if (elapsed >= GUIDANCE_BREATH_MS) {
            for (let i = 0; i < targets.length; i += 1) this._hideGuidanceMotifs(targets[i]);
            return;
        }
        const breathT = elapsed / GUIDANCE_BREATH_MS;
        // A target handoff starts at the breath peak so the new route is readable immediately.
        const breath = Math.cos(breathT * Math.PI * 0.5);
        view.pulse = breath;
        const opacity = Math.min(GUIDANCE_OPACITY_CAP, GUIDANCE_BASE_OPACITY * factor) * breath;
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
            const entry = targets[targetIndex];
            const dx = (Number(entry.pos.x) || 0) - (Number(player.position.x) || 0);
            const dy = (Number(entry.pos.y) || 0) - (Number(player.position.y) || 0);
            const dz = (Number(entry.pos.z) || 0) - (Number(player.position.z) || 0);
            const distance = Math.hypot(dx, dy, dz);
            const motifs = entry.mesh?.userData?.guidanceMotifs;
            if (!Array.isArray(motifs) || distance < 0.01) {
                this._hideGuidanceMotifs(entry);
                continue;
            }
            const startDistance = Math.min(GUIDANCE_NEAR_OFFSET, distance * 0.3);
            const travelDistance = Math.min(startDistance + GUIDANCE_TRAIL_LENGTH, distance) - startDistance;
            const inverseDistance = 1 / distance;
            const color = entry.mesh?.userData?.checkpointColor;
            for (let i = 0; i < motifs.length; i += 1) {
                const motif = motifs[i];
                const t = (breathT + i / motifs.length) % 1;
                const edgeFade = Math.min(1, t * 6, (1 - t) * 6);
                const along = startDistance + travelDistance * t;
                motif.position.set(
                    (Number(player.position.x) || 0) + dx * inverseDistance * along,
                    (Number(player.position.y) || 0) + dy * inverseDistance * along,
                    (Number(player.position.z) || 0) + dz * inverseDistance * along
                );
                if (typeof entry.mesh?.worldToLocal === 'function') {
                    entry.mesh.worldToLocal(motif.position);
                } else {
                    motif.position.set(
                        motif.position.x - (Number(entry.pos.x) || 0),
                        motif.position.y - (Number(entry.pos.y) || 0),
                        motif.position.z - (Number(entry.pos.z) || 0)
                    );
                }
                motif.scale.setScalar(0.65 + (1 - t) * 0.55 + breath * 0.18);
                motif.visible = true;
                if (motif.material) {
                    if (Number.isFinite(color)) motif.material.color.setHex(color);
                    motif.material.opacity = opacity * edgeFade * 0.75;
                }
                const coreMaterial = motif.userData?.guidanceCore?.material;
                if (coreMaterial) coreMaterial.opacity = opacity * edgeFade;
            }
        }
    }

    _trackGuidanceProgress(targets, player, now) {
        let nearest = Infinity;
        for (let i = 0; i < targets.length; i += 1) {
            const pos = targets[i].pos;
            const distance = Math.hypot(
                (Number(pos.x) || 0) - (Number(player.position.x) || 0),
                (Number(pos.y) || 0) - (Number(player.position.y) || 0),
                (Number(pos.z) || 0) - (Number(player.position.z) || 0)
            );
            if (distance < nearest) nearest = distance;
        }
        if (nearest < this._guidanceBestDistance - GUIDANCE_PROGRESS_EPSILON) {
            this._guidanceBestDistance = nearest;
            this._guidanceLastProgressMs = now;
        } else if (now - this._guidanceLastProgressMs >= GUIDANCE_STALL_MS) {
            this._guidanceTargetChangedAtMs = now;
            this._guidanceLastProgressMs = now;
        }
    }

    _animateTriggerPulses(rings, now) {
        for (const [checkpointId, anim] of this._triggerAnimations) {
            const elapsed = now - anim.startMs;
            const entry = rings.find((r) => String(r?.checkpointId || '').trim() === checkpointId);
            const ringMesh = entry?.mesh?.userData?.ringMesh;

            if (elapsed >= TRIGGER_PULSE_DURATION_MS) {
                if (ringMesh) {
                    ringMesh.scale.setScalar(anim.baseScale);
                    if (ringMesh.material) {
                        ringMesh.material.emissiveIntensity = anim.baseEmissiveIntensity;
                    }
                }
                this._triggerAnimations.delete(checkpointId);
                continue;
            }

            if (ringMesh) {
                const t = elapsed / TRIGGER_PULSE_DURATION_MS;
                const settleT = 1 - Math.pow(1 - t, 3);
                const scaleBoost = 1 + (TRIGGER_SCALE_PUNCH * Math.sin(settleT * Math.PI));
                ringMesh.scale.setScalar(anim.baseScale * scaleBoost);
                if (ringMesh.material) {
                    const flashT = elapsed <= TRIGGER_FLASH_ATTACK_MS
                        ? (elapsed / TRIGGER_FLASH_ATTACK_MS)
                        : (1 - ((elapsed - TRIGGER_FLASH_ATTACK_MS) / Math.max(1, TRIGGER_PULSE_DURATION_MS - TRIGGER_FLASH_ATTACK_MS)));
                    const flashIntensity = anim.baseEmissiveIntensity
                        + (Math.max(0, flashT) * (TRIGGER_EMISSIVE_FLASH - anim.baseEmissiveIntensity));
                    ringMesh.material.emissiveIntensity = flashIntensity;
                }
            }
        }
    }

    _animateFinish(rings, now) {
        if (this._finishAnimStartMs < 0) return;
        const totalMs = FINISH_PULSE_CYCLE_MS * FINISH_PULSE_CYCLES;
        const elapsed = now - this._finishAnimStartMs;
        const finishEntry = rings.find((r) => r.isFinish);
        const ringMesh = finishEntry?.mesh?.userData?.ringMesh;

        if (elapsed >= totalMs || !ringMesh) {
            if (ringMesh) {
                ringMesh.scale.setScalar(this._finishBaseScale);
                ringMesh.material.emissiveIntensity = 1.5;
            }
            this._finishAnimStartMs = -1;
            return;
        }

        const cycleT = (elapsed % FINISH_PULSE_CYCLE_MS) / FINISH_PULSE_CYCLE_MS;
        ringMesh.scale.setScalar(this._finishBaseScale * (1.0 + 0.25 * Math.sin(cycleT * Math.PI)));
        ringMesh.material.emissiveIntensity = Math.max(0.8, 1.0 + 1.5 * Math.sin(cycleT * Math.PI));
    }

    _spawnCheckpointParticles(entry) {
        if (!this._particles?.spawn || !entry?.pos) return;
        this._particles.spawn(entry.pos, 24, 0xaaff00, 9.2, 0.72, 0.95, { type: 'checkpoint-pass', gravity: -2.2 });
        this._particles.spawn(entry.pos, 10, 0xffffff, 6.0, 0.34, 0.48, { type: 'checkpoint-pass-core', gravity: -0.8 });
    }

    _spawnFinishParticles(entry) {
        if (!this._particles?.spawn || !entry?.pos) return;
        this._particles.spawn(entry.pos, 40, 0xffd700, 7.0, 0.8, 1.5, { type: 'finish-complete', gravity: 4.0 });
        this._particles.spawn(entry.pos, 20, 0xffffff, 12.0, 0.5, 0.9, { type: 'finish-burst', gravity: -2.0 });
    }
}
