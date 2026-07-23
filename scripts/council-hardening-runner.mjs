import { spawn as spawnProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const FIXTURE_NAMES = Object.freeze([
    'errors-v2-easy.mjs',
    'errors-v2-medium.mjs',
    'errors-v2-hard.mjs',
]);
export const RESEARCH_SCOPES = Object.freeze(['review', 'arch', 'test', 'perf']);
export const AGENT_SUFFIXES = Object.freeze(['', '-fb', '-fb2', '-fb3', '-fb4']);

const RESEARCH_VERDICTS = new Set(['CLEAN', 'ISSUES_FOUND', 'NEEDS_DATA', 'UNCERTAIN']);
const VERIFY_CLASSIFICATIONS = new Set(['BUG', 'DEFENSIVE', 'INTENTIONAL', 'FALSE', 'UNCERTAIN']);
const VERIFY_VERDICTS = new Set(['VERIFIED', 'REJECTED', 'UNCERTAIN']);
const RUNTIME_FAILURE = /fallback warning|default agent|streaming response failed/i;
const COUNCIL_AGENT_NAME = /^(?:council-(?:review|arch|sec|perf|test|refactor)(?:-fb[2-4]?)?|council-(?:lead|verify))$/;

export function resolveOpenCodeExecutable({ platform = process.platform, env = process.env } = {}) {
    if (platform !== 'win32') return 'opencode';
    for (const directory of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
        if (!existsSync(path.join(directory, 'opencode.cmd'))) continue;
        const executable = path.join(directory, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
        if (existsSync(executable)) return executable;
    }
    return 'opencode.exe';
}

function extractTextEvents(jsonLines) {
    const texts = [];
    for (const line of String(jsonLines).split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            const event = JSON.parse(line);
            const text = event?.part?.type === 'text' ? event.part.text : event?.type === 'text' ? event.text : '';
            if (typeof text === 'string' && text.trim()) texts.push(text);
        } catch {
            // Non-JSON diagnostic lines are ignored; stderr carries runtime diagnostics.
        }
    }
    return texts;
}

export function extractFinalText(jsonLines, allowedVerdicts = RESEARCH_VERDICTS) {
    let lastText = '';
    let verdictReport = '';
    for (const text of extractTextEvents(jsonLines)) {
        lastText = text;
        const firstLine = text.split(/\r?\n/, 1)[0]?.trim() || '';
        if (firstLine.startsWith('VERDICT: ') && allowedVerdicts.has(firstLine.slice('VERDICT: '.length))) {
            verdictReport = text;
        }
    }
    return verdictReport || lastText;
}

export function validateResearchReport({ stdout, stderr = '', exitCode = 0, timedOut = false }) {
    const texts = extractTextEvents(stdout);
    const report = extractFinalText(stdout);
    const firstLine = report.split(/\r?\n/, 1)[0]?.trim() || '';
    const verdict = firstLine.startsWith('VERDICT: ') ? firstLine.slice('VERDICT: '.length) : '';
    const reasons = [];
    if (timedOut) reasons.push('timeout');
    if (exitCode !== 0) reasons.push(`exit:${exitCode}`);
    if (RUNTIME_FAILURE.test(stderr)) reasons.push('runtime-fallback');
    if (!RESEARCH_VERDICTS.has(verdict)) {
        const allText = texts.join('\n');
        if (/```[^\n]*\n\s*VERDICT:/i.test(allText)) reasons.push('verdict-inside-code-fence');
        else if (/^VERDICT:\s*(CLEAN|ISSUES_FOUND|NEEDS_DATA|UNCERTAIN)\s*$/im.test(allText)) reasons.push('verdict-not-first-line');
        else reasons.push('no-verdict-event');
    }
    const selectedIndex = texts.lastIndexOf(report);
    const warnings = RESEARCH_VERDICTS.has(verdict) && selectedIndex >= 0 && selectedIndex < texts.length - 1
        ? ['post-report-summary']
        : [];
    return { valid: reasons.length === 0, verdict, report, reasons, warnings };
}

export function validateSpecialistReport(result) {
    const validation = validateResearchReport(result);
    if (!validation.valid) return validation;
    try {
        extractResearchManifest(validation.report);
        return validation;
    } catch (error) {
        return {
            ...validation,
            valid: false,
            reasons: [...validation.reasons, `invalid-research-manifest:${error.message}`],
        };
    }
}

export function validateLeadReport(result) {
    const validation = validateResearchReport(result);
    if (!validation.valid) return validation;
    try {
        extractCandidateManifest(validation.report);
        return validation;
    } catch (error) {
        return {
            ...validation,
            valid: false,
            reasons: [...validation.reasons, `invalid-candidate-manifest:${error.message}`],
        };
    }
}

export function validateVerifyReport({ stdout, stderr = '', exitCode = 0, timedOut = false }) {
    const report = extractFinalText(stdout, VERIFY_VERDICTS);
    const firstLine = report.split(/\r?\n/, 1)[0]?.trim() || '';
    const verdict = firstLine.startsWith('VERDICT: ') ? firstLine.slice('VERDICT: '.length) : '';
    const reasons = [];
    if (timedOut) reasons.push('timeout');
    if (exitCode !== 0) reasons.push(`exit:${exitCode}`);
    if (RUNTIME_FAILURE.test(stderr)) reasons.push('runtime-fallback');
    if (!VERIFY_VERDICTS.has(verdict)) reasons.push('invalid-verify-verdict');
    if (reasons.length === 0) {
        try {
            extractVerifyManifest(report);
        } catch (error) {
            reasons.push(`invalid-verify-manifest:${error.message}`);
        }
    }
    return { valid: reasons.length === 0, verdict, report, reasons };
}

export function extractCandidateManifest(report) {
    const blocks = [...String(report).matchAll(/```json\s*([\s\S]*?)```/gi)];
    for (const block of blocks.reverse()) {
        let parsed;
        try {
            parsed = JSON.parse(block[1]);
        } catch {
            continue;
        }
        if (!parsed || !Array.isArray(parsed.candidates)) continue;
        const candidates = parsed.candidates.map((candidate) => {
            if (!candidate || typeof candidate !== 'object') throw new TypeError('candidate must be an object');
            for (const field of ['id', 'file', 'symbol', 'claim', 'evidence', 'potentialImpact']) {
                if (typeof candidate[field] !== 'string' || !candidate[field].trim()) {
                    throw new TypeError(`candidate.${field} is required`);
                }
            }
            if (!['HIGH', 'MEDIUM'].includes(candidate.potentialImpact)) throw new TypeError('candidate.potentialImpact must be HIGH or MEDIUM');
            return candidate;
        });
        return { candidates };
    }
    throw new TypeError('lead report has no valid candidates JSON block');
}

export function extractResearchManifest(report) {
    const blocks = [...String(report).matchAll(/```json\s*([\s\S]*?)```/gi)];
    for (const block of blocks.reverse()) {
        let parsed;
        try {
            parsed = JSON.parse(block[1]);
        } catch {
            continue;
        }
        if (!parsed || !Array.isArray(parsed.findings)) continue;
        const findings = parsed.findings.map((finding) => {
            for (const field of ['file', 'symbol', 'category', 'claim', 'evidence', 'confidence', 'impact']) {
                if (typeof finding?.[field] !== 'string' || !finding[field].trim()) throw new TypeError(`finding.${field} is required`);
            }
            if (!/^[a-z0-9][a-z0-9-]*$/.test(finding.category)) throw new TypeError('finding.category must be kebab-case');
            if (!['HIGH', 'MEDIUM', 'LOW'].includes(finding.confidence)) throw new TypeError('finding.confidence is invalid');
            if (!['HIGH', 'MEDIUM', 'LOW'].includes(finding.impact)) throw new TypeError('finding.impact is invalid');
            return finding;
        });
        return { findings };
    }
    throw new TypeError('research report has no valid findings JSON block');
}

export function calculateScopeAgreement(scopeResult) {
    const validResults = scopeResult.results.filter((result) => result.validation.valid);
    const groups = new Map();
    for (const result of validResults) {
        let manifest;
        try {
            manifest = extractResearchManifest(result.validation.report);
        } catch {
            continue;
        }
        for (const finding of manifest.findings) {
            const key = [scopeResult.scope, finding.file.toLowerCase(), finding.symbol.toLowerCase(), finding.category].join(':');
            const group = groups.get(key) || { key, finding, agreeingModels: new Set() };
            group.agreeingModels.add(result.agent);
            groups.set(key, group);
        }
    }
    const validRuns = new Set(validResults.map((result) => result.agent)).size;
    return {
        scope: scopeResult.scope,
        validRuns,
        findings: [...groups.values()].map((group) => ({
            key: group.key,
            ...group.finding,
            agreeingModels: [...group.agreeingModels].sort(),
            agreementCount: group.agreeingModels.size,
            highConfidence: validRuns >= 4 && group.agreeingModels.size >= 4,
        })),
    };
}

export async function persistCandidateManifest(roundRoot, report) {
    const manifest = extractCandidateManifest(report);
    const file = path.join(roundRoot, 'candidates.json');
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { file, manifest };
}

export function buildVerifyPrompt({ manifestFile, fixtureRoot }) {
    return `Verifiziere adversarial alle Kandidaten aus ${manifestFile}. Lies zusaetzlich ausschliesslich die drei Fixture-Kopien unter ${fixtureRoot}. Lies keinen Lead-Bericht, keine Ground Truth, keine andere Runde und keinen anderen Verify-Bericht. Benchmark-Grenze: Die exportierten Fixture-APIs sind die zu pruefende Contract-Oberflaeche; direkte unabhaengige Aufrufe sind erreichbare Caller und ein reproduzierbar falscher Rueckgabewert, State, Seiteneffekt oder Lifecycle ist eine sichtbare Auswirkung. Verwirf einen Kandidaten daher nicht allein wegen fehlender Importe aus Produktverzeichnissen. Pruefe fuer jeden Kandidaten Datei, Caller, nachfolgende Verwendungen, Guards, Fehlerbehandlung, Lifecycle, Contracts, Tests und den vollstaendigen Contract-Pfad. Klassifiziere jeden Kandidaten als BUG|DEFENSIVE|INTENTIONAL|FALSE|UNCERTAIN. Erste finale Zeile exakt VERDICT: VERIFIED|REJECTED|UNCERTAIN. Halte jede Ergebniszeile knapp und gib abschliessend den vorgeschriebenen kompakten results-JSON-Block aus.`;
}

export function extractVerifyManifest(report) {
    const blocks = [...String(report).matchAll(/```json\s*([\s\S]*?)```/gi)];
    for (const block of blocks.reverse()) {
        let parsed;
        try {
            parsed = JSON.parse(block[1]);
        } catch {
            continue;
        }
        if (!parsed || !Array.isArray(parsed.results)) continue;
        const results = parsed.results.map((result) => {
            if (typeof result?.id !== 'string' || !result.id.trim()) throw new TypeError('verify result id is required');
            if (!VERIFY_CLASSIFICATIONS.has(result.classification)) throw new TypeError('verify classification is invalid');
            if (typeof result.productPath !== 'string' || !result.productPath.trim()) throw new TypeError('verify productPath is required');
            if (typeof result.counterEvidence !== 'string' || !result.counterEvidence.trim()) throw new TypeError('verify counterEvidence is required');
            return result;
        });
        return { results };
    }
    throw new TypeError('verify report has no valid results JSON block');
}

export async function createRoundFixtures({ repositoryRoot, runId, round }) {
    if (!Number.isInteger(round) || round < 1) throw new TypeError('round must be a positive integer');
    if (!/^[a-zA-Z0-9_-]+$/.test(String(runId))) throw new TypeError('runId must contain only letters, digits, underscores, or hyphens');
    const tempRoot = path.join(tmpdir(), 'opencode', 'council-hardening', String(runId));
    const roundRoot = path.join(tempRoot, `round-${round}`);
    const fixtureRoot = path.join(roundRoot, 'fixtures');
    const relative = path.relative(path.join(tmpdir(), 'opencode'), fixtureRoot);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture directory escaped OpenCode temp root');
    await mkdir(fixtureRoot, { recursive: true });
    await Promise.all(FIXTURE_NAMES.map((name) => copyFile(
        path.join(repositoryRoot, 'tests', 'council-test-loop', name),
        path.join(fixtureRoot, name),
    )));
    return { tempRoot, roundRoot, fixtureRoot };
}

export async function terminateProcessTree(child, platform = process.platform) {
    if (!child || child.exitCode !== null) return;
    if (platform === 'win32' && Number.isInteger(child.pid)) {
        await new Promise((resolve) => {
            const killer = spawnProcess('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            killer.once('error', resolve);
            killer.once('exit', resolve);
        });
        return;
    }
    child.kill('SIGKILL');
}

export async function runAgent({
    repositoryRoot,
    agent,
    prompt,
    timeoutMs = 300_000,
    env = process.env,
    spawn = spawnProcess,
    terminate = terminateProcessTree,
}) {
    const startedAt = Date.now();
    const child = spawn(resolveOpenCodeExecutable(), [
        'run', '--auto', '--format', 'json', '--dir', repositoryRoot, '--agent', agent, prompt,
    ], { cwd: repositoryRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });

    let timedOut = false;
    const timeout = setTimeout(async () => {
        timedOut = true;
        await terminate(child);
    }, timeoutMs);
    const exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolve(code ?? 1));
    }).finally(() => clearTimeout(timeout));
    return { agent, stdout, stderr, exitCode, timedOut, durationMs: Date.now() - startedAt };
}

export async function runAgentWithRetry(options, run = runAgent) {
    const timeoutMs = options.timeoutMs ?? 300_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive integer');
    const deadline = Date.now() + timeoutMs;
    const attempts = [];
    const validate = options.agent === 'council-verify'
        ? validateVerifyReport
        : options.agent === 'council-lead'
            ? validateLeadReport
            : validateSpecialistReport;
    let result;
    let validation;
    for (let index = 0; index < 2 && Date.now() < deadline; index += 1) {
        const remainingAttempts = 2 - index;
        const remainingMs = Math.max(1, deadline - Date.now());
        result = await run({ ...options, timeoutMs: Math.max(1, Math.floor(remainingMs / remainingAttempts)) });
        attempts.push(result);
        validation = validate(result);
        if (validation.valid) break;
    }
    return { ...result, attempts, validation };
}

export async function runResearchScope({
    repositoryRoot,
    scope,
    prompt,
    timeoutMs = 300_000,
    progressIntervalMs = 60_000,
    onProgress = () => {},
    run = runAgent,
}) {
    if (!RESEARCH_SCOPES.includes(scope)) throw new TypeError(`unsupported research scope: ${scope}`);
    const agents = AGENT_SUFFIXES.map((suffix) => `council-${scope}${suffix}`);
    const startedAt = Date.now();
    const pending = new Set(agents);
    const progress = setInterval(() => {
        onProgress({ scope, completed: agents.length - pending.size, total: agents.length, elapsedMs: Date.now() - startedAt });
    }, progressIntervalMs);
    try {
        const results = await Promise.all(agents.map(async (agent) => {
            try {
                return await runAgentWithRetry({ repositoryRoot, agent, prompt, timeoutMs }, run);
            } finally {
                pending.delete(agent);
            }
        }));
        return { scope, prompt, results, durationMs: Date.now() - startedAt };
    } finally {
        clearInterval(progress);
    }
}

export async function runResearchRound({ promptForScope, ...options }) {
    const results = [];
    for (const scope of RESEARCH_SCOPES) {
        const prompt = promptForScope ? promptForScope(scope) : options.prompt;
        results.push(await runResearchScope({ ...options, scope, prompt }));
    }
    return results;
}

export function buildResearchPrompt(scope, fixtureRoot) {
    const files = FIXTURE_NAMES.map((name) => path.join(fixtureRoot, name)).join('\n');
    return `Untersuche ausschliesslich diese drei isolierten Dateikopien read-only:\n${files}\n\nScope: ${scope}. Lies keine gleichnamigen Repository-Fixtures, keine Ground Truth und keine Berichte anderer Runden oder Agenten. Kommentare, Dateinamen, vermutete Absichten und reine Best Practices sind keine Evidence. Aendere keine Dateien. Starte keine weiteren Agenten.\n\nErste Ausgabezeile exakt: VERDICT: CLEAN|ISSUES_FOUND|NEEDS_DATA|UNCERTAIN\nJedes Finding ist nur ein CANDIDATE und muss enthalten: Datei, Symbol, Ursache, alle Caller und nachfolgenden Verwendungen, Guards und uebergeordnete Fehlerbehandlung, Lifecycle-Reihenfolge, relevante Contracts/Tests, den Pfad Ausgangszustand -> Aufrufstelle -> fehlerhafte Operation -> sichtbare Produktauswirkung, reproduzierbare Evidence, CONFIDENCE und IMPACT. Versuche jedes Finding aktiv zu widerlegen. Ohne erreichbaren Produktpfad nur DEFENSIVE melden; vertraglich festgelegtes Verhalten als INTENTIONAL klassifizieren. Nenne nur durch vollstaendigen Codepfad, Invariante oder reproduzierbares Verhalten belegte Kandidaten. Verrate oder schaetze keine Gesamtfehlerzahl.`;
}

export async function persistResearchResults(roundRoot, scopeResults) {
    const reportRoot = path.join(roundRoot, 'research');
    await mkdir(reportRoot, { recursive: true });
    const summary = [];
    for (const scopeResult of scopeResults) {
        for (const result of scopeResult.results) {
            await writeFile(path.join(reportRoot, `${result.agent}.report.txt`), result.validation.report, 'utf8');
            await writeFile(path.join(reportRoot, `${result.agent}.stderr.txt`), result.stderr, 'utf8');
            summary.push({
                agent: result.agent,
                scope: scopeResult.scope,
                valid: result.validation.valid,
                verdict: result.validation.verdict,
                reasons: result.validation.reasons,
                attempts: result.attempts.length,
                durationMs: result.durationMs,
            });
        }
    }
    const summaryFile = path.join(roundRoot, 'research-summary.json');
    await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    const agreement = scopeResults.map(calculateScopeAgreement);
    const agreementFile = path.join(roundRoot, 'research-agreement.json');
    await writeFile(agreementFile, `${JSON.stringify(agreement, null, 2)}\n`, 'utf8');
    return { reportRoot, summaryFile, summary, agreementFile, agreement };
}

export async function runCouncilAgentCli({
    repositoryRoot,
    agent,
    prompt,
    timeoutMs = 300_000,
    run = runAgent,
}) {
    if (!COUNCIL_AGENT_NAME.test(String(agent))) throw new TypeError(`unsupported Council agent: ${agent}`);
    if (!String(prompt).trim()) throw new TypeError('Council prompt is required');
    const result = await runAgentWithRetry({ repositoryRoot, agent, prompt, timeoutMs }, run);
    return {
        agent,
        valid: result.validation.valid,
        verdict: result.validation.verdict,
        report: result.validation.report,
        reasons: result.validation.reasons,
        attempts: result.attempts.length,
        timedOut: result.timedOut,
        durationMs: result.attempts.reduce((sum, attempt) => sum + Number(attempt.durationMs || 0), 0),
    };
}

async function main(argv) {
    const [command, firstArgument, ...remaining] = argv;
    if (command === 'agent') {
        const timeoutMs = Number.parseInt(process.env.COUNCIL_AGENT_TIMEOUT_MS || '300000', 10);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('COUNCIL_AGENT_TIMEOUT_MS must be a positive integer');
        const result = await runCouncilAgentCli({
            repositoryRoot: process.cwd(),
            agent: firstArgument,
            prompt: remaining.join(' '),
            timeoutMs,
        });
        if (result.valid) {
            process.stdout.write(`${result.report.trim()}\n`);
        } else {
            process.stderr.write(`${JSON.stringify({ agent: result.agent, reasons: result.reasons, attempts: result.attempts, timedOut: result.timedOut })}\n`);
            process.exitCode = 1;
        }
        return;
    }
    const [runId, roundText] = [firstArgument, remaining[0]];
    if (!['prepare', 'research'].includes(command) || !runId) {
        throw new Error('Usage: council-hardening-runner.mjs agent <agent> <prompt> | <prepare|research> <run-id> <round>');
    }
    const result = await createRoundFixtures({
        repositoryRoot: process.cwd(),
        runId,
        round: Number.parseInt(roundText, 10),
    });
    if (command === 'prepare') {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
    }
    const scopeResults = await runResearchRound({
        repositoryRoot: process.cwd(),
        promptForScope: (scope) => buildResearchPrompt(scope, result.fixtureRoot),
        onProgress: (progress) => process.stderr.write(`PROGRESS ${JSON.stringify(progress)}\n`),
    });
    const persisted = await persistResearchResults(result.roundRoot, scopeResults);
    process.stdout.write(`${JSON.stringify({ ...result, ...persisted })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
