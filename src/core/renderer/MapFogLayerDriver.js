import {
    createMapFogLayerState,
    normalizeMapFogLayer,
    resolveMapFogLayerState,
} from '../../shared/contracts/MapFogLayerContract.js';

/**
 * Drives a map's travelling fog layer from the match clock.
 *
 * It exists as its own object for two reasons. The arithmetic - resolve the contract, convert
 * authored map units into world units - is worth testing without a WebGL context, and the fog
 * uniforms have a single-writer rule: the lighting rig owns the static profile, this owns the
 * two height edges, and nothing else touches either.
 *
 * A map without a layer writes nothing at all, so the lighting profile it authored stays
 * untouched. Leaving such a map clears the edges once.
 */
export class MapFogLayerDriver {
    constructor({ apply } = {}) {
        this._apply = typeof apply === 'function' ? apply : () => {};
        this._layer = null;
        this._state = createMapFogLayerState();
        this._scale = 1;
        this._edges = { height: 0, heightFalloff: 0, floor: 0, floorFalloff: 0 };
        this._hasLastWritten = false;
        this._lastWrittenHeight = 0;
        this._lastWrittenHeightFalloff = 0;
        this._lastWrittenFloor = 0;
        this._lastWrittenFloorFalloff = 0;
    }

    setLayer(source) {
        const layer = normalizeMapFogLayer(source);
        if (!layer) {
            this._layer = null;
            // Only a map that actually moved its fog has edges to take back; clearing on every
            // plain map would fight the lighting profile that just wrote them.
            if (this._hasLastWritten) {
                this._edges.height = 0;
                this._edges.heightFalloff = 0;
                this._edges.floor = 0;
                this._edges.floorFalloff = 0;
                this._write(this._edges);
            }
            return null;
        }
        this._layer = layer;
        this._hasLastWritten = false;
        return layer;
    }

    setScale(scale) {
        const numeric = Number(scale);
        this._scale = Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
    }

    /** Re-sends the current edges, for callers that rewrote the fog uniforms underneath us. */
    refresh() {
        this._hasLastWritten = false;
        if (this._layer) this._write(this._edgesFor(this._state));
    }

    update(elapsedSeconds) {
        if (!this._layer) return null;
        const state = resolveMapFogLayerState(this._layer, elapsedSeconds, this._state);
        return this._write(this._edgesFor(state));
    }

    _edgesFor(state) {
        const scale = this._scale;
        this._edges.height = state.ceiling * scale;
        this._edges.heightFalloff = state.ceilingFalloff / scale;
        this._edges.floor = state.floor * scale;
        this._edges.floorFalloff = state.floorFalloff / scale;
        return this._edges;
    }

    _write(edges) {
        if (this._hasLastWritten
            && this._lastWrittenHeight === edges.height
            && this._lastWrittenHeightFalloff === edges.heightFalloff
            && this._lastWrittenFloor === edges.floor
            && this._lastWrittenFloorFalloff === edges.floorFalloff) {
            return edges;
        }
        this._hasLastWritten = true;
        this._lastWrittenHeight = edges.height;
        this._lastWrittenHeightFalloff = edges.heightFalloff;
        this._lastWrittenFloor = edges.floor;
        this._lastWrittenFloorFalloff = edges.floorFalloff;
        this._apply(edges);
        return edges;
    }
}
