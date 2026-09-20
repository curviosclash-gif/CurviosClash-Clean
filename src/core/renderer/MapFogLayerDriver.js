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
        this._lastWritten = null;
    }

    setLayer(source) {
        const layer = normalizeMapFogLayer(source);
        if (!layer) {
            this._layer = null;
            // Only a map that actually moved its fog has edges to take back; clearing on every
            // plain map would fight the lighting profile that just wrote them.
            if (this._lastWritten) this._write({ height: 0, heightFalloff: 0, floor: 0, floorFalloff: 0 });
            return null;
        }
        this._layer = layer;
        this._lastWritten = null;
        return layer;
    }

    setScale(scale) {
        const numeric = Number(scale);
        this._scale = Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
    }

    /** Re-sends the current edges, for callers that rewrote the fog uniforms underneath us. */
    refresh() {
        this._lastWritten = null;
        if (this._layer) this._write(this._edgesFor(this._state));
    }

    update(elapsedSeconds) {
        if (!this._layer) return null;
        const state = resolveMapFogLayerState(this._layer, elapsedSeconds, this._state);
        return this._write(this._edgesFor(state));
    }

    _edgesFor(state) {
        const scale = this._scale;
        return {
            height: state.ceiling * scale,
            heightFalloff: state.ceilingFalloff / scale,
            floor: state.floor * scale,
            floorFalloff: state.floorFalloff / scale,
        };
    }

    _write(edges) {
        const last = this._lastWritten;
        if (last
            && last.height === edges.height
            && last.heightFalloff === edges.heightFalloff
            && last.floor === edges.floor
            && last.floorFalloff === edges.floorFalloff) {
            return last;
        }
        this._lastWritten = edges;
        this._apply(edges);
        return edges;
    }
}
