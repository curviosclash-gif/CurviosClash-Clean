import { spawn as spawnProcess, execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveOpenCodeExecutable, terminateProcessTree } from './council-hardening-runner.mjs';

export const DEEPSEEK_MODEL = 'deepseek-v4-pro';
export const DEEPSEEK_OPENCODE_MODEL = 'opencode-go/deepseek-v4-pro';
export const DEEPSEEK_AGENT = 'deepseek-v4-pro';

const execFile = promisify(execFileCallback);
const VERDICTS = new Set(['CLEAN', 'ISSUES_FOUND', 'UNCERTAIN']);
const RUNTIME_FAILURE = /fallback warning|default agent|streaming response failed|model[^\n]*not (?:available|found)/i;

function result(status, details = {}) {
    return Object.freeze({ model: DEEPSEEK_MODEL, modelRoute: DEEPSEEK_OPENCODE_MODEL, status, ...details });
}

export function maskDeepSeekSecrets(value, secrets = []) {
    let text = String(value ?? '');
    for (const secret of secrets.filter((entry) => typeof entry === 'string' && entry)) {
        text = text.replaceAll(secret, '[REDACTED]');
    }
    return text.replace(/(?:api[_-]?key|authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._~+\/-]+/gi, '[REDACTED]');
}

async function defaultListModels({ executable = resolveOpenCodeExecutable(), timeoutMs = 15_000 } = {}) {
    return execFile(executable, ['models'], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
}

export async function preflightDeepSeekV4Pro({
    listModels = defaultListModels,
    timeoutMs = 15_000,
} = {}) {
    try {
        const execution = await listModels({ timeoutMs });
        const models = String(execution?.stdout ?? execution ?? '')
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean);
        if (!models.includes(DEEPSEEK_OPENCODE_MODEL)) {
            return result('INFRASTRUCTURE_ERROR', { reason: 'MODEL_NOT_AVAILABLE', modelCalls: 0 });
        }
        return result('READY', { modelCalls: 0 });
    } catch (error) {
        return result('INFRASTRUCTURE_ERROR', {
            reason: error?.killed ? 'OPENCODE_MODELS_TIMEOUT' : 'OPENCODE_UNAVAILABLE',
            detail: maskDeepSeekSecrets(error?.message),
            modelCalls: 0,
        });
    }
}

function extractJsonEvents(jsonLines) {
    const events = [];
    for (const line of String(jsonLines).split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            events.push(JSON.parse(line));
        } catch {
            // OpenCode diagnostics are carried on stderr; malformed stdout is handled below.
        }
    }
    return events;
}

function extractStructuredOutput(report) {
    const firstLine = String(report).split(/\r?\n/, 1)[0]?.trim() || '';
    const verdict = firstLine.startsWith('VERDICT: ') ? firstLine.slice('VERDICT: '.length) : '';
    if (!VERDICTS.has(verdict)) return { valid: false, reason: 'MISSING_OR_INVALID_VERDICT' };
    const blocks = [...String(report).matchAll(/```json\s*([\s\S]*?)```/gi)];
    for (const block of blocks.reverse()) {
        try {
            const output = JSON.parse(block[1]);
            if (output?.verdict !== verdict || typeof output?.summary !== 'string' || !Array.isArray(output?.findings)) continue;
            return { valid: true, verdict, output };
        } catch {
            // Try an earlier JSON block.
        }
    }
    return { valid: false, reason: 'INVALID_STRUCTURED_OUTPUT' };
}

export function parseOpenCodeAgentRun({ stdout = '', stderr = '', exitCode = 0, timedOut = false } = {}) {
    const events = extractJsonEvents(stdout);
    const sessionId = events.find((event) => typeof event?.sessionID === 'string')?.sessionID || null;
    const texts = events
        .filter((event) => event?.part?.type === 'text' && typeof event.part.text === 'string')
        .map((event) => event.part.text);
    const report = [...texts].reverse().find((text) => text.startsWith('VERDICT: ')) || texts.at(-1) || '';
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let costUsd = 0;
    let hasCost = false;
    let modelCalls = 0;
    for (const event of events) {
        if (event?.part?.type !== 'step-finish') continue;
        modelCalls += 1;
        usage.inputTokens += Number(event.part.tokens?.input || 0);
        usage.outputTokens += Number(event.part.tokens?.output || 0);
        usage.totalTokens += Number(event.part.tokens?.total || 0);
        if (Number.isFinite(event.part.cost)) {
            costUsd += Number(event.part.cost);
            hasCost = true;
        }
    }
    const toolCalls = events.filter((event) => event?.type === 'tool_use').length;
    if (timedOut) return { status: 'MODEL_TIMEOUT', reason: 'OPENCODE_RUN_TIMEOUT', sessionId, report, usage, costUsd: hasCost ? costUsd : null, modelCalls, toolCalls };
    if (exitCode !== 0 || RUNTIME_FAILURE.test(stderr)) {
        return { status: 'INFRASTRUCTURE_ERROR', reason: RUNTIME_FAILURE.test(stderr) ? 'MODEL_FALLBACK_OR_PROVIDER_FAILURE' : `OPENCODE_EXIT_${exitCode}`, sessionId, report, usage, costUsd: hasCost ? costUsd : null, modelCalls, toolCalls };
    }
    const structured = extractStructuredOutput(report);
    if (!structured.valid) return { status: 'INVALID_OUTPUT', reason: structured.reason, sessionId, report, usage, costUsd: hasCost ? costUsd : null, modelCalls, toolCalls };
    return { status: 'COMPLETED', output: structured.output, sessionId, report, usage, costUsd: hasCost ? costUsd : null, modelCalls, toolCalls };
}

function combineParsedRuns(first, second) {
    const hasCompleteCost = first.costUsd !== null && second.costUsd !== null;
    return {
        ...second,
        usage: {
            inputTokens: first.usage.inputTokens + second.usage.inputTokens,
            outputTokens: first.usage.outputTokens + second.usage.outputTokens,
            totalTokens: first.usage.totalTokens + second.usage.totalTokens,
        },
        costUsd: hasCompleteCost ? first.costUsd + second.costUsd : null,
        modelCalls: first.modelCalls + second.modelCalls,
        toolCalls: first.toolCalls + second.toolCalls,
        formatRetry: true,
    };
}

export async function captureBenchmarkSnapshotFiles(root, current = root) {
    const hashes = new Map();
    for (const entry of await readdir(current, { withFileTypes: true })) {
        if (current === root && entry.name === '.opencode') continue;
        const absolute = path.join(current, entry.name);
        const relative = path.relative(root, absolute).replaceAll('\\', '/');
        if (entry.isSymbolicLink()) throw new Error(`Snapshot contains a symlink: ${relative}`);
        if (entry.isDirectory()) {
            for (const [file, hash] of await captureBenchmarkSnapshotFiles(root, absolute)) hashes.set(file, hash);
        } else if (entry.isFile()) {
            const stat = await lstat(absolute);
            if (!stat.isFile()) throw new Error(`Snapshot entry is not a regular file: ${relative}`);
            hashes.set(relative, createHash('sha256').update(await readFile(absolute)).digest('hex'));
        }
    }
    return hashes;
}

export function changedBenchmarkSnapshotFiles(before, after) {
    return [...new Set([...before.keys(), ...after.keys()])]
        .filter((file) => before.get(file) !== after.get(file))
        .sort();
}

export function isAllowedBenchmarkChange(file, publicCase) {
    const matches = (candidate) => file === candidate || file.startsWith(`${candidate}/`);
    return publicCase.allowedChanges.some(matches) && !publicCase.forbiddenChanges.some(matches);
}

async function installAgentConfig({ repositoryRoot, snapshotRoot }) {
    const source = path.join(repositoryRoot, '.opencode', 'agents', `${DEEPSEEK_AGENT}.md`);
    const target = path.join(snapshotRoot, '.opencode', 'agents', `${DEEPSEEK_AGENT}.md`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
}

async function defaultRunOpenCode({ snapshotRoot, prompt, stateRoot, timeoutMs, sessionId = null, spawn = spawnProcess, terminate = terminateProcessTree }) {
    const executable = resolveOpenCodeExecutable();
    const args = ['run', '--auto', '--format', 'json', '--dir', snapshotRoot];
    if (sessionId) args.push('--session', sessionId);
    args.push('--agent', DEEPSEEK_AGENT, '--model', DEEPSEEK_OPENCODE_MODEL, prompt);
    const child = spawn(executable, args, {
        cwd: snapshotRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TEMP: stateRoot, TMP: stateRoot, COUNCIL_STATE_DIR: stateRoot },
    });
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
    return { stdout, stderr, exitCode, timedOut };
}

function buildPrompt(publicCase) {
    return [
        'Perform this benchmark case as one independent agent.',
        'Read case.public.json and only the files listed there.',
        publicCase.scope === 'repair'
            ? 'Apply the smallest correct repair inside allowedChanges and run every visible test.'
            : 'Analyze read-only, run visible tests when useful, and do not change any file.',
        'Do not delegate, start another agent, or inspect any parent directory.',
        'Follow the exact VERDICT plus fenced JSON final-output contract from your agent instructions.',
    ].join('\n');
}

export async function runDeepSeekV4ProAgent({
    snapshot,
    repositoryRoot,
    stateRoot,
    timeoutMs,
    listModels,
    runOpenCode = defaultRunOpenCode,
} = {}) {
    const startedAt = Date.now();
    const preflight = await preflightDeepSeekV4Pro({ listModels, timeoutMs: Math.min(timeoutMs || 60_000, 15_000) });
    if (preflight.status !== 'READY') return result(preflight.status, { reason: preflight.reason, detail: preflight.detail, durationMs: Date.now() - startedAt, modelCalls: 0, toolCalls: 0, usage: null, costUsd: null });
    try {
        await mkdir(stateRoot, { recursive: true });
        await installAgentConfig({ repositoryRoot, snapshotRoot: snapshot.root });
        const before = await captureBenchmarkSnapshotFiles(snapshot.root);
        const execution = await runOpenCode({
            snapshotRoot: snapshot.root,
            prompt: buildPrompt(snapshot.publicCase),
            stateRoot,
            timeoutMs: timeoutMs || snapshot.publicCase.timeoutSeconds * 1000,
            sessionId: null,
        });
        let parsed = parseOpenCodeAgentRun(execution);
        if (parsed.status === 'INVALID_OUTPUT' && parsed.sessionId) {
            const remainingMs = Math.max(1, (timeoutMs || snapshot.publicCase.timeoutSeconds * 1000) - (Date.now() - startedAt));
            const retryExecution = await runOpenCode({
                snapshotRoot: snapshot.root,
                prompt: 'FORMAT ONLY. Re-emit your existing conclusion with no new analysis. The very first character must be V and the first line must be exactly VERDICT: CLEAN, VERDICT: ISSUES_FOUND, or VERDICT: UNCERTAIN. Then emit exactly one fenced JSON object with verdict, summary, and findings. Emit nothing before or after it.',
                stateRoot,
                timeoutMs: remainingMs,
                sessionId: parsed.sessionId,
            });
            parsed = combineParsedRuns(parsed, parseOpenCodeAgentRun(retryExecution));
        }
        const after = await captureBenchmarkSnapshotFiles(snapshot.root);
        const changedFiles = changedBenchmarkSnapshotFiles(before, after);
        const illegalChanges = snapshot.publicCase.scope === 'repair'
            ? changedFiles.filter((file) => !isAllowedBenchmarkChange(file, snapshot.publicCase))
            : changedFiles;
        if (illegalChanges.length > 0) {
            return result('INVALID_OUTPUT', { ...parsed, status: 'INVALID_OUTPUT', reason: 'SCOPE_VIOLATION', changedFiles, illegalChanges, durationMs: Date.now() - startedAt });
        }
        return result(parsed.status, { ...parsed, changedFiles, durationMs: Date.now() - startedAt });
    } catch (error) {
        return result('INFRASTRUCTURE_ERROR', {
            reason: 'OPENCODE_TRANSPORT_ERROR',
            detail: maskDeepSeekSecrets(error?.message),
            durationMs: Date.now() - startedAt,
            modelCalls: 0,
            toolCalls: 0,
            usage: null,
            costUsd: null,
        });
    }
}
