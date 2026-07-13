import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const CLI_ARGS = parseArgMap(process.argv.slice(2));
const DEFAULT_SOURCE_REPORT = 'tmp/bot-play-analysis-source.json';
const DEFAULT_SOURCE_MARKDOWN = 'tmp/bot-play-analysis-source.md';
const DEFAULT_JSON_REPORT = 'tmp/bot-play-analysis-report.json';
const DEFAULT_MARKDOWN_REPORT = 'tmp/bot-play-analysis-report.md';
const PUBLISHED_JSON_REPORT = 'data/bot_play_analysis_report.json';
const PUBLISHED_MARKDOWN_REPORT = `docs/tests/Bot_Play_Analysis_${new Date().toISOString().slice(0, 10)}.md`;

function parseArgMap(argv) {
    const result = new Map();
    for (let i = 0; i < argv.length; i += 1) {
        const token = String(argv[i] || '');
        if (!token.startsWith('--')) continue;
        const raw = token.slice(2);
        const eqIndex = raw.indexOf('=');
        if (eqIndex >= 0) {
            const key = raw.slice(0, eqIndex).trim();
            const value = raw.slice(eqIndex + 1).trim();
            if (key) result.set(key, value);
            continue;
        }
        const key = raw.trim();
        if (!key) continue;
        const next = argv[i + 1];
        if (typeof next === 'string' && !next.startsWith('--')) {
            result.set(key, next.trim());
            i += 1;
        } else {
            result.set(key, 'true');
        }
    }
    return result;
}

function readOption(keys, fallback = '') {
    for (const key of keys) {
        const value = CLI_ARGS.get(key);
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return fallback;
}

function readIntOption(keys, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const raw = readOption(keys, '');
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function readBoolOption(keys, fallback = false) {
    const raw = readOption(keys, '');
    if (!raw) return fallback;
    const normalized = raw.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function toNumber(value, fallback = 0) {
    if (typeof value === 'string' && value.trim() === '') return fallback;
    if (value == null) return fallback;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundMetric(value, digits = 3) {
    const factor = 10 ** digits;
    return Math.round(toNumber(value, 0) * factor) / factor;
}

function formatPercent(value) {
    return `${(toNumber(value, 0) * 100).toFixed(1)}%`;
}

function formatNumber(value) {
    return toNumber(value, 0).toFixed(2);
}

function resolveReportPaths() {
    const publish = readBoolOption(['publish'], false);
    return {
        publish,
        sourceJson: readOption(['source-json'], DEFAULT_SOURCE_REPORT),
        sourceMarkdown: readOption(['source-md', 'source-markdown'], DEFAULT_SOURCE_MARKDOWN),
        json: readOption(['report-json'], publish ? PUBLISHED_JSON_REPORT : DEFAULT_JSON_REPORT),
        markdown: readOption(['report-md', 'report-markdown'], publish ? PUBLISHED_MARKDOWN_REPORT : DEFAULT_MARKDOWN_REPORT),
    };
}

function createThresholds() {
    return {
        lowSurvivalSeconds: toNumber(readOption(['low-survival-seconds'], ''), 7),
        highWallHitsPerRound: toNumber(readOption(['high-wall-hits-per-round'], ''), 0.55),
        highTrailHitsPerRound: toNumber(readOption(['high-trail-hits-per-round'], ''), 0.35),
        highStuckPerMinute: toNumber(readOption(['high-stuck-per-minute'], ''), 1.1),
        lowBotWinRate: toNumber(readOption(['low-bot-win-rate'], ''), 0.35),
        highForcedRoundRate: toNumber(readOption(['high-forced-round-rate'], ''), 0.2),
    };
}

async function ensureParentDir(filePath) {
    await mkdir(path.dirname(filePath), { recursive: true });
}

async function writeJson(filePath, payload) {
    await ensureParentDir(filePath);
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, content) {
    await ensureParentDir(filePath);
    await writeFile(filePath, content, 'utf8');
}

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: process.cwd(),
            stdio: 'inherit',
            shell: false,
            windowsHide: true,
            ...options,
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`${command} ${args.join(' ')} exited with code=${code} signal=${signal || 'none'}`));
        });
    });
}

async function runBotValidation(paths) {
    if (readBoolOption(['skip-run'], false)) return;
    const scenarioCount = readIntOption(['scenario-count'], 3, 1, 32);
    const rounds = readIntOption(['rounds'], 3, 1, 20);
    const port = readIntOption(['port'], 4281, 1024, 65535);
    const headless = readBoolOption(['headless'], true);
    const forceTimeoutMs = readIntOption(['force-timeout'], 12000, 1000);
    const matchTimeoutMs = readIntOption(['match-timeout'], 50000, 5000);
    const totalTimeoutMs = readIntOption(['total-timeout'], Math.max(180000, scenarioCount * rounds * 70000), 60000);

    await runCommand(process.execPath, [
        'scripts/bot-validation-runner.mjs',
        '--scenario-count',
        String(scenarioCount),
        '--rounds',
        String(rounds),
        '--headless',
        String(headless),
        '--port',
        String(port),
        '--force-timeout',
        String(forceTimeoutMs),
        '--match-timeout',
        String(matchTimeoutMs),
        '--total-timeout',
        String(totalTimeoutMs),
        '--report-json',
        paths.sourceJson,
        '--report-md',
        paths.sourceMarkdown,
        '--publish-evidence',
        'false',
    ]);
}

async function readSourceReport(filePath) {
    const raw = await readFile(filePath, 'utf8');
    const report = JSON.parse(raw);
    if (!Array.isArray(report?.scenarios)) {
        throw new Error(`Bot validation report has no scenarios: ${filePath}`);
    }
    return report;
}

function getPerRound(metrics, key) {
    const rounds = Math.max(1, toNumber(metrics?.rounds, 0));
    return toNumber(metrics?.[key], 0) / rounds;
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
        tuningTargets: finding.tuningTargets || [],
    });
}

function analyzeScenario(result, thresholds) {
    const scenario = result?.scenario || {};
    const metrics = result?.metrics || {};
    const runner = result?.runner || {};
    const findings = [];
    const rounds = Math.max(0, toNumber(metrics.rounds, 0));
    const wallHitsPerRound = getPerRound(metrics, 'wallHits');
    const trailHitsPerRound = getPerRound(metrics, 'trailHits');
    const forcedRate = rounds > 0 ? toNumber(runner.forcedRounds, 0) / rounds : 0;
    const averageBotSurvival = toNumber(metrics.averageBotSurvival, 0);
    const stuckPerMinute = toNumber(metrics.stuckPerMinute, 0);
    const botWinRate = toNumber(metrics.botWinRate, 0);

    if (averageBotSurvival > 0 && averageBotSurvival < thresholds.lowSurvivalSeconds) {
        addFinding(findings, {
            id: 'survival-low',
            score: 1 - averageBotSurvival / thresholds.lowSurvivalSeconds,
            title: 'Bot-Ueberlebenszeit ist niedrig',
            evidence: `avgSurvival=${formatNumber(averageBotSurvival)}s unter Ziel ${formatNumber(thresholds.lowSurvivalSeconds)}s`,
            recommendation: 'Survival-Prioritaet erhoehen: frueher Recovery starten, Boost in Drucksituationen weiter begrenzen und Zielverfolgung bei Risiko staerker drosseln.',
            tuningTargets: ['BOT.*.survivalBias', 'emergencyForwardRisk', 'boostRiskCeiling', 'pursuitSurvivalCeiling'],
        });
    }

    if (wallHitsPerRound > thresholds.highWallHitsPerRound) {
        addFinding(findings, {
            id: 'wall-hit-rate',
            score: Math.min(1, wallHitsPerRound / Math.max(0.01, thresholds.highWallHitsPerRound) - 1),
            title: 'Zu viele Wandkontakte',
            evidence: `wallHitsPerRound=${formatNumber(wallHitsPerRound)} ueber Ziel ${formatNumber(thresholds.highWallHitsPerRound)}`,
            recommendation: 'Lookahead/Probe-Sampling fuer diese Map erhoehen und Turn-Commit in engen Raeumen kuerzer machen.',
            tuningTargets: ['lookAhead', 'probeStep', 'turnCommitTime', 'collisionPressureRecoveryThreshold'],
        });
    }

    if (trailHitsPerRound > thresholds.highTrailHitsPerRound) {
        addFinding(findings, {
            id: 'trail-hit-rate',
            score: Math.min(1, trailHitsPerRound / Math.max(0.01, thresholds.highTrailHitsPerRound) - 1),
            title: 'Zu viele Trailkontakte',
            evidence: `trailHitsPerRound=${formatNumber(trailHitsPerRound)} ueber Ziel ${formatNumber(thresholds.highTrailHitsPerRound)}`,
            recommendation: 'Trail-Risiko staerker gewichten und Recovery-Maneuver nach Bounce-Ketten aggressiver umschalten.',
            tuningTargets: ['trailRiskBase', 'emergencyBouncePressure', 'recoveryCooldown', 'recoveryDuration'],
        });
    }

    if (stuckPerMinute > thresholds.highStuckPerMinute) {
        addFinding(findings, {
            id: 'stuck-rate',
            score: Math.min(1, stuckPerMinute / Math.max(0.01, thresholds.highStuckPerMinute) - 1),
            title: 'Stuck-/Recovery-Rate ist hoch',
            evidence: `stuckPerMinute=${formatNumber(stuckPerMinute)} ueber Ziel ${formatNumber(thresholds.highStuckPerMinute)}`,
            recommendation: 'Stuck-Trigger frueher aktivieren und Recovery-Seitenwechsel bei wiederholtem Druck schneller erlauben.',
            tuningTargets: ['stuckTriggerTime', 'minForwardProgress', 'recoveryCooldown', 'recoveryDuration'],
        });
    }

    if (rounds > 0 && botWinRate < thresholds.lowBotWinRate) {
        addFinding(findings, {
            id: 'bot-winrate-low',
            score: 1 - botWinRate / Math.max(0.01, thresholds.lowBotWinRate),
            title: 'Bot-Winrate ist niedrig',
            evidence: `botWinRate=${formatPercent(botWinRate)} unter Ziel ${formatPercent(thresholds.lowBotWinRate)}`,
            recommendation: 'Nach Survival-Fixes Offensivfenster pruefen: Zielausrichtung, Item-Nutzung und MG-/Rocket-Treffer pro Runde gegen die Szenarien vergleichen.',
            tuningTargets: ['pursuitAimTolerance', 'itemContextWeight', 'aggression'],
        });
    }

    if (forcedRate > thresholds.highForcedRoundRate) {
        addFinding(findings, {
            id: 'forced-round-rate',
            score: Math.min(1, forcedRate / Math.max(0.01, thresholds.highForcedRoundRate) - 1),
            title: 'Viele Runden mussten erzwungen beendet werden',
            evidence: `forcedRoundRate=${formatPercent(forcedRate)} ueber Ziel ${formatPercent(thresholds.highForcedRoundRate)}`,
            recommendation: 'Match-Ende und Bot-Engagement pruefen: Falls die Bots nicht sterben, fehlt eventuell Aggression; falls sie festhaengen, Recovery/Map-Clearance zuerst fixen.',
            tuningTargets: ['pursuitEnabled', 'targetRefreshInterval', 'recoveryCooldown'],
        });
    }

    return {
        scenario,
        metrics: {
            rounds,
            botWinRate: roundMetric(botWinRate),
            averageBotSurvival: roundMetric(averageBotSurvival),
            wallHitsPerRound: roundMetric(wallHitsPerRound),
            trailHitsPerRound: roundMetric(trailHitsPerRound),
            stuckPerMinute: roundMetric(stuckPerMinute),
            forcedRate: roundMetric(forcedRate),
        },
        findings,
    };
}

function buildOverallRecommendations(scenarios) {
    const counts = new Map();
    for (const scenario of scenarios) {
        for (const finding of scenario.findings) {
            counts.set(finding.id, (counts.get(finding.id) || 0) + 1);
        }
    }
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([id, count]) => ({ id, affectedScenarios: count }));
}

function buildAnalysisReport(sourceReport, paths) {
    const thresholds = createThresholds();
    const scenarios = sourceReport.scenarios.map((scenarioResult) => analyzeScenario(scenarioResult, thresholds));
    const findingCount = scenarios.reduce((sum, scenario) => sum + scenario.findings.length, 0);
    const highSeverityCount = scenarios.reduce(
        (sum, scenario) => sum + scenario.findings.filter((finding) => finding.severity === 'high').length,
        0
    );
    return {
        contractVersion: 'bot-play-analysis.v1',
        generatedAt: new Date().toISOString(),
        source: {
            reportJson: paths.sourceJson,
            generatedAt: sourceReport.generatedAt || null,
            roundsPerScenario: sourceReport.roundsPerScenario || null,
            overall: sourceReport.overall || null,
            runner: sourceReport.runner || null,
        },
        thresholds,
        summary: {
            scenarioCount: scenarios.length,
            findingCount,
            highSeverityCount,
            topRecommendationGroups: buildOverallRecommendations(scenarios),
        },
        scenarios,
    };
}

function buildMarkdownReport(report) {
    const lines = [];
    lines.push(`# Bot-Spielanalyse (${report.generatedAt})`);
    lines.push('');
    lines.push(`- Quelle: \`${report.source.reportJson}\``);
    lines.push(`- Szenarien: ${report.summary.scenarioCount}`);
    lines.push(`- Findings: ${report.summary.findingCount} (high=${report.summary.highSeverityCount})`);
    lines.push('');
    lines.push('## Prioritaeten');
    lines.push('');
    if (report.summary.topRecommendationGroups.length === 0) {
        lines.push('- Keine auffaelligen Muster ueber den konfigurierten Schwellen.');
    } else {
        for (const group of report.summary.topRecommendationGroups) {
            lines.push(`- ${group.id}: ${group.affectedScenarios} Szenario(s) betroffen`);
        }
    }
    lines.push('');
    lines.push('## Szenarien');
    lines.push('');
    lines.push('| Szenario | Runden | Winrate | Survival | Wand/Runde | Trail/Runde | Stuck/Min | Findings |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const scenario of report.scenarios) {
        const m = scenario.metrics;
        lines.push(`| ${scenario.scenario.id || '-'} (${scenario.scenario.mapKey || '-'}) | ${m.rounds} | ${formatPercent(m.botWinRate)} | ${formatNumber(m.averageBotSurvival)}s | ${formatNumber(m.wallHitsPerRound)} | ${formatNumber(m.trailHitsPerRound)} | ${formatNumber(m.stuckPerMinute)} | ${scenario.findings.length} |`);
    }
    lines.push('');
    for (const scenario of report.scenarios) {
        if (scenario.findings.length === 0) continue;
        lines.push(`## ${scenario.scenario.id || 'Szenario'} Findings`);
        lines.push('');
        for (const finding of scenario.findings) {
            lines.push(`- [${finding.severity}] ${finding.title}: ${finding.evidence}`);
            lines.push(`  Empfehlung: ${finding.recommendation}`);
            if (finding.tuningTargets.length > 0) {
                lines.push(`  Tuning-Ziele: ${finding.tuningTargets.join(', ')}`);
            }
        }
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}

async function main() {
    const paths = resolveReportPaths();
    await runBotValidation(paths);
    const sourceReport = await readSourceReport(paths.sourceJson);
    const report = buildAnalysisReport(sourceReport, paths);
    await writeJson(paths.json, report);
    await writeText(paths.markdown, buildMarkdownReport(report));
    console.log('\nBOT_PLAY_ANALYSIS_RESULT');
    console.log(JSON.stringify({
        reportJson: paths.json,
        reportMarkdown: paths.markdown,
        scenarioCount: report.summary.scenarioCount,
        findingCount: report.summary.findingCount,
        highSeverityCount: report.summary.highSeverityCount,
    }, null, 2));
}

main().catch((error) => {
    console.error('[bot-play-analysis] failed:', error?.stack || error?.message || String(error));
    process.exit(1);
});
