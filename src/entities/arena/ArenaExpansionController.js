import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import {
    MAP_EXPANSION_PHASES,
    createMapExpansionState,
    normalizeMapExpansion,
    resolveMapExpansionState,
} from '../../shared/contracts/MapExpansionContract.js';
import { ArenaExpansionWallVisual } from './ArenaExpansionWallVisual.js';

/**
 * Applies the expansion stage of the current match time to the arena's collision bounds and to
 * the walls that show those bounds.
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
        this.walls = new ArenaExpansionWallVisual(arena?.renderer);
        /** @type {{ active: boolean, phase: string, secondsUntilOpen: number, label: string }} */
        this._hudState = { active: false, phase: MAP_EXPANSION_PHASES.IDLE, secondsUntilOpen: 0, label: '' };
        this._scale = 1;
        this._stageBounds = [];
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
        this._stageBounds = this.expansion.stages.map((stage) => this._resolveStageBounds(stage.size));
        if (this.arena?.renderer?.addToScene) {
            const thickness = (Number(resolveGameplayConfig(this.arena).ARENA?.WALL_THICKNESS) || 0) * this._scale;
            this.walls.build(this._stageBounds, this.outerBounds, thickness);
        }
        this.update(0);
        return true;
    }

    update(elapsedSeconds) {
        if (!this.expansion) return;
        resolveMapExpansionState(this.expansion, elapsedSeconds, this.state);
        this.walls.update(this.state);
        // Static streaming swaps in bounds of its own and hands a copy of ours back when it
        // ends; the reference check below re-applies the stage onto that copy.
        if (this.arena._staticStreamingSnapshot) return;
        if (this.state.stageIndex === this._appliedStageIndex && this.arena.bounds === this._appliedBounds) return;
        this._appliedBounds = { ...this._stageBounds[this.state.stageIndex] };
        this.arena.bounds = this._appliedBounds;
        this._appliedStageIndex = this.state.stageIndex;
    }

    /**
     * What the HUD announces: active only while the next stage is announced or opening. Returns
     * one reused object, because the projection copies it every frame anyway.
     */
    getHudState() {
        const hud = this._hudState;
        const phase = this.state.phase;
        hud.active = this.expansion !== null
            && (phase === MAP_EXPANSION_PHASES.TELEGRAPH || phase === MAP_EXPANSION_PHASES.OPENING);
        hud.phase = hud.active ? phase : MAP_EXPANSION_PHASES.IDLE;
        hud.secondsUntilOpen = hud.active ? this.state.secondsUntilOpen : 0;
        hud.label = hud.active ? this.expansion.stages[this.state.nextStageIndex].label : '';
        return hud;
    }

    _resolveStageBounds(size) {
        const outer = this.outerBounds;
        // The arena is centred on the origin; a stage larger than the built map is held to it,
        // because there would be no floor or walls beyond.
        const halfX = Math.min((size[0] * this._scale) / 2, outer.maxX);
        const halfZ = Math.min((size[2] * this._scale) / 2, outer.maxZ);
        return Object.freeze({
            minX: -halfX,
            maxX: halfX,
            minY: outer.minY,
            maxY: Math.min(size[1] * this._scale, outer.maxY),
            minZ: -halfZ,
            maxZ: halfZ,
        });
    }

    clear() {
        this.walls.clear();
        this.expansion = null;
        this.state = createMapExpansionState();
        this.outerBounds = null;
        this._scale = 1;
        this._stageBounds = [];
        this._appliedStageIndex = -1;
        this._appliedBounds = null;
    }
}
