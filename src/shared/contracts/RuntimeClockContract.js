export const RUNTIME_CLOCK_CONTRACT_VERSION = 'runtime-clock.v1';

function resolveNowMs(runtime = null) {
    if (runtime && typeof runtime.nowMs === 'function') {
        return runtime.nowMs.bind(runtime);
    }
    return () => Date.now();
}

function resolveNowHighRes(runtime = null) {
    if (runtime && typeof runtime.nowHighRes === 'function') {
        return runtime.nowHighRes.bind(runtime);
    }
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return () => performance.now();
    }
    return () => Date.now();
}

export function createRuntimeClock(options = {}) {
    const runtime = options.runtime && typeof options.runtime === 'object' ? options.runtime : null;
    const nowMs = typeof options.nowMs === 'function' ? options.nowMs : resolveNowMs(runtime);
    const nowHighRes = typeof options.nowHighRes === 'function'
        ? options.nowHighRes
        : resolveNowHighRes(runtime);
    return {
        contractVersion: RUNTIME_CLOCK_CONTRACT_VERSION,
        nowMs,
        nowHighRes,
    };
}
