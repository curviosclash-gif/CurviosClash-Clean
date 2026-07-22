import { spawn as spawnProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
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
const RUNTIME_FAILURE = /fallback warning|default agent|streaming response failed/i;

export function resolveOpenCodeExecutable({ platform = process.platform, env = process.env } = {}) {
    if (platform !== 'win32') return 'opencode';
    for (const directory of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
        if (!existsSync(path.join(directory, 'opencode.cmd'))) continue;
        const executable = path.join(directory, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
        if (existsSync(executable)) return executable;
    }
    return 'opencode.exe';
}

export function extractFinalText(jsonLines) {
    let finalText = '';
    for (const line of String(jsonLines).split(/\r?\n/)) {
        if (!line.trim()) continue;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }
        const text = event?.part?.type === 'text' ? event.part.text : event?.type === 'text' ? event.text : '';
        if (typeof text === 'string' && text.trim()) finalText = text;
    }
    return finalText;
}

export function validateResearchReport({ stdout, stderr = '', exitCode = 0, timedOut = false }) {
    const report = extractFinalText(stdout);
    const firstLine = report.split(/\r?\n/, 1)[0]?.trim() || '';
    const verdict = firstLine.startsWith('VERDICT: ') ? firstLine.slice('VERDICT: '.length) : '';
    const reasons = [];
    if (timedOut) reasons.push('timeout');
    if (exitCode !== 0) reasons.push(`exit:${exitCode}`);
    if (RUNTIME_FAILURE.test(stderr)) reasons.push('runtime-fallback');
    if (!RESEARCH_VERDICTS.has(verdict)) reasons.push('missing-verdict');
    return { valid: reasons.length === 0, verdict, report, reasons };
}

export async function createRoundFixtures({ repositoryRoot, runId, round }) {
    if (!Number.isInteger(round) || round < 1) throw new TypeError('round must be a positive integer');
    const tempRoot = path.resolve(repositoryRoot, 'tmp', 'council-hardening', String(runId));
    const roundRoot = path.join(tempRoot, `round-${round}`);
    const fixtureRoot = path.join(roundRoot, 'fixtures');
    const relative = path.relative(path.resolve(repositoryRoot), fixtureRoot);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture directory escaped repository tmp');
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
    spawn = spawnProcess,
    terminate = terminateProcessTree,
}) {
    const startedAt = Date.now();
    const child = spawn(resolveOpenCodeExecutable(), [
        'run', '--auto', '--format', 'json', '--dir', repositoryRoot, '--agent', agent, prompt,
    ], { cwd: repositoryRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

function isRetryableProviderFailure(result) {
    return !result.timedOut && (
        result.exitCode !== 0
        || /streaming response failed|rate.?limit|temporarily unavailable/i.test(result.stderr)
    );
}

export async function runAgentWithRetry(options, run = runAgent) {
    const deadline = Date.now() + (options.timeoutMs ?? 300_000);
    const attempts = [];
    const first = await run({ ...options, timeoutMs: Math.max(1, deadline - Date.now()) });
    attempts.push(first);
    if (isRetryableProviderFailure(first) && Date.now() < deadline) {
        attempts.push(await run({ ...options, timeoutMs: Math.max(1, deadline - Date.now()) }));
    }
    const result = attempts.at(-1);
    return { ...result, attempts, validation: validateResearchReport(result) };
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
    return `Untersuche ausschliesslich diese drei isolierten Dateikopien read-only:\n${files}\n\nScope: ${scope}. Lies keine gleichnamigen Repository-Fixtures, keine Ground Truth und keine Berichte anderer Runden oder Agenten. Kommentare, Dateinamen, vermutete Absichten und reine Best Practices sind keine Evidence. Aendere keine Dateien. Starte keine weiteren Agenten.\n\nErste Ausgabezeile exakt: VERDICT: CLEAN|ISSUES_FOUND|NEEDS_DATA|UNCERTAIN\nJedes Finding muss enthalten: Datei, Symbol, Ursache, reproduzierbare Evidence, CONFIDENCE und IMPACT. Nenne nur durch Codepfad, Invariante oder reproduzierbares Verhalten belegte Defekte. Verrate oder schaetze keine Gesamtfehlerzahl.`;
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
    return { reportRoot, summaryFile, summary };
}

async function main(argv) {
    const [command, runId, roundText] = argv;
    if (!['prepare', 'research'].includes(command) || !runId) {
        throw new Error('Usage: council-hardening-runner.mjs <prepare|research> <run-id> <round>');
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
