export const RUNTIME_RNG_CONTRACT_VERSION = 'runtime-rng.v1';

function toUInt32(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return (Math.floor(Math.abs(numeric)) >>> 0);
}

function createXorshift32(seed) {
    let state = toUInt32(seed) || 0x6d2b79f5;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return ((state >>> 0) / 0x100000000);
    };
}

export function createRuntimeRng(options = {}) {
    const seed = toUInt32(options.seed);
    const random = typeof options.random === 'function'
        ? options.random
        : (seed > 0 ? createXorshift32(seed) : Math.random);

    const next = () => {
        const value = Number(random());
        if (!Number.isFinite(value)) return 0;
        if (value <= 0) return 0;
        if (value >= 1) return 0.999999999;
        return value;
    };

    const int = (maxExclusive) => {
        const max = Number.isFinite(Number(maxExclusive)) ? Math.floor(Number(maxExclusive)) : 0;
        if (max <= 0) return 0;
        return Math.floor(next() * max);
    };

    const pick = (values = []) => {
        if (!Array.isArray(values) || values.length === 0) return null;
        return values[int(values.length)];
    };

    return {
        contractVersion: RUNTIME_RNG_CONTRACT_VERSION,
        next,
        int,
        pick,
    };
}
