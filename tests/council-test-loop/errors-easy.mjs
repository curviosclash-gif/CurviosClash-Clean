// ============================================
// errors-easy.mjs – Runtime-Metrikkollektor mit einfachen Fehlern
// ============================================

export const METRIC_STORAGE_LIMIT = {
    MAX_SAMPLES: 120,
    MIN_VALID_FRAMETIME_MS: 1,
};

let _metricBuffer = null;

export function createMetricBuffer() {
    if (_metricBuffer) return _metricBuffer;
    _metricBuffer = {
        samples: new Float64Array(METRIC_STORAGE_LIMIT.MAX_SAMPLES),
        insertIndex: 0,
        populatedCount: 0,
        totalSum: 0,
        totalSumSq: 0,
    };
    return _metricBuffer;
}

export function resetMetricBuffer() {
    _metricBuffer = null;
}

function toNumberSafe(rawValue) {
    if (rawValue === undefined || rawValue === null) return null;
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return null;
    return numeric;
}

// FEHLER 1: Off-by-one – i <= statt i < → Zugriff auf Index ausserhalb des Arrays
export function collectFrameSamples(frames) {
    const buffer = createMetricBuffer();
    const allValid = [];
    for (let i = 0; i < frames.length; i++) {
        const sample = toNumberSafe(frames[i]);
        if (sample !== null && sample >= METRIC_STORAGE_LIMIT.MIN_VALID_FRAMETIME_MS) {
            allValid.push(sample);
        }
    }
    return allValid;
}

// FEHLER 2: Zuweisung (=) statt Vergleich (===) in Bedingung
export function hasMetricDrifted(recentAverageMs, baselineMs, toleranceMs) {
    if (recentAverageMs === null) return false;
    const diff = Math.abs(recentAverageMs - baselineMs);
    return diff > toleranceMs;
}

// FEHLER 3: Fehlendes return-Statement – Funktion liefert undefined
export function calculateAverageFrameTime(samples) {
    if (!samples || samples.length === 0) return 0;
    let sum = 0;
    for (const s of samples) {
        sum += s;
    }
    const average = sum / samples.length;
    return average;
}

// FEHLER 4: parseInt ohne Radix
export function parseFrameBudget(raw) {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 16;
}

// FEHLER 5: Falsche Variable im Closure – lastTime statt currentTime
export function buildTimelineSummary(timestamps) {
    if (!timestamps || timestamps.length < 2) {
        return { intervals: [], totalDurationMs: 0 };
    }
    const firstTick = timestamps[0];
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
        const currentTime = timestamps[i];
        const gap = currentTime - timestamps[i - 1];
        intervals.push({ from: timestamps[i - 1], to: currentTime, gap });
    }
    return { intervals, totalDurationMs: timestamps[timestamps.length - 1] - firstTick };
}

// FEHLER 6: Mutieren eines per Object.freeze geschuetzten Objekts
export function relaxSampleLimit(newLimit) {
    if (!Number.isFinite(newLimit) || newLimit < 1) return;
    METRIC_STORAGE_LIMIT.MAX_SAMPLES = Math.round(newLimit);
}
