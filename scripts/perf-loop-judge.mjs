// Accept/reject rule of the performance loop (.claude/skills/perf-loop).
// Input: probe reports (tests/perf-loop-probe.desktop.spec.js) of baseline and candidate runs
// in their measured order (ABBA...). Quality must be identical; the target metric the hypothesis
// named in advance must improve beyond noise, and no metric may get worse.

export const PERF_LOOP_DEFAULTS = Object.freeze({
    minGain: 0.03,
    noiseFactor: 1,
    maxRegression: 0.05,
    // 'any' (calibration, screening) counts an improvement of cpuUpdate, cpuRender or gpu.
    target: 'any',
});

// Medians: other sessions on the machine cause spikes that would dominate a mean.
const METRICS = Object.freeze({
    cpuUpdate: { label: 'CPU update median', read: (report) => report.timing.update.p50Ms },
    cpuRender: { label: 'CPU render median', read: (report) => report.timing.render.p50Ms },
    gpu: { label: 'GPU frame median',
        read: (report) => (report.timing.gpu?.samples > 0 && Number.isFinite(report.timing.gpu.medianMs) ? report.timing.gpu.medianMs : null) },
    cpu: { label: 'CPU update+render mean', read: (report) => report.timing.cpu.meanMs },
    cpuP95: { label: 'CPU update+render p95', read: (report) => report.timing.cpu.p95Ms },
});
export const PERF_LOOP_TARGETS = Object.freeze(['cpuUpdate', 'cpuRender', 'gpu', 'cpu']);
const VERDICT_RANK = Object.freeze({ accept: 0, 'reject-perf': 1, 'reject-quality': 2, invalid: 3 });

const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
// Sample standard deviation; one pair alone says nothing about noise and counts as infinitely noisy.
const deviation = (values) => {
    if (values.length < 2) return Number.POSITIVE_INFINITY;
    const center = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
};
const gainOf = (baseline, candidate) => (baseline > 0 ? (baseline - candidate) / baseline : 0);
const percent = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;

const fingerprint = (report) => JSON.stringify({
    frames: report.quality.frames.map(({ tick, sha256, sim }) => ({ tick, sha256, sim })),
    checkpoints: report.timing.checkpoints,
    final: report.timing.final,
});

function describeQualityDifference(baseline, candidate) {
    const details = [];
    for (const frame of baseline.quality.frames) {
        const other = candidate.quality.frames.find((entry) => entry.tick === frame.tick);
        if (!other) { details.push(`tick ${frame.tick}: frame missing`); continue; }
        if (frame.sha256 !== other.sha256) {
            const changedTiles = frame.tiles.filter((hash, index) => hash !== other.tiles[index]).length;
            details.push(`tick ${frame.tick}: pixels differ in ${changedTiles}/${frame.tiles.length} screen tiles`);
        }
        if (JSON.stringify(frame.sim) !== JSON.stringify(other.sim)) details.push(`tick ${frame.tick}: simulation state differs`);
    }
    if (JSON.stringify(baseline.timing.checkpoints) !== JSON.stringify(candidate.timing.checkpoints)
        || JSON.stringify(baseline.timing.final) !== JSON.stringify(candidate.timing.final)) {
        details.push('real-time match: simulation checkpoints differ');
    }
    return details;
}

// The machine speed drifts while other work runs, so a metric is compared within adjacent
// baseline/candidate pairs (ABBA): drift cancels inside a pair, and the spread of the pair
// gains is the noise. One metric is summed over all maps; per-map numbers explain the source.
function judgeMetric(runs, mapKeys, read, limits) {
    if (runs.some((run) => mapKeys.some((mapKey) => read(run.maps[mapKey]) === null))) return null;
    const pairGains = (value) => {
        const gains = [];
        for (let index = 0; index + 1 < runs.length; index += 2) {
            const pair = runs.slice(index, index + 2);
            const baselineRun = pair.find((run) => run.arm === 'baseline'), candidateRun = pair.find((run) => run.arm === 'candidate');
            if (baselineRun && candidateRun) gains.push(gainOf(value(baselineRun), value(candidateRun)));
        }
        return gains;
    };
    const armMedian = (arm, value) => median(runs.filter((run) => run.arm === arm).map(value));
    const summarize = (value) => {
        const pairs = pairGains(value);
        return { baseline: armMedian('baseline', value), candidate: armMedian('candidate', value), gain: mean(pairs), noise: deviation(pairs), pairs };
    };
    const perMap = Object.fromEntries(mapKeys.map((mapKey) => [mapKey, summarize((run) => read(run.maps[mapKey]))]));
    const total = summarize((run) => mapKeys.reduce((sum, mapKey) => sum + read(run.maps[mapKey]), 0));
    const required = Math.max(limits.minGain, limits.noiseFactor * total.noise);
    // Symmetric to an improvement: worse beyond noise, and worse in every pair.
    const regressed = (entry) => entry.gain < -Math.max(limits.maxRegression, limits.noiseFactor * entry.noise)
        && entry.pairs.every((pairGain) => pairGain < 0);
    const regressedMaps = regressed(total) ? mapKeys : mapKeys.filter((mapKey) => regressed(perMap[mapKey]));
    return { ...total, required, perMap, regressedMaps,
        improved: total.gain >= required && total.pairs.length > 0 && total.pairs.every((pairGain) => pairGain > 0) };
}

/**
 * @param {{ arm: 'baseline'|'candidate', maps: Record<string, object> }[]} runs in measured order
 * @param {Partial<typeof PERF_LOOP_DEFAULTS>} [options]
 */
export function judgePerfLoop(runs, options = {}) {
    const limits = { ...PERF_LOOP_DEFAULTS, ...options };
    const targets = limits.target === 'any' ? ['cpuUpdate', 'cpuRender', 'gpu'] : [limits.target];
    const result = { verdict: 'accept', reasons: [], limits, quality: {}, metrics: {} };
    if (!targets.every((target) => PERF_LOOP_TARGETS.includes(target))) {
        result.verdict = 'invalid';
        result.reasons.push(`unknown target "${limits.target}"; use any, ${PERF_LOOP_TARGETS.join(', ')}`);
        return result;
    }
    const fail = (verdict, reason) => {
        if (VERDICT_RANK[verdict] > VERDICT_RANK[result.verdict]) result.verdict = verdict;
        result.reasons.push(reason);
    };
    const arms = { baseline: runs.filter((run) => run.arm === 'baseline'), candidate: runs.filter((run) => run.arm === 'candidate') };
    if (arms.baseline.length < 2 || arms.candidate.length < 2) {
        fail('invalid', 'need at least two runs per arm to estimate noise');
        return result;
    }
    const mapKeys = Object.keys(runs[0].maps).sort();
    if (runs.some((run) => JSON.stringify(Object.keys(run.maps).sort()) !== JSON.stringify(mapKeys))) {
        fail('invalid', 'runs did not measure the same maps');
        return result;
    }
    const setup = (report) => JSON.stringify([report.measureSeconds, report.warmupSeconds, report.qualityTicks, report.timing.gpuName]);
    for (const mapKey of mapKeys) {
        if (new Set(runs.map((run) => setup(run.maps[mapKey]))).size !== 1) fail('invalid', `${mapKey}: runs used different settings or GPUs`);
        for (const [arm, armRuns] of Object.entries(arms)) {
            if (new Set(armRuns.map((run) => fingerprint(run.maps[mapKey]))).size !== 1) {
                fail('invalid', `${mapKey}: ${arm} runs are not deterministic, the probe cannot judge quality`);
            }
        }
    }
    if (result.verdict === 'invalid') return result;

    for (const mapKey of mapKeys) {
        const differences = describeQualityDifference(arms.baseline[0].maps[mapKey], arms.candidate[0].maps[mapKey]);
        result.quality[mapKey] = { identical: differences.length === 0, differences,
            drawCalls: { baseline: arms.baseline[0].maps[mapKey].timing.renderInfo.meanCalls, candidate: arms.candidate[0].maps[mapKey].timing.renderInfo.meanCalls } };
        for (const detail of differences) fail('reject-quality', `${mapKey}: ${detail}`);
    }

    for (const [key, metric] of Object.entries(METRICS)) {
        const judged = judgeMetric(runs, mapKeys, metric.read, limits);
        if (!judged) continue;
        result.metrics[key] = { label: metric.label, target: targets.includes(key), ...judged };
        for (const mapKey of judged.regressedMaps) fail('reject-perf', `${metric.label} worse on ${mapKey} (${percent(judged.perMap[mapKey].gain)})`);
    }
    const improved = Object.entries(result.metrics).filter(([, metric]) => metric.target && metric.improved).map(([key]) => key);
    if (improved.length === 0) {
        const best = Object.values(result.metrics).filter((metric) => metric.target).sort((a, b) => b.gain - a.gain)[0];
        fail('reject-perf', best
            ? `target did not improve beyond noise (best: ${best.label} ${percent(best.gain)}, required ${percent(best.required)} in every ABBA pair)`
            : 'the target metric could not be measured');
    }
    result.improved = improved;
    return result;
}

export function formatPerfLoopVerdict(result) {
    const lines = [`[perf-loop] verdict=${result.verdict}${result.improved?.length ? ` improved=${result.improved.join(',')}` : ''}`];
    for (const [key, metric] of Object.entries(result.metrics || {})) {
        lines.push(`[perf-loop] ${key}${metric.target ? ' (target)' : ''}: ${metric.baseline.toFixed(3)} -> ${metric.candidate.toFixed(3)} ms gain=${percent(metric.gain)} `
            + `required=${percent(metric.required)} noise=${(metric.noise * 100).toFixed(1)}% pairs=[${metric.pairs.map(percent).join(' ')}]`);
        for (const [mapKey, entry] of Object.entries(metric.perMap)) {
            lines.push(`[perf-loop]   ${mapKey}: ${entry.baseline.toFixed(3)} -> ${entry.candidate.toFixed(3)} ms ${percent(entry.gain)} noise=${(entry.noise * 100).toFixed(1)}%`);
        }
    }
    for (const [mapKey, quality] of Object.entries(result.quality || {})) {
        lines.push(`[perf-loop] quality ${mapKey}: ${quality.identical ? 'identical' : 'CHANGED'} drawCalls ${quality.drawCalls.baseline.toFixed(1)} -> ${quality.drawCalls.candidate.toFixed(1)}`);
    }
    for (const reason of result.reasons) lines.push(`[perf-loop] reason: ${reason}`);
    return lines.join('\n');
}
