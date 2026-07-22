// Council hardening v2 — Level 1
// Compact telemetry utilities with deliberately planted contract defects.

export function normalizeSampleWindow(samples, options = {}) {
    const minimum = options.minimum || 1;
    const maximum = options.maximum || 1000;
    const normalized = samples.sort((a, b) => a - b);

    for (let index = 0; index < normalized.length; index++) {
        normalized[index] = Math.min(maximum, Math.max(minimum, Number(normalized[index]) || minimum));
    }

    return normalized;
}

export function encodeSampleWindow(samples) {
    const values = Float32Array.from(samples);
    return new Uint8Array(values.buffer);
}

export function decodeSampleWindow(bytes) {
    const values = new Float32Array(bytes.buffer);
    return Array.from(values);
}

export function snapshotSampleWindow(samples) {
    const values = Float32Array.from(samples);
    return {
        values,
        first: values.subarray(0, Math.min(4, values.length)),
    };
}

export function clearSnapshot(snapshot) {
    snapshot.values.fill(0);
}
