// Decides whether a heuristic search candidate replaces the current profile.
//
// The unchanged profile played against itself swings about 20 % between seeds, so a mean that is
// barely higher says nothing. A candidate must beat the current profile clearly on average and must
// not be worse in most of the individual matches, which both play on the same seed and slot.

// Loop and runner read the same state file; one constant keeps their versions from drifting apart.
export const HEURISTIC_SEARCH_STATE_VERSION = 21;

// Required relative gain of the mean over the current profile, for survival and for kills.
export const MIN_ACCEPTED_GAIN = 0.05;
// A candidate must be at least as good as the current profile in more than this share of the
// paired matches. Ties count as not worse, so a change that leaves some matches untouched can win.
export const MIN_NOT_WORSE_PAIR_SHARE = 0.5;

const PAIRED_METRICS = Object.freeze({
    survival: (row) => (row.candidateLives > 0 ? row.candidateLifeSeconds / row.candidateLives : 0),
    kills: (row) => row.candidateKills,
    // Hit point damage dealt, as the Hunt scoreboard counts it.
    damage: (row) => row.candidateDamage,
});

export function comparePairedMatches(candidateMatches, currentMatches, readMetric) {
    if (!Array.isArray(candidateMatches) || !Array.isArray(currentMatches)
        || candidateMatches.length === 0 || candidateMatches.length !== currentMatches.length) {
        throw new Error('paired comparison needs one current match for every candidate match');
    }
    const counts = { better: 0, equal: 0, worse: 0 };
    for (let index = 0; index < candidateMatches.length; index += 1) {
        const candidate = candidateMatches[index];
        const current = currentMatches[index];
        if (candidate.seed !== current.seed || candidate.slot !== current.slot) {
            throw new Error(`paired comparison mismatch at ${index}: seed/slot differ`);
        }
        const difference = readMetric(candidate) - readMetric(current);
        if (difference > 0) counts.better += 1;
        else if (difference < 0) counts.worse += 1;
        else counts.equal += 1;
    }
    return counts;
}

function isClearGain(candidateValue, currentValue) {
    return candidateValue > currentValue && candidateValue >= currentValue * (1 + MIN_ACCEPTED_GAIN);
}

function isNotWorseInMostPairs({ better, equal, worse }) {
    return (better + equal) / (better + equal + worse) > MIN_NOT_WORSE_PAIR_SHARE;
}

export function judgeCandidate(candidate, current) {
    const failed = [];
    if (!isClearGain(candidate.candidateSurvival, current.candidateSurvival)) failed.push('survival-gain');
    if (!isClearGain(candidate.candidateKills, current.candidateKills)) failed.push('kill-gain');
    // The comparison bots are the same in both evaluations, so the ratios must move with the means.
    if (!(candidate.survivalRatio > current.survivalRatio)) failed.push('survival-ratio');
    if (!(candidate.killRatio > current.killRatio)) failed.push('kill-ratio');
    const pairs = {
        survival: comparePairedMatches(candidate.matches, current.matches, PAIRED_METRICS.survival),
        kills: comparePairedMatches(candidate.matches, current.matches, PAIRED_METRICS.kills),
        damage: comparePairedMatches(candidate.matches, current.matches, PAIRED_METRICS.damage),
    };
    if (!isNotWorseInMostPairs(pairs.survival)) failed.push('survival-pairs');
    if (!isNotWorseInMostPairs(pairs.kills)) failed.push('kill-pairs');
    // Damage needs no gain of its own, but a candidate may not buy its lives by fighting less.
    if (!(candidate.candidateDamage >= current.candidateDamage)) failed.push('damage');
    if (!isNotWorseInMostPairs(pairs.damage)) failed.push('damage-pairs');
    return { accepted: failed.length === 0, failed, pairs };
}
