// Measures how long the GPU spends on one drawn frame. The frame rate cannot show headroom: it is
// capped at the monitor's refresh rate, so a card that idles half the frame and one that barely
// makes it both report 60. A timer query sees the GPU's own clock.
const QUERY_POOL_SIZE = 4;
const DEFAULT_WINDOW_SIZE = 180;
const NANOSECONDS_PER_MS = 1e6;

export class GpuFrameTimer {
    constructor(gl, { windowSize = DEFAULT_WINDOW_SIZE } = {}) {
        this.gl = gl || null;
        this.ext = null;
        try {
            this.ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') || null;
        } catch {
            this.ext = null;
        }
        this.available = !!this.ext && typeof gl?.createQuery === 'function';
        this._free = [];
        this._pending = [];
        this._active = null;
        this._discard = 0;
        this._samples = new Float32Array(windowSize);
        this._scratch = new Float32Array(windowSize);
        this._writeIndex = 0;
        this._count = 0;
        if (!this.available) return;
        for (let i = 0; i < QUERY_POOL_SIZE; i += 1) {
            const query = gl.createQuery();
            if (query) this._free.push(query);
        }
        this.available = this._free.length > 0;
    }

    begin() {
        if (!this.available || this._active) return;
        this._collect();
        const query = this._free.pop();
        if (!query) return;
        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
        this._active = query;
    }

    end() {
        if (!this._active) return;
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
        this._pending.push(this._active);
        this._active = null;
    }

    /** Forget the window, e.g. after a quality switch: old samples describe the old level. */
    reset() {
        this._writeIndex = 0;
        this._count = 0;
        // Queries still in flight were issued under the old level as well.
        this._discard = this._pending.length;
    }

    /** @returns {{samples: number, medianMs: number}} */
    getStats() {
        const count = this._count;
        if (count === 0) return { samples: 0, medianMs: Number.NaN };
        const scratch = this._scratch;
        scratch.set(this._samples);
        // Unused slots sort to the end, so the first `count` entries are the real samples in order.
        scratch.fill(Number.POSITIVE_INFINITY, count);
        scratch.sort();
        const middle = count >> 1;
        const medianMs = count % 2 === 1 ? scratch[middle] : (scratch[middle - 1] + scratch[middle]) / 2;
        return { samples: count, medianMs };
    }

    dispose() {
        if (this._active) this.end();
        for (const query of [...this._free, ...this._pending]) this.gl?.deleteQuery?.(query);
        this._free.length = 0;
        this._pending.length = 0;
        this.available = false;
    }

    _collect() {
        const gl = this.gl;
        // A disjoint event (GPU clock change, context switch) makes every result in flight
        // meaningless. Reading the flag also clears it.
        const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) === true;
        while (this._pending.length > 0) {
            const query = this._pending[0];
            if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
            this._pending.shift();
            const elapsed = Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
            this._free.push(query);
            if (this._discard > 0) {
                this._discard -= 1;
                continue;
            }
            if (!disjoint && elapsed > 0) this._push(elapsed / NANOSECONDS_PER_MS);
        }
    }

    _push(ms) {
        this._samples[this._writeIndex] = ms;
        this._writeIndex = (this._writeIndex + 1) % this._samples.length;
        if (this._count < this._samples.length) this._count += 1;
    }
}
