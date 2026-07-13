import { spawn, execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SOURCE_REPORT_PATH = process.env.BOT_BASELINE_SOURCE_REPORT || 'data/bot_validation_report.json';
const OUTPUT_REPORT_PATH = process.env.BOT_BASELINE_OUTPUT_REPORT || 'data/performance_ki_baseline_report.json';
const HOST = '127.0.0.1';
const PORT = parseIntEnv('BOT_BASELINE_PORT', 4274, 1024);
const BASE_URL = `http://${HOST}:${PORT}`;

const APP_READY_TIMEOUT_MS = parseIntEnv('BOT_BASELINE_APP_READY_TIMEOUT', 25000, 5000);
const PLAYING_TIMEOUT_MS = parseIntEnv('BOT_BASELINE_PLAYING_TIMEOUT', 10000, 1000);
const MENU_TIMEOUT_MS = parseIntEnv('BOT_BASELINE_MENU_TIMEOUT', 12000, 1000);
const SAMPLE_INTERVAL_MS = parseIntEnv('BOT_BASELINE_SAMPLE_INTERVAL_MS', 250, 50);
const SAMPLE_DURATION_MS = parseIntEnv('BOT_BASELINE_SAMPLE_DURATION_MS', 8000, 1000);
const SAMPLE_WARMUP_MS = parseIntEnv('BOT_BASELINE_SAMPLE_WARMUP_MS', 1000, 0);

function parseIntEnv(name, fallback, minValue = 1) {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minValue, parsed);
}

function log(message, payload) {
    const stamp = new Date().toISOString();
    if (typeof payload === 'undefined') {
        console.log(`[bot-baseline ${stamp}] ${message}`);
        return;
    }
    console.log(`[bot-baseline ${stamp}] ${message} ${JSON.stringify(payload)}`);
}

function toShortError(error) {
    if (!error) return 'unknown';
    if (typeof error === 'string') return error;
    return error.message || String(error);
}

function appendTail(previous, chunk, maxLen = 6000) {
    return (previous + chunk).slice(-maxLen);
}

function forceKillPort(port) {
    try {
        if (process.platform === 'win32') {
            execSync(
                `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
                { stdio: 'ignore' }
            );
            return;
        }
        execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
    } catch {
        // no-op
    }
}

function startViteServer() {
    const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
    const child = spawn(process.execPath, [viteBin, 'dev', '--host', HOST, '--port', String(PORT), '--strictPort'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
    });

    let stdoutTail = '';
    let stderrTail = '';
    child.stdout?.on('data', (chunk) => {
        stdoutTail = appendTail(stdoutTail, String(chunk));
    });
    child.stderr?.on('data', (chunk) => {
        stderrTail = appendTail(stderrTail, String(chunk));
    });

    return {
        child,
        getTails() {
            return { stdoutTail, stderrTail };
        },
    };
}

async function waitForServer(url, timeoutMs = 45000, serverHandle = null) {
    const start = Date.now();
    let lastError = null;
    while (Date.now() - start < timeoutMs) {
        if (serverHandle?.child?.exitCode !== null) {
            const tails = serverHandle.getTails ? serverHandle.getTails() : { stdoutTail: '', stderrTail: '' };
            throw new Error(
                `Dev server exited early (code=${serverHandle.child.exitCode})\n` +
                (tails.stdoutTail ? `stdout tail:\n${tails.stdoutTail}\n` : '') +
                (tails.stderrTail ? `stderr tail:\n${tails.stderrTail}` : '')
            );
        }
        try {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: AbortSignal.timeout(1500),
            });
            if (response.ok) return;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await delay(300);
    }
    throw new Error(`Server not reachable after ${timeoutMs}ms (${toShortError(lastError)})`);
}

async function stopServer(serverHandle) {
    const child = serverHandle?.child;
    if (!child || child.exitCode !== null) return;
    child.kill();
    await delay(250);
    if (child.exitCode === null) {
        try {
            if (process.platform === 'win32') {
                execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
            } else {
                execSync(`kill -9 ${child.pid}`, { stdio: 'ignore' });
            }
        } catch {
            // no-op
        }
    }
}

async function readSourceReport(path) {
    const content = await readFile(path, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.scenarios) || parsed.scenarios.length === 0) {
        throw new Error(`Invalid source report at ${path}: scenarios missing`);
    }
    return parsed;
}

function createPerfAccumulator() {
    return {
        sampleCount: 0,
        fpsSum: 0,
        drawCallsSum: 0,
        fpsMin: Infinity,
        fpsMax: 0,
        drawCallsMin: Infinity,
        drawCallsMax: 0,
    };
}

function addPerfSample(acc, sample) {
    const fps = Number(sample?.fps);
    const drawCalls = Number(sample?.drawCalls);
    if (!Number.isFinite(fps) || fps <= 0) return;
    if (!Number.isFinite(drawCalls) || drawCalls < 0) return;

    acc.sampleCount += 1;
    acc.fpsSum += fps;
    acc.drawCallsSum += drawCalls;
    acc.fpsMin = Math.min(acc.fpsMin, fps);
    acc.fpsMax = Math.max(acc.fpsMax, fps);
    acc.drawCallsMin = Math.min(acc.drawCallsMin, drawCalls);
    acc.drawCallsMax = Math.max(acc.drawCallsMax, drawCalls);
}

function mergePerfAcc(target, source) {
    if (!target || !source || source.sampleCount <= 0) return;
    target.sampleCount += source.sampleCount;
    target.fpsSum += source.fpsSum;
    target.drawCallsSum += source.drawCallsSum;
    target.fpsMin = Math.min(target.fpsMin, source.fpsMin);
    target.fpsMax = Math.max(target.fpsMax, source.fpsMax);
    target.drawCallsMin = Math.min(target.drawCallsMin, source.drawCallsMin);
    target.drawCallsMax = Math.max(target.drawCallsMax, source.drawCallsMax);
}

function toPerfMetrics(acc) {
    if (!acc || acc.sampleCount <= 0) {
        return { sampleCount: 0, fpsAverage: 0, drawCallsAverage: 0, fpsMin: 0, fpsMax: 0, drawCallsMin: 0, drawCallsMax: 0 };
    }
    return {
        sampleCount: acc.sampleCount,
        fpsAverage: acc.fpsSum / acc.sampleCount,
        drawCallsAverage: acc.drawCallsSum / acc.sampleCount,
        fpsMin: Number.isFinite(acc.fpsMin) ? acc.fpsMin : 0,
        fpsMax: Number.isFinite(acc.fpsMax) ? acc.fpsMax : 0,
        drawCallsMin: Number.isFinite(acc.drawCallsMin) ? acc.drawCallsMin : 0,
        drawCallsMax: Number.isFinite(acc.drawCallsMax) ? acc.drawCallsMax : 0,
    };
}

async function waitForGameReady(page) {
    await page.waitForFunction(() => !!window.GAME_INSTANCE, null, { timeout: APP_READY_TIMEOUT_MS });
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'MENU', null, { timeout: APP_READY_TIMEOUT_MS });
}

async function ensureMenuState(page) {
    await page.evaluate(() => {
        const g = window.GAME_INSTANCE;
        if (!g) throw new Error('GAME_INSTANCE missing');
        if (g.state !== 'MENU' && typeof g._returnToMenu === 'function') {
            g._returnToMenu();
        }
        return g.state;
    });
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'MENU', null, { timeout: MENU_TIMEOUT_MS });
}

async function sampleScenarioPerformance(page, scenarioId) {
    await page.evaluate((id) => {
        const g = window.GAME_INSTANCE;
        if (!g) throw new Error('GAME_INSTANCE missing');
        const debugApi = g.debugApi || window.GAME_DEBUG || null;
        const applyScenario = typeof g.applyBotValidationScenario === 'function'
            ? g.applyBotValidationScenario.bind(g)
            : (typeof debugApi?.applyBotValidationScenario === 'function'
                ? debugApi.applyBotValidationScenario.bind(debugApi)
                : null);
        if (typeof applyScenario !== 'function') throw new Error('applyBotValidationScenario missing');
        const applied = applyScenario(id);
        if (!applied) throw new Error(`Scenario not found: ${id}`);
        g.winsNeeded = 1;
        if (g.settings) g.settings.winsNeeded = 1;
        if (typeof g._onSettingsChanged === 'function') g._onSettingsChanged();
        return applied.id;
    }, scenarioId);

    await ensureMenuState(page);

    await page.evaluate(() => {
        const g = window.GAME_INSTANCE;
        if (!g) throw new Error('GAME_INSTANCE missing');
        if (typeof g.startMatch !== 'function') throw new Error('startMatch missing');
        g.startMatch();
        return g.state;
    });

    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: PLAYING_TIMEOUT_MS });

    if (SAMPLE_WARMUP_MS > 0) {
        await delay(SAMPLE_WARMUP_MS);
    }

    const perf = createPerfAccumulator();
    const startedAt = Date.now();
    const endAt = startedAt + SAMPLE_DURATION_MS;

    while (Date.now() < endAt) {
        const snapshot = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return {
                state: g?.state || null,
                fps: Number(g?._fpsTracker?.avg ?? 0),
                drawCalls: Number(g?.renderer?.renderer?.info?.render?.calls ?? 0),
            };
        });

        if (snapshot.state === 'PLAYING') {
            addPerfSample(perf, snapshot);
        } else if (snapshot.state === 'ROUND_END' || snapshot.state === 'MATCH_END' || snapshot.state === 'MENU') {
            break;
        }

        await delay(SAMPLE_INTERVAL_MS);
    }

    await ensureMenuState(page);

    const metrics = toPerfMetrics(perf);
    return {
        ...metrics,
        observedDurationMs: Date.now() - startedAt,
    };
}

function formatFloat(value) {
    return Number(value || 0).toFixed(2);
}

function formatPercent(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatSeconds(value) {
    return `${Number(value || 0).toFixed(2)}s`;
}

function buildMarkdownReport(report) {
    const lines = [];
    lines.push(`# Testergebnisse vom ${report.generatedAt}`);
    lines.push('');
    lines.push('## Phase 6 - Baseline Performance + KI-Stabilitaet');
    lines.push('');
    lines.push('### Baseline-Setup');
    lines.push('');
    lines.push(`- Kommando: \`npm run benchmark:baseline\``);
    lines.push(`- Matrix: ${report.baseline.matrix.length} Szenarien aus \`${report.baseline.sourceReportPath}\``);
    lines.push(`- Runden pro Szenario (Bot-Stabilitaet): ${report.baseline.roundsPerScenario}`);
    lines.push(`- FPS/Draw Sampling je Szenario: ${report.baseline.sampleDurationMs} ms (Intervall ${report.baseline.sampleIntervalMs} ms)`);
    lines.push(`- Seed-Modus: ${report.baseline.seedMode}`);
    lines.push(`- Repro-Hinweis: ${report.baseline.seedNote}`);
    lines.push('');
    lines.push('### Baseline-Matrix');
    lines.push('');
    lines.push('| ID | Mode | Map | Bots | Planar | Portale | Runden |');
    lines.push('|---|---|---|---:|:---:|---:|---:|');
    for (const s of report.baseline.matrix) {
        lines.push(`| ${s.id} | ${s.mode} | ${s.mapKey} | ${s.bots} | ${s.planarMode ? 'ja' : 'nein'} | ${s.portalCount} | ${report.baseline.roundsPerScenario} |`);
    }
    lines.push('');
    lines.push('### Kennzahlen (Gesamt)');
    lines.push('');
    lines.push(`- FPS-Mittel: ${formatFloat(report.overall.fpsAverage)}`);
    lines.push(`- Draw Calls (Mittel): ${formatFloat(report.overall.drawCallsAverage)}`);
    lines.push(`- Bot-Winrate: ${formatPercent(report.overall.botWinRate)}`);
    lines.push(`- Stuck-Events: ${report.overall.stuckEvents}`);
    lines.push(`- Runden erfasst: ${report.overall.rounds}`);
    lines.push(`- Performance-Samples: ${report.overall.performanceSamples}`);
    lines.push('');
    lines.push('### Kennzahlen je Szenario');
    lines.push('');
    lines.push('| Szenario | Runden | FPS-Mittel | Draw Calls (Mittel) | Bot-Winrate | Stuck | Avg Survival |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const row of report.scenarios) {
        lines.push(`| ${row.scenario.id} (${row.scenario.mapKey}) | ${row.metrics.rounds} | ${formatFloat(row.metrics.fpsAverage)} | ${formatFloat(row.metrics.drawCallsAverage)} | ${formatPercent(row.metrics.botWinRate)} | ${row.metrics.stuckEvents} | ${formatSeconds(row.metrics.averageBotSurvival)} |`);
    }
    lines.push('');
    lines.push('### Kurzbewertung');
    lines.push('');
    lines.push('- Bot-Winrate/Stuck basieren auf dem reproduzierbaren Bot-Validierungslauf; FPS/DrawCalls wurden je Szenario separat unter gleichen Matrix-Parametern erfasst.');
    lines.push(`- JSON-Report: \`${report.paths.json}\``);
    lines.push('');
    return lines.join('\n');
}

async function run() {
    let serverHandle = null;
    let browser = null;
    let context = null;

    try {
        const source = await readSourceReport(SOURCE_REPORT_PATH);
        const matrix = source.scenarios.map((entry) => entry.scenario).filter(Boolean);
        if (matrix.length === 0) {
            throw new Error('Source report has no scenario matrix');
        }

        forceKillPort(PORT);
        serverHandle = startViteServer();
        await waitForServer(BASE_URL, 45000, serverHandle);

        browser = await chromium.launch({ headless: true });
        context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: APP_READY_TIMEOUT_MS });
        await waitForGameReady(page);

        const scenarioResults = [];
        const overallPerf = createPerfAccumulator();

        for (const sourceScenario of source.scenarios) {
            const scenario = sourceScenario.scenario;
            log('Sampling scenario', { id: scenario.id, mapKey: scenario.mapKey, bots: scenario.bots });
            const perf = await sampleScenarioPerformance(page, scenario.id);

            const metrics = {
                rounds: Number(sourceScenario.metrics?.rounds || 0),
                botWinRate: Number(sourceScenario.metrics?.botWinRate || 0),
                stuckEvents: Number(sourceScenario.metrics?.stuckEvents || 0),
                averageBotSurvival: Number(sourceScenario.metrics?.averageBotSurvival || 0),
                fpsAverage: perf.fpsAverage,
                drawCallsAverage: perf.drawCallsAverage,
                performanceSamples: perf.sampleCount,
            };

            scenarioResults.push({
                scenario,
                metrics,
                performance: perf,
                sourceRunner: sourceScenario.runner || null,
            });

            mergePerfAcc(overallPerf, {
                sampleCount: perf.sampleCount,
                fpsSum: perf.fpsAverage * perf.sampleCount,
                drawCallsSum: perf.drawCallsAverage * perf.sampleCount,
                fpsMin: perf.fpsMin,
                fpsMax: perf.fpsMax,
                drawCallsMin: perf.drawCallsMin,
                drawCallsMax: perf.drawCallsMax,
            });
        }

        const overallPerfMetrics = toPerfMetrics(overallPerf);
        const generatedAt = new Date().toISOString().slice(0, 10);
        const docPath = `docs/tests/Testergebnisse_${generatedAt}.md`;

        const report = {
            generatedAt,
            baseline: {
                sourceReportPath: SOURCE_REPORT_PATH,
                sourceGeneratedAt: source.generatedAt || null,
                roundsPerScenario: Number(source.roundsPerScenario || 0),
                matrix,
                sampleDurationMs: SAMPLE_DURATION_MS,
                sampleIntervalMs: SAMPLE_INTERVAL_MS,
                sampleWarmupMs: SAMPLE_WARMUP_MS,
                seedMode: 'none',
                seedNote: 'No explicit RNG seed hook available; reproducibility is driven by fixed matrix and runner parameters.',
            },
            scenarios: scenarioResults,
            overall: {
                rounds: Number(source.overall?.rounds || 0),
                botWinRate: Number(source.overall?.botWinRate || 0),
                stuckEvents: Number(source.overall?.stuckEvents || 0),
                averageBotSurvival: Number(source.overall?.averageBotSurvival || 0),
                fpsAverage: overallPerfMetrics.fpsAverage,
                drawCallsAverage: overallPerfMetrics.drawCallsAverage,
                performanceSamples: overallPerfMetrics.sampleCount,
            },
            sourceRunner: source.runner || null,
            paths: {
                json: OUTPUT_REPORT_PATH,
                sourceJson: SOURCE_REPORT_PATH,
                doc: docPath,
            },
        };

        await writeFile(OUTPUT_REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
        await writeFile(docPath, buildMarkdownReport(report), 'utf8');

        console.log('\nBOT_BASELINE_RESULT');
        console.log(JSON.stringify(report, null, 2));
        console.log(`\nWrote: ${OUTPUT_REPORT_PATH}`);
        console.log(`Wrote: ${docPath}`);
    } finally {
        try {
            await context?.close();
        } catch {
            // no-op
        }
        try {
            await browser?.close();
        } catch {
            // no-op
        }
        await stopServer(serverHandle);
        forceKillPort(PORT);
    }
}

run().catch((error) => {
    console.error('[bot-baseline] failed:', error?.stack || toShortError(error));
    process.exit(1);
});

