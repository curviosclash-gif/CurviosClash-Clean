import { createMapFireProgression, advanceMapFireProgression, damageMapFireSegment, resolveMapFireProgress } from '../../shared/contracts/MapFireProgressionContract.js';
import { emitMapDestructiblePressureFeedback } from '../effects/MapDestructibleBreakFeedback.js';
import {
    applyMapDestructibleDamage,
    applyMapDestructibleNetworkState,
    createMapDestructibleState,
    isMapDestructibleModeAllowed,
    normalizeMapDestructibles,
    resolveMapDestructibleHudState,
    resolveMapDestructibleSegmentByHit,
    serializeMapDestructibleState,
} from '../../shared/contracts/MapDestructibleContract.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import * as THREE from 'three';

/**
 * Runtime owner of the map geometry a match can shoot apart.
 *
 * Weapons report the name of the mesh they struck; this system turns that name into a segment
 * and books the damage. Only the host simulates - a replica receives the whole state, so both
 * sides see the same tower without every shot needing its own message.
 *
 * The break events the state collects are the hand-over point for the fall animations of a
 * later stage: each one names the segment, its kind and the direction it topples towards.
 */
export class MapDestructibleSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.definition = null;
        this.state = createMapDestructibleState(null);
        this.networkReplica = false;
        this.anchorScale = 1;
        this._targets = [];
        this._forwardedEventSignature = '';
        this._feedbackEventSignature = '';
        this._pendingPressureFeedback = null;
        this.fireDefinition = null;
        this.fireState = null;
    }

    /**
     * Reads the map's `destructibles` block and starts a fresh tower. Returns the segment count.
     *
     * A map may restrict its destructibility to certain modes. Nothing is installed in the others,
     * so the very same map is flown as intact fabric there - the map itself stays playable in every
     * mode, because map eligibility is a separate and deliberately mode-agnostic question.
     */
    startRound() {
        const arena = this.entityManager?.arena;
        const map = arena?.currentMapDefinition;
        const authored = normalizeMapDestructibles(map?.destructibles);
        const mode = String(this.entityManager?.gameModeStrategy?.modeType || '').toUpperCase();
        this.definition = isMapDestructibleModeAllowed(authored, mode) ? authored : null;
        // Authored anchors are given in the map's own units; a scaled map builds its tower that
        // much larger, so the anchors a hit is measured against have to grow with it.
        this.anchorScale = map?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(resolveGameplayConfig(this.entityManager).ARENA?.MAP_SCALE) || 1)
            : 1;
        this.state = createMapDestructibleState(this.definition);
        this.fireDefinition = map?.fireProgression || null;
        this.fireState = createMapFireProgression(this.fireDefinition);
        this._fireWarnings = new Set();
        arena?.setMapFireState?.(this.fireState);
        this._targets.length = 0;
        for (let index = 0; index < (this.definition?.segments?.length || 0); index += 1) {
            const segment = this.definition.segments[index];
            const target = {
                id: `map_structure:${segment.id}`,
                segmentId: segment.id,
                mapStructure: true,
                destructible: true,
                alive: true,
                hp: this.state.segments[index]?.hp || 0,
                maxHp: this.state.segments[index]?.maxHp || segment.hp,
                hitboxRadius: 2,
                position: new THREE.Vector3(...segment.anchor).multiplyScalar(this.anchorScale),
            };
            target.takeDamage = (amount, options = {}) => this.applySegmentHit(target.segmentId, amount, options);
            this._targets.push(target);
        }
        this._forwardedEventSignature = '';
        this._feedbackEventSignature = '';
        this._pendingPressureFeedback = null;
        // An arena that was reused rather than rebuilt still shows last round's collapse.
        arena?.resetMapDestructibleScenes?.();
        return this.state.segments.length;
    }

    schedulePressureFeedback(position, atSeconds) {
        const start = Number.isFinite(Number(atSeconds)) ? Number(atSeconds) : this.getElapsedSeconds();
        // A late join receives the cloud state without replaying an old detonation.
        if (this.getElapsedSeconds() > start + 1) return;
        this._pendingPressureFeedback = { position, atSeconds: start + 0.28 };
    }

    updateFeedback() {
        if (this.fireState) {
            if (!this.networkReplica) advanceMapFireProgression(this.fireDefinition, this.fireState, this.getElapsedSeconds(), (id, atSeconds) => {
                const result = applyMapDestructibleDamage(this.state, this.definition, id, 100000, { atSeconds });
                if (result.event) this._onSegmentDestroyed(result.event, {});
            });
            for (let index = 0; index < this.fireState.segments.length; index += 1) {
                const fire = this.fireState.segments[index];
                const segment = this.state.segments.find((entry) => entry.id === fire.id);
                if (segment && !segment.destroyed) segment.hp = Math.max(0.001, segment.maxHp * (1 - fire.heat));
                if (fire.warningAt < 0 || fire.brokenAt >= 0 || this._fireWarnings.has(fire.id)) continue;
                this._fireWarnings.add(fire.id);
                const anchor = this.fireDefinition.segments[index].anchor;
                this.entityManager?.audio?.playMapCollapse?.(anchor, this.anchorScale);
                const target = this._targets[index];
                this.entityManager?.particles?.spawn?.(target.position, 24, 0x8b7361, 5, 3, 1);
            }
            this.entityManager?.arena?.setMapFireState?.(this.fireState);
        }
        const pending = this._pendingPressureFeedback;
        if (!pending || this.getElapsedSeconds() < pending.atSeconds) return;
        this._pendingPressureFeedback = null;
        emitMapDestructiblePressureFeedback(this.entityManager, pending.position);
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    clear() {
        this.fireDefinition = null;
        this.fireState = null;
        this.entityManager?.arena?.setMapFireState?.(null);
        this.definition = null;
        this.state = createMapDestructibleState(null);
        this.anchorScale = 1;
        this._targets.length = 0;
        this._forwardedEventSignature = '';
        this._feedbackEventSignature = '';
        this._pendingPressureFeedback = null;
    }

    /** Whether this map has anything to shoot apart at all. */
    isActive() {
        return this.state.segments.length > 0;
    }

    /** Match time the animated setpieces are posed for - the clock every break is stamped with. */
    getElapsedSeconds() {
        const elapsed = Number(this.entityManager?.arena?.glbAnimationElapsedSeconds);
        return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    }

    /**
     * Books weapon damage on the segment a mesh belongs to. Returns the contract result, or
     * null when the mesh belongs to no segment or this client only replicates the host.
     *
     * The intact tower gives all four legs the same mesh names, so the impact position decides
     * which of them was hit - a weapon without one still books on the first matching segment.
     * @param {unknown} meshName
     * @param {unknown} damage
     * @param {{ hitPoint?: unknown, hitDirection?: unknown, sourcePlayer?: unknown, cause?: unknown }} [options]
     */
    applyMeshHit(meshName, damage, options = {}) {
        if (this.networkReplica || !this.definition || this.state.sealed) return null;
        const segment = resolveMapDestructibleSegmentByHit(
            this.definition,
            meshName,
            options?.hitPoint,
            this.anchorScale,
        );
        if (!segment) return null;

        return this.applySegmentHit(segment.id, damage, options);
    }

    applySegmentHit(segmentId, damage, options = {}) {
        if (this.networkReplica || !this.definition || this.state.sealed) return null;
        if (this.fireState) {
            this.updateFeedback();
            if (!damageMapFireSegment(this.fireDefinition, this.fireState, segmentId, damage)) return null;
            const segment = this.state.segments.find((entry) => entry.id === segmentId);
            const fireSegment = this.fireState.segments.find((entry) => entry.id === segmentId);
            segment.hp = Math.max(0.001, segment.maxHp * (1 - fireSegment.heat));
            segment.lastHitAtSeconds = this.getElapsedSeconds();
            this._syncTargets();
            return { applied: true, segment, destroyed: false, event: null };
        }
        const result = applyMapDestructibleDamage(this.state, this.definition, segmentId, damage, {
            atSeconds: this.getElapsedSeconds(),
            hitDirection: options?.hitDirection,
            chooseVariant: (count) => this.entityManager?.runtimeRng?.int?.(count) ?? 0,
        });
        if (!result.applied) return null;
        this._syncTargets();
        if (result.event) this._onSegmentDestroyed(result.event, options);
        return result;
    }

    _syncTargets() {
        for (let index = 0; index < this._targets.length; index += 1) {
            const target = this._targets[index];
            const state = this.state.segments.find((entry) => entry.id === target.segmentId);
            target.hp = Math.max(0, Number(state?.hp) || 0);
            target.maxHp = Math.max(1, Number(state?.maxHp) || 1);
            target.alive = state?.destroyed !== true && state?.collapsed !== true && target.hp > 0;
        }
    }

    getTargets() {
        this._syncTargets();
        return this.state.sealed ? [] : this._targets;
    }

    getState() {
        return this.state;
    }

    getDefinition() {
        return this.definition;
    }

    getFireProgress() {
        return this.fireDefinition ? resolveMapFireProgress(this.fireDefinition, this.fireState) : null;
    }

    getHudState() {
        return resolveMapDestructibleHudState(this.state, this.definition, this.getElapsedSeconds());
    }

    serializeNetworkState() {
        if (!this.isActive()) return null;
        const state = serializeMapDestructibleState(this.state);
        return this.fireState ? { ...state, fireProgression: structuredClone(this.fireState) } : state;
    }

    applyNetworkState(serialized) {
        if (!serialized) return this.state;
        applyMapDestructibleNetworkState(this.state, serialized);
        if (this.fireDefinition) {
            this.fireState = createMapFireProgression(this.fireDefinition, serialized.fireProgression);
            this.entityManager?.arena?.setMapFireState?.(this.fireState);
        }
        this._syncTargets();
        // The host sends state, not animation commands. The replica derives the same collapse
        // from the same events, so both towers stand or lie exactly alike.
        this._forwardEventsToArena();
        const events = this.state.events;
        const last = events[events.length - 1];
        if (last) this._emitBreakFeedback(last, { replicated: true });
        return this.state;
    }

    /**
     * Hands the break events to the arena, which plays the baked falls for them.
     *
     * A host snapshot arrives many times a second and almost always carries the very same
     * events, so the last handover is remembered and an unchanged list is not passed on again -
     * the arena would otherwise rebuild the same timeline on every packet.
     */
    _forwardEventsToArena() {
        const events = this.state.events;
        const last = events[events.length - 1];
        const signature = last
            ? `${events.length}|${last.segmentId}|${last.kind}|${last.atSeconds}|${last.yaw}|${last.variantIndex ?? 0}`
            : '';
        if (signature === this._forwardedEventSignature) return false;
        this._forwardedEventSignature = signature;
        this.entityManager?.arena?.applyMapDestructibleEvents?.(events);
        return true;
    }

    /**
     * Seam for everything a break should trigger: the baked fall on the arena, and whatever
     * feedback the rest of the game wants to hang off one place.
     */
    _onSegmentDestroyed(event, options = {}) {
        this._forwardEventsToArena();
        this._emitBreakFeedback(event, {
            sourcePlayer: options?.sourcePlayer || null,
            cause: options?.cause || null,
            replicated: false,
        });
    }

    _emitBreakFeedback(event, context = {}) {
        const signature = event
            ? `${event.segmentId}|${event.kind}|${event.atSeconds}|${event.yaw}`
            : '';
        if (!signature || signature === this._feedbackEventSignature) return false;
        this._feedbackEventSignature = signature;
        const owner = this.entityManager;
        if (typeof owner?.onMapDestructibleBreak === 'function') {
            owner.onMapDestructibleBreak(event, context);
        }
        return true;
    }
}
