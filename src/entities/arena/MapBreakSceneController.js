import {
    normalizeMapDestructibles,
    resolveMapDestructibleSceneTimeline,
} from '../../shared/contracts/MapDestructibleContract.js';
import {
    createGlbModelColliderIndex,
    deactivateHiddenGlbModels,
    resolveGlbModelRoot,
    setGlbModelActive,
    setGlbPieceActive,
} from './GlbModelVisibilityOps.js';

/**
 * Plays the baked fall of a destructible map.
 *
 * A break event says which segment went down, when and towards which world heading. The contract
 * turns the events of a round into a timeline of scenes and, on the way, into the angle each slot
 * has to be turned by - the event heading minus the heading the clip was baked falling towards.
 * This class is what that timeline actually does to the loaded GLB scene: the intact models
 * disappear, the model holding the baked fall appears, turned by that angle, and its one-shot clip
 * is started at the match time the break happened at. Pieces an earlier scene already took away are
 * switched off first, so the summit never falls twice.
 *
 * Nothing here decides anything. The timeline is derived from the events alone, so a replica
 * that receives the host's events runs the identical sequence without a single extra message.
 * Applying the same events twice does nothing, which is what makes it safe to call on every
 * network update.
 */
export class MapBreakSceneController {
    /**
     * @param {any} arena
     * @param {readonly any[] | null | undefined} colliders colliders the GLB load produced
     * @param {any} driver the arena's GlbAnimationDriver
     */
    constructor(arena, colliders, driver) {
        this.arena = arena || null;
        this.driver = driver || null;
        this.definition = normalizeMapDestructibles(arena?.currentMapDefinition?.destructibles);
        this._colliderIndex = createGlbModelColliderIndex(colliders);
        /** @type {import('../../shared/contracts/MapDestructibleContract.js').MapDestructibleSceneTimelineEntry[]} */
        this._applied = [];
        /** Authored yaw of every scene slot, so the event yaw is added to it rather than replacing it. */
        this._authoredYaw = new Map();
        for (const scene of this.definition?.breakScenes || []) {
            if (this._authoredYaw.has(scene.modelId)) continue;
            const root = resolveGlbModelRoot(this.arena, scene.modelId);
            this._authoredYaw.set(scene.modelId, Number(root?.rotation?.y) || 0);
        }
        deactivateHiddenGlbModels(this.arena, this._colliderIndex);
    }

    get appliedSceneCount() {
        return this._applied.length;
    }

    /**
     * Applies everything the given events imply that is not on screen yet.
     *
     * The new timeline usually continues the one already playing, and then only its new entries
     * have to be carried out. If it does not - a replayed round, a host that corrected itself -
     * the map is put back together first and the whole timeline is played onto it, because a
     * scene that is half applied is not a state the map can be repaired from piece by piece.
     * @param {unknown} events
     * @returns {number} how many scenes of the timeline are now playing
     */
    applyEvents(events) {
        const timeline = resolveMapDestructibleSceneTimeline(this.definition, events);
        if (!this._continuesApplied(timeline)) this.reset();
        for (let index = this._applied.length; index < timeline.length; index += 1) {
            this._applyEntry(timeline[index]);
            this._applied.push(timeline[index]);
        }
        return this._applied.length;
    }

    /**
     * Whether the new timeline starts with exactly the scenes already on screen. Comparing the
     * length alone would miss a different break of the same kind at a different time.
     * @param {readonly import('../../shared/contracts/MapDestructibleContract.js').MapDestructibleSceneTimelineEntry[]} timeline
     */
    _continuesApplied(timeline) {
        if (timeline.length < this._applied.length) return false;
        for (let index = 0; index < this._applied.length; index += 1) {
            const applied = this._applied[index];
            const next = timeline[index];
            if (applied.sceneId !== next.sceneId
                || applied.modelId !== next.modelId
                || applied.atSeconds !== next.atSeconds
                || applied.yaw !== next.yaw
                || applied.hiddenPieceIds.join(',') !== next.hiddenPieceIds.join(',')) {
                return false;
            }
        }
        return true;
    }

    /** Puts the map back together. Used at round start, where the arena may be reused as it is. */
    reset() {
        this._applied.length = 0;
        // Pieces come back before the scene models go away, otherwise showing a piece would put
        // the colliders of a switched-off scene back into the arena.
        for (const modelId of this._everyModelId()) {
            for (const piece of this.definition?.pieces || []) {
                setGlbPieceActive(this.arena, this._colliderIndex, modelId, piece, true);
            }
        }
        for (const scene of this.definition?.breakScenes || []) {
            for (const modelId of scene.hideModelIds) {
                setGlbModelActive(this.arena, this._colliderIndex, modelId, true);
            }
        }
        for (const scene of this.definition?.breakScenes || []) {
            setGlbModelActive(this.arena, this._colliderIndex, scene.modelId, false);
            this._setSceneYaw(scene.modelId, 0, false);
            this.driver?.setTrackStart?.(scene.modelId, 0);
        }
    }

    /**
     * @param {import('../../shared/contracts/MapDestructibleContract.js').MapDestructibleSceneTimelineEntry} entry
     */
    _applyEntry(entry) {
        for (const modelId of entry.hideModelIds) {
            setGlbModelActive(this.arena, this._colliderIndex, modelId, false);
        }
        setGlbModelActive(this.arena, this._colliderIndex, entry.modelId, true);
        this._setSceneYaw(entry.modelId, entry.yaw, entry.yawFromEvent);
        for (const piece of entry.hiddenPieceIds) {
            setGlbPieceActive(this.arena, this._colliderIndex, entry.modelId, piece, false);
        }
        this.driver?.setTrackStart?.(entry.modelId, entry.atSeconds);
    }

    /**
     * @param {string} modelId
     * @param {number} yaw
     * @param {boolean} yawFromEvent
     */
    _setSceneYaw(modelId, yaw, yawFromEvent) {
        const root = resolveGlbModelRoot(this.arena, modelId);
        if (!root?.rotation) return;
        const authored = this._authoredYaw.get(modelId) || 0;
        root.rotation.y = yawFromEvent ? authored + (Number(yaw) || 0) : authored;
    }

    /** @returns {string[]} every model id the break scenes of this map touch. */
    _everyModelId() {
        /** @type {string[]} */
        const ids = [];
        for (const scene of this.definition?.breakScenes || []) {
            for (const modelId of [scene.modelId, ...scene.hideModelIds]) {
                if (!ids.includes(modelId)) ids.push(modelId);
            }
        }
        return ids;
    }
}

/**
 * Builds the controller for a freshly loaded GLB scene and immediately applies the events the
 * arena already knows about - a replica can receive the host's state while the models are still
 * loading, and that collapse must not be lost.
 * @param {any} arena
 * @param {readonly any[] | null | undefined} colliders
 * @param {any} driver
 * @param {unknown} events
 * @returns {MapBreakSceneController}
 */
export function createMapBreakSceneController(arena, colliders, driver, events) {
    const controller = new MapBreakSceneController(arena, colliders, driver);
    controller.applyEvents(events);
    return controller;
}
