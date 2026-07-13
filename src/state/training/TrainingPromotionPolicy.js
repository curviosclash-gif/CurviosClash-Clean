import {
    resolveTrainingAlgorithmProfile,
    resolveTrainingPerformanceProfile,
} from './TrainingBenchmarkProfiles.js';

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundMetric(value) {
    return Math.round(toFiniteNumber(value, 0) * 1_000_000) / 1_000_000;
}

function normalizeStampToken(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildRequiredCheck(metric, actual, expected, ok, summary) {
    return {
        metric,
        comparator: 'required',
        value: actual,
        expected,
        level: ok ? 'pass' : 'fail',
        summary,
    };
}

function buildMinCheck(metric, value, hardThreshold, summary) {
    const numericValue = roundMetric(toFiniteNumber(value, 0));
    const numericThreshold = roundMetric(toFiniteNumber(hardThreshold, 0));
    return {
        metric,
        comparator: 'min',
        value: numericValue,
        hardThreshold: numericThreshold,
        level: numericValue >= numericThreshold ? 'pass' : 'fail',
        summary,
    };
}

function buildMaxCheck(metric, value, hardThreshold, summary) {
    const numericValue = roundMetric(toFiniteNumber(value, 0));
    const numericThreshold = roundMetric(toFiniteNumber(hardThreshold, 0));
    return {
        metric,
        comparator: 'max',
        value: numericValue,
        hardThreshold: numericThreshold,
        level: numericValue <= numericThreshold ? 'pass' : 'fail',
        summary,
    };
}

export const TRAINING_PROMOTION_POLICY_VERSION = 'v80-promotion-policy-v1';
export const DEFAULT_TRAINING_CHAMPION_PROMOTION_POLICY = Object.freeze({
    manualOnly: true,
    averageBotSurvivalDelta: 0.25,
    maxForcedRoundRate: 0,
    maxTimeoutRoundRate: 0,
});

export function createChampionPromotionPolicy(references = {}, manifest = null, defaultPolicy = DEFAULT_TRAINING_CHAMPION_PROMOTION_POLICY) {
    const algorithmProfile = resolveTrainingAlgorithmProfile(
        manifest?.algorithmProfileName
            || manifest?.candidate?.algorithmProfileName
            || manifest?.performanceProfile?.algorithmProfileName,
        null
    );
    const promotionPolicy = algorithmProfile?.promotion && typeof algorithmProfile.promotion === 'object'
        ? algorithmProfile.promotion
        : defaultPolicy;
    return Object.freeze({
        contractVersion: TRAINING_PROMOTION_POLICY_VERSION,
        championId: references?.champion?.id || null,
        championStamp: references?.champion?.stamp || null,
        manualOnly: promotionPolicy.manualOnly !== false,
        averageBotSurvivalDelta: roundMetric(
            toFiniteNumber(
                promotionPolicy.averageBotSurvivalDelta,
                defaultPolicy.averageBotSurvivalDelta
            )
        ),
        maxForcedRoundRate: roundMetric(
            toFiniteNumber(
                promotionPolicy.maxForcedRoundRate,
                defaultPolicy.maxForcedRoundRate
            )
        ),
        maxTimeoutRoundRate: roundMetric(
            toFiniteNumber(
                promotionPolicy.maxTimeoutRoundRate,
                defaultPolicy.maxTimeoutRoundRate
            )
        ),
    });
}

export function classifyTrainingBenchmarkCandidate(input = {}, options = {}) {
    const references = options.references && typeof options.references === 'object'
        ? options.references
        : {};
    const performanceProfile = input.performanceProfile && typeof input.performanceProfile === 'object'
        ? input.performanceProfile
        : resolveTrainingPerformanceProfile(input.performanceProfileName, null);
    const algorithmProfile = input.algorithmProfile && typeof input.algorithmProfile === 'object'
        ? input.algorithmProfile
        : resolveTrainingAlgorithmProfile(
            input.algorithmProfileName || performanceProfile?.algorithmProfileName,
            null
        );
    const environmentProfile = typeof input.environmentProfile === 'string' && input.environmentProfile.trim()
        ? input.environmentProfile.trim()
        : (performanceProfile?.run?.environmentProfile || null);
    const runtimeNear = environmentProfile === 'runtime-near';
    const syntheticLane = environmentProfile === 'synthetic-smoke';
    const stampToken = normalizeStampToken(input.stamp);
    const seriesToken = normalizeStampToken(input.seriesStamp);
    const championStampToken = normalizeStampToken(references?.champion?.stamp);
    const bt20Reference = stampToken.startsWith('bt20')
        || seriesToken.startsWith('bt20')
        || stampToken === normalizeStampToken(references?.bt20LatestCandidate?.stamp);

    let role = 'challenger';
    if (stampToken === championStampToken) {
        role = 'champion';
    } else if (syntheticLane || algorithmProfile?.track === 'ablation' || performanceProfile?.id === 'ablation') {
        role = 'ablation';
    }

    const referenceOnly = role === 'ablation'
        || bt20Reference
        || algorithmProfile?.referenceOnly === true;
    const promotionEligible = role === 'challenger'
        && runtimeNear
        && syntheticLane !== true
        && referenceOnly !== true;
    const notes = [];
    if (role === 'champion') {
        notes.push('BT11 bleibt eingefrorener Champion und wird nicht automatisch ersetzt.');
    }
    if (role === 'ablation') {
        notes.push('Ablation- und Synthetic-Lanes bleiben Vergleichs- oder Smoke-Lanes und nie Promotion-Kandidaten.');
    }
    if (bt20Reference) {
        notes.push('BT20 bleibt Challenger- oder Referenzlauf und darf nicht in den Champion-Slot promoted werden.');
    }
    if (promotionEligible) {
        notes.push('Promotion bleibt manuell und erfordert eine explizite Champion-Entscheidung trotz gruenem Gate.');
    }
    return Object.freeze({
        role,
        track: algorithmProfile?.track || null,
        runtimeNear,
        syntheticLane,
        referenceOnly,
        bt20Reference,
        promotionEligible,
        manualPromotionOnly: true,
        performanceProfileName: performanceProfile?.id || null,
        algorithmProfileName: algorithmProfile?.id || null,
        notes: Object.freeze(notes),
    });
}

export function evaluateChampionPromotion(input = {}, options = {}) {
    const references = options.references && typeof options.references === 'object'
        ? options.references
        : {};
    const classifyCandidate = typeof options.classifyCandidate === 'function'
        ? options.classifyCandidate
        : (candidateInput) => classifyTrainingBenchmarkCandidate(candidateInput, { references });
    const manifest = input.manifest && typeof input.manifest === 'object' ? input.manifest : null;
    const candidate = manifest?.candidate && typeof manifest.candidate === 'object'
        ? manifest.candidate
        : classifyCandidate({
            stamp: input.runStamp,
            performanceProfileName: manifest?.performanceProfileName,
            performanceProfile: manifest?.performanceProfile,
            algorithmProfileName: manifest?.algorithmProfileName,
            algorithmProfile: manifest?.algorithmProfile,
            environmentProfile: manifest?.environment?.profile,
        });
    const validationLane = input.validationLane && typeof input.validationLane === 'object'
        ? input.validationLane
        : {};
    const validationMetrics = validationLane.metrics && typeof validationLane.metrics === 'object'
        ? validationLane.metrics
        : {};
    const policy = createChampionPromotionPolicy(
        references,
        manifest,
        options.defaultPolicy || DEFAULT_TRAINING_CHAMPION_PROMOTION_POLICY
    );
    const championMetrics = references?.champion?.metrics || {};
    const requiredSurvival = roundMetric(
        toFiniteNumber(championMetrics.averageBotSurvival, 0) + policy.averageBotSurvivalDelta
    );
    const checks = [
        buildRequiredCheck(
            'candidateRole',
            candidate?.role || 'unknown',
            'challenger',
            candidate?.role === 'challenger',
            'Nur Challenger-Lanes koennen fuer eine Champion-Promotion vorgeschlagen werden.'
        ),
        buildRequiredCheck(
            'runtimeNear',
            candidate?.runtimeNear === true ? 'runtime-near' : 'non-runtime',
            'runtime-near',
            candidate?.runtimeNear === true,
            'Promotion bleibt strikt auf runtime-nahe Lanes begrenzt.'
        ),
        buildRequiredCheck(
            'referenceOnly',
            candidate?.referenceOnly === true ? 'reference-only' : 'promotion-lane',
            'promotion-lane',
            candidate?.referenceOnly !== true,
            'Referenz- oder Ablation-Lanes duerfen den Champion nicht ersetzen.'
        ),
        buildRequiredCheck(
            'gateOk',
            input.gateOk === true ? 'pass' : 'fail',
            'pass',
            input.gateOk === true,
            'Nur voll gruene Gate-Laeufe koennen fuer einen Champion-Wechsel vorgeschlagen werden.'
        ),
        buildRequiredCheck(
            'botValidationGate',
            input.botValidationGate?.ok === true ? 'pass' : 'fail',
            'pass',
            input.botValidationGate?.ok === true,
            'bot:validate muss gruen bleiben, sonst bleibt BT11 Champion.'
        ),
        buildRequiredCheck(
            'playEvalGate',
            input.playEvalGate?.ok === true ? 'pass' : 'fail',
            'pass',
            input.playEvalGate?.ok === true,
            'Die feste Play-Eval-Matrix darf fuer Promotion nicht regressieren.'
        ),
        buildMinCheck(
            'averageBotSurvival',
            validationMetrics.averageBotSurvival,
            requiredSurvival,
            'Promotion verlangt ein positives Survival-Delta gegen den eingefrorenen BT11-Champion.'
        ),
        buildMaxCheck(
            'forcedRoundRate',
            validationMetrics.forcedRoundRate,
            policy.maxForcedRoundRate,
            'Promotion bleibt bei erzwungenen Runden hart blockiert.'
        ),
        buildMaxCheck(
            'timeoutRoundRate',
            validationMetrics.timeoutRoundRate,
            policy.maxTimeoutRoundRate,
            'Promotion bleibt bei Timeout-Runden hart blockiert.'
        ),
    ];
    const hardFailures = checks.filter((entry) => entry.level === 'fail');
    return {
        contractVersion: TRAINING_PROMOTION_POLICY_VERSION,
        status: hardFailures.length === 0 ? 'eligible' : 'blocked',
        eligible: hardFailures.length === 0,
        decision: hardFailures.length === 0 ? 'manual-promotion-required' : 'hold-champion',
        manualPromotionOnly: policy.manualOnly === true,
        champion: Object.freeze({
            id: references?.champion?.id || null,
            stamp: references?.champion?.stamp || null,
            metrics: references?.champion?.metrics || {},
        }),
        candidate,
        policy,
        checks,
        hardFailures,
        warnings: [],
    };
}
