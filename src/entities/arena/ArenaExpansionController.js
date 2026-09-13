import {
    createMapExpansionState,
    normalizeMapExpansion,
    resolveMapExpansionState,
} from '../../shared/contracts/MapExpansionContract.js';

/**
 * Applies the expansion stage of the current match time to the arena's collision bounds.
 *
 * The arena is built at its final size - floor, outer walls and shadow coverage - so a stage
 * change never loads or compiles anything mid-round. Only arena.bounds follows the clock.
 * Collision, spawn placement and bot recovery read those bounds on every query, so a larger
 * stage is open in the same frame its time is reached.
 */
export class ArenaExpansionController {
    constructor(arena) {
        this.arena = arena;
        this.expansion = null;
        this.state = createMapExpansionState();
        /** Bounds of the fully grown map, or null when the map does not grow. */
        this.outerBounds = null;
        this._scale = 1;
        this._appliedStageIndex = -1;
        this._appliedBounds = null;
    }

    get active() {
        return this.expansion !== null;
    }

    /** Call after the arena bounds were set to the map's full size. */
    build(map, scale = 1) {
        this.clear();
        // An open face turns leaving the bounds into the exclusion zone. A stage size would
        // move that zone inwards, which no map has been designed or tested for.
        if (Array.isArray(this.arena?.openFaces) && this.arena.openFaces.length > 0) return false;
        this.expansion = normalizeMapExpansion(map?.expansion);
        if (!this.expansion) return false;
        const parsedScale = Number(scale);
        this._scale = Number.isFinite(parsedScale) && parsedScale > 0 ? parsedScale : 1;
        this.outerBounds = { ...this.arena.bounds };
        this.update(0);
        return true;
    }

    update(elapsedSeconds) {
        if (!this.expansion) return;
        resolveMapExpansionState(this.expansion, elapsedSeconds, this.state);
        // Static streaming swaps in bounds of its own and hands a copy of ours back when it
        // ends; the reference check below re-applies the stage onto that copy.
        if (this.arena._staticStreamingSnapshot) return;
        if (this.state.stageIndex === this._appliedStageIndex && this.arena.bounds === this._appliedBounds) return;
        this._applyStage(this.state.stageIndex);
    }

    _applyStage(stageIndex) {
        const size = this.expansion.stages[stageIndex].size;
        const outer = this.outerBounds;
        // The arena is centred on the origin; a stage larger than the built map is held to it,
        // because there would be no floor or walls beyond.
        const halfX = Math.min((size[0] * this._scale) / 2, outer.maxX);
        const halfZ = Math.min((size[2] * this._scale) / 2, outer.maxZ);
        this._appliedBounds = {
            minX: -halfX,
            maxX: halfX,
            minY: outer.minY,
            maxY: Math.min(size[1] * this._scale, outer.maxY),
            minZ: -halfZ,
            maxZ: halfZ,
        };
        this.arena.bounds = this._appliedBounds;
        this._appliedStageIndex = stageIndex;
    }

    clear() {
        this.expansion = null;
        this.state = createMapExpansionState();
        this.outerBounds = null;
        this._scale = 1;
        this._appliedStageIndex = -1;
        this._appliedBounds = null;
    }
}
