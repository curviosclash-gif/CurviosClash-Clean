function toNumber(value, fallback = 0) {
    if (value == null) return fallback;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 1) {
    const numeric = Math.trunc(toNumber(value, fallback));
    return Math.max(1, numeric);
}

function roundMetric(value, digits = 3) {
    const factor = 10 ** digits;
    return Math.round(toNumber(value, 0) * factor) / factor;
}

function createThresholds(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return {
        lowSurvivalSeconds: toNumber(source.lowSurvivalSeconds, 7),
        highWallHitsPerRound: toNumber(source.highWallHitsPerRound, 0.55),
        highTrailHitsPerRound: toNumber(source.highTrailHitsPerRound, 0.35),
        highStuckPerMinute: toNumber(source.highStuckPerMinute, 1.1),
        lowBotWinRate: toNumber(source.lowBotWinRate, 0.35),
    };
}

function classifySeverity(score) {
    if (score >= 0.85) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
}

function addFinding(findings, finding) {
    const score = Math.max(0, Math.min(1, toNumber(finding.score, 0)));
    findings.push({
        id: finding.id,
        severity: finding.severity || classifySeverity(score),
        score: roundMetric(score),
        title: finding.title,
        evidence: finding.evidence,
        recommendation: finding.recommendation,
        tuningTargets: Array.isArray(finding.tuningTargets) ? [...finding.tuningTargets] : [],
    });
}

function sumBy(items, selector) {
    return items.reduce((sum, item) => sum + toNumber(selector(item), 0), 0);
}

export function buildBotPlayAnalysisReport(rounds = [], options = {}) {
    const selectedRounds = Array.isArray(rounds)
        ? rounds.filter((round) => toNumber(round?.botCount, 0) > 0)
        : [];
    const thresholds = createThresholds(options.thresholds);
    const roundCount = selectedRounds.length;
    const totalDuration = sumBy(selectedRounds, (round) => round.duration);
    const botWins = selectedRounds.filter((round) => !!round.winnerIsBot).length;
    const averageBotSurvival = roundCount > 0
        ? sumBy(selectedRounds, (round) => round.botSurvivalAverage) / roundCount
        : 0;
    const wallHitsPerRound = roundCount > 0 ? sumBy(selectedRounds, (round) => round.bounceWallEvents) / roundCount : 0;
    const trailHitsPerRound = roundCount > 0 ? sumBy(selectedRounds, (round) => round.bounceTrailEvents) / roundCount : 0;
    const stuckEvents = sumBy(selectedRounds, (round) => round.stuckEvents);
    const stuckPerMinute = totalDuration > 0 ? stuckEvents / (totalDuration / 60) : 0;
    const botWinRate = roundCount > 0 ? botWins / roundCount : 0;
    const findings = [];

    if (averageBotSurvival > 0 && averageBotSurvival < thresholds.lowSurvivalSeconds) {
        addFinding(findings, {
            id: 'survival-low',
            score: 1 - averageBotSurvival / thresholds.lowSurvivalSeconds,
            title: 'Bot-Ueberlebenszeit ist niedrig',
            evidence: `avgSurvival=${roundMetric(averageBotSurvival, 2)}s`,
            recommendation: 'Survival-Prioritaet erhoehen: frueher Recovery starten, Boost unter Druck begrenzen und Zielverfolgung bei Risiko drosseln.',
            tuningTargets: ['survivalBias', 'emergencyForwardRisk', 'boostRiskCeiling', 'pursuitSurvivalCeiling'],
        });
    }

    if (wallHitsPerRound > thresholds.highWallHitsPerRound) {
        addFinding(findings, {
            id: 'wall-hit-rate',
            score: Math.min(1, wallHitsPerRound / Math.max(0.01, thresholds.highWallHitsPerRound) - 1),
            title: 'Zu viele Wandkontakte',
            evidence: `wallHitsPerRound=${roundMetric(wallHitsPerRound, 2)}`,
            recommendation: 'Lookahead/Probe-Sampling erhoehen und Turn-Commit in engen Raeumen kuerzer machen.',
            tuningTargets: ['lookAhead', 'probeStep', 'turnCommitTime', 'collisionPressureRecoveryThreshold'],
        });
    }

    if (trailHitsPerRound > thresholds.highTrailHitsPerRound) {
        addFinding(findings, {
            id: 'trail-hit-rate',
            score: Math.min(1, trailHitsPerRound / Math.max(0.01, thresholds.highTrailHitsPerRound) - 1),
            title: 'Zu viele Trailkontakte',
            evidence: `trailHitsPerRound=${roundMetric(trailHitsPerRound, 2)}`,
            recommendation: 'Trail-Risiko staerker gewichten und Recovery-Maneuver nach Bounce-Ketten frueher wechseln.',
            tuningTargets: ['trailRiskBase', 'emergencyBouncePressure', 'recoveryCooldown', 'recoveryDuration'],
        });
    }

    if (stuckPerMinute > thresholds.highStuckPerMinute) {
        addFinding(findings, {
            id: 'stuck-rate',
            score: Math.min(1, stuckPerMinute / Math.max(0.01, thresholds.highStuckPerMinute) - 1),
            title: 'Stuck-/Recovery-Rate ist hoch',
            evidence: `stuckPerMinute=${roundMetric(stuckPerMinute, 2)}`,
            recommendation: 'Stuck-Trigger frueher aktivieren und Recovery-Seitenwechsel bei wiederholtem Druck schneller erlauben.',
            tuningTargets: ['stuckTriggerTime', 'minForwardProgress', 'recoveryCooldown', 'recoveryDuration'],
        });
    }

    if (roundCount > 0 && botWinRate < thresholds.lowBotWinRate) {
        addFinding(findings, {
            id: 'bot-winrate-low',
            score: 1 - botWinRate / Math.max(0.01, thresholds.lowBotWinRate),
            title: 'Bot-Winrate ist niedrig',
            evidence: `botWinRate=${roundMetric(botWinRate, 3)}`,
            recommendation: 'Nach Survival-Fixes Offensivfenster pruefen: Zielausrichtung, Item-Nutzung und Treffer pro Runde vergleichen.',
            tuningTargets: ['pursuitAimTolerance', 'itemContextWeight', 'aggression'],
        });
    }

    return {
        contractVersion: 'bot-play-analysis.runtime.v1',
        generatedAt: new Date().toISOString(),
        source: {
            type: 'round-recorder',
            roundsAnalyzed: roundCount,
        },
        thresholds,
        metrics: {
            rounds: roundCount,
            botWinRate: roundMetric(botWinRate),
            averageBotSurvival: roundMetric(averageBotSurvival),
            wallHitsPerRound: roundMetric(wallHitsPerRound),
            trailHitsPerRound: roundMetric(trailHitsPerRound),
            stuckPerMinute: roundMetric(stuckPerMinute),
            totalDuration: roundMetric(totalDuration),
        },
        findings,
    };
}

export class BotPlayAnalysisService {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.roundInterval = toPositiveInt(options.roundInterval, 3);
        this.minRounds = toPositiveInt(options.minRounds, 2);
        this.thresholds = createThresholds(options.thresholds);
        this.logger = options.logger || console;
        this.onReport = typeof options.onReport === 'function' ? options.onReport : null;
        this.lastReport = null;
        this._roundsSinceReport = 0;
    }

    configure(options = {}) {
        const source = options && typeof options === 'object' ? options : {};
        if (typeof source.enabled === 'boolean') this.enabled = source.enabled;
        if (source.roundInterval != null) this.roundInterval = toPositiveInt(source.roundInterval, this.roundInterval);
        if (source.minRounds != null) this.minRounds = toPositiveInt(source.minRounds, this.minRounds);
        if (source.thresholds && typeof source.thresholds === 'object') {
            this.thresholds = createThresholds({ ...this.thresholds, ...source.thresholds });
        }
        return this.getStatus();
    }

    handleRoundFinalized(recorder, roundSummary = null) {
        if (!this.enabled || !recorder?.getRoundSummaries) return null;
        if (roundSummary && toNumber(roundSummary.botCount, 0) <= 0) return null;
        const rounds = recorder.getRoundSummaries();
        const botRounds = rounds.filter((round) => toNumber(round?.botCount, 0) > 0);
        if (botRounds.length < this.minRounds) return null;
        this._roundsSinceReport += 1;
        if (this._roundsSinceReport < this.roundInterval) return null;
        this._roundsSinceReport = 0;
        return this.runAnalysis(botRounds);
    }

    runAnalysis(rounds = []) {
        const report = buildBotPlayAnalysisReport(rounds, { thresholds: this.thresholds });
        this.lastReport = report;
        this.logger?.info?.('[BotPlayAnalysis] report', report);
        this.onReport?.(report);
        return report;
    }

    getStatus() {
        return {
            enabled: this.enabled,
            roundInterval: this.roundInterval,
            minRounds: this.minRounds,
            thresholds: { ...this.thresholds },
            hasReport: !!this.lastReport,
            lastReport: this.lastReport,
        };
    }
}
