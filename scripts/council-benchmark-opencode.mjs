import { spawn as spawnProcess } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    AGENT_SUFFIXES,
    extractCandidateManifest,
    runCouncilAgentCli,
    resolveOpenCodeExecutable,
    terminateProcessTree,
} from './council-hardening-runner.mjs';
import {
    captureBenchmarkSnapshotFiles,
    changedBenchmarkSnapshotFiles,
    isAllowedBenchmarkChange,
    parseOpenCodeAgentRun,
} from './council-benchmark-deepseek.mjs';

const REVIEW_SCOPES = Object.freeze(['review', 'test']);
const COMPACT_RESEARCH_BODY = `You are one read-only benchmark Council specialist. Use only the public case and source text embedded in the caller prompt. Do not call tools, inspect files or parent directories, edit, use bash, delegate, or infer hidden data. Follow the requested scope. Your only response must start at the first character with VERDICT: CLEAN, VERDICT: ISSUES_FOUND, VERDICT: NEEDS_DATA, or VERDICT: UNCERTAIN. Then emit exactly one fenced JSON object {"findings":[]} using file, symbol, category, claim, evidence, confidence, and impact. Emit nothing before the verdict or after the JSON block.`;
const COMPACT_PROPOSAL_BODY = `You are the technically read-only Coding-Council proposal agent. Read only case.public.json and its visible files. Never edit, use bash, delegate, inspect parent directories, hidden data, patches, or history. Return the requested primary, alt1, or alt2 edit specification with exact allowed paths and visible verification.`;
const COMPACT_CODING_BODY = `You are one isolated Coding-Council variant. Read case.public.json and only its visible files. Never inspect parent directories, hidden data, patches, or repository history. Never delegate. When the prompt requests a proposal, remain read-only and return a concise edit specification. Only when the prompt explicitly marks your proposal as selected may you edit paths in allowedChanges and run visibleTestCommands. Never touch forbiddenChanges, install dependencies, or delete untracked files. Keep the final response concise and follow the exact format requested by the caller.`;
const COMPACT_PLAN_BODY = `Plan only for the isolated case in case.public.json. Read only visible files, do not edit, run commands, inspect parent directories, or delegate. Return a concise ordered plan with affected visible paths, risks, and visible verification.`;
const COMPACT_LEAD_BODY = `Act only as the benchmark Council lead. Do not read beyond the current snapshot, edit, run bash, or delegate. Consolidate only the reports supplied by the caller. Enforce at least four valid sibling reports per scope. Follow the caller's requested schema. Your final response must begin at the first character with VERDICT: CLEAN, VERDICT: ISSUES_FOUND, VERDICT: NEEDS_DATA, or VERDICT: UNCERTAIN and end with exactly one fenced JSON block. Emit nothing after it.`;
const COMPACT_VERIFY_BODY = `Adversarially verify only the supplied candidates against current visible files. Do not edit, run bash, delegate, or inspect parent directories. Try to disprove every candidate. Classify BUG, DEFENSIVE, INTENTIONAL, FALSE, or UNCERTAIN. Your final response must begin at the first character with VERDICT: VERIFIED, VERDICT: REJECTED, or VERDICT: UNCERTAIN and end with exactly one fenced results JSON block. Emit nothing after it.`;

function mergeUsage(target, run) {
    const parsed = parseOpenCodeAgentRun(run);
    target.inputTokens += Number(parsed.usage?.inputTokens || 0);
    target.outputTokens += Number(parsed.usage?.outputTokens || 0);
    target.modelCalls += Number(parsed.modelCalls || 0);
    target.toolCalls += Number(parsed.toolCalls || 0);
    if (parsed.costUsd !== null && parsed.costUsd !== undefined) target.costUsd += Number(parsed.costUsd);
    else target.completeCost = false;
}

function publicPrompt(scope, publicCase, visibleSource) {
    return [
        `Review the embedded isolated input for scope ${scope}. Do not call any tool.`,
        'The exported fixture API is the reachable contract surface.',
        `Public case:\n${JSON.stringify(publicCase)}`,
        `Visible source:\n${visibleSource}`,
        'Do not delegate, edit files, or infer hidden data.',
        'The first final line must be exactly VERDICT: CLEAN|ISSUES_FOUND|NEEDS_DATA|UNCERTAIN.',
        'End with one fenced findings JSON block using the repository common finding schema.',
    ].join('\n');
}

async function installCouncilConfiguration(repositoryRoot, snapshotRoot) {
    await mkdir(path.join(snapshotRoot, '.opencode'), { recursive: true });
    await cp(path.join(repositoryRoot, '.opencode', 'agents'), path.join(snapshotRoot, '.opencode', 'agents'), { recursive: true });
    await cp(path.join(repositoryRoot, '.opencode', 'commands'), path.join(snapshotRoot, '.opencode', 'commands'), { recursive: true });
    await cp(path.join(repositoryRoot, '.opencode', 'council-models.json'), path.join(snapshotRoot, '.opencode', 'council-models.json'));
    await mkdir(path.join(snapshotRoot, 'scripts'), { recursive: true });
    await cp(
        path.join(repositoryRoot, 'scripts', 'council-hardening-runner.mjs'),
        path.join(snapshotRoot, 'scripts', 'council-hardening-runner.mjs'),
    );
    await writeFile(path.join(snapshotRoot, 'package.json'), `${JSON.stringify({
        private: true,
        type: 'module',
        scripts: { 'council:agent': 'node scripts/council-hardening-runner.mjs agent' },
    }, null, 2)}\n`, 'utf8');
    const compactAgents = new Map([
        ['plan', COMPACT_PLAN_BODY],
        ['council-lead', COMPACT_LEAD_BODY],
        ['council-verify', COMPACT_VERIFY_BODY],
        ['council-verify-fb', COMPACT_VERIFY_BODY],
        ['council-code-proposal', COMPACT_PROPOSAL_BODY],
    ]);
    for (const scope of REVIEW_SCOPES) {
        for (const suffix of AGENT_SUFFIXES) compactAgents.set(`council-${scope}${suffix}`, COMPACT_RESEARCH_BODY);
        for (const suffix of ['', '-alt1', '-alt2']) compactAgents.set(`council-code-${scope}${suffix}`, COMPACT_CODING_BODY);
    }
    for (const [agent, body] of compactAgents) {
        const target = path.join(snapshotRoot, '.opencode', 'agents', `${agent}.md`);
        const source = await readFile(target, 'utf8');
        const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0];
        if (!frontmatter) throw new Error(`Benchmark Council agent has no frontmatter: ${agent}`);
        await writeFile(target, `${frontmatter}\n\n${body}\n`, 'utf8');
    }
}

async function runReadOnlyCouncil({ snapshot, stateRoot, timeoutMs, repositoryRoot }) {
    const startedAt = Date.now();
    const totals = { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 0, costUsd: 0, completeCost: true };
    const scopeResults = [];
    const visibleSource = (await Promise.all(snapshot.publicCase.files.map(async ({ path: file }) => (
        `--- ${file} ---\n${await readFile(path.join(snapshot.root, file), 'utf8')}`
    )))).join('\n');
    for (const scope of REVIEW_SCOPES) {
        const prompt = publicPrompt(scope, snapshot.publicCase, visibleSource);
        const results = await Promise.all(AGENT_SUFFIXES.map(async (suffix) => {
            const agent = `council-${scope}${suffix}`;
            const result = await runCouncilAgentCli({
                repositoryRoot: snapshot.root,
                agent,
                prompt,
                timeoutMs,
                env: { ...process.env, TEMP: stateRoot, TMP: stateRoot, COUNCIL_STATE_DIR: path.join(stateRoot, agent) },
            });
            for (const attempt of result.attempts) mergeUsage(totals, attempt);
            return result;
        }));
        const valid = results.filter((entry) => entry.validation.valid);
        if (valid.length < 4) {
            return {
                status: 'INFRASTRUCTURE_ERROR',
                reason: `COUNCIL_${scope.toUpperCase()}_VALID_${valid.length}_OF_5`,
                validationDetails: results.map((entry) => ({
                    agent: entry.agent,
                    valid: entry.validation.valid,
                    reasons: entry.validation.reasons,
                    attempts: entry.attempts.length,
                    timedOut: entry.timedOut,
                })),
                durationMs: Date.now() - startedAt,
                ...totals,
            };
        }
        scopeResults.push({ scope, results: valid.map((entry) => ({ agent: entry.agent, report: entry.validation.report })) });
    }

    const leadPrompt = [
        'Consolidate these isolated benchmark reports. Treat every finding as a candidate.',
        'Require agreement from at least four of five valid siblings in its scope.',
        'First final line: VERDICT: CLEAN|ISSUES_FOUND|NEEDS_DATA|UNCERTAIN.',
        'End with one fenced JSON object {"candidates":[]} using the repository candidate schema.',
        JSON.stringify(scopeResults),
    ].join('\n');
    const lead = await runCouncilAgentCli({
        repositoryRoot: snapshot.root,
        agent: 'council-lead',
        prompt: leadPrompt,
        timeoutMs,
        env: { ...process.env, TEMP: stateRoot, TMP: stateRoot, COUNCIL_STATE_DIR: path.join(stateRoot, 'lead') },
    });
    for (const attempt of lead.attempts) mergeUsage(totals, attempt);
    const leadValidation = lead.validation;
    if (!leadValidation.valid) return { status: 'INVALID_OUTPUT', reason: 'INVALID_COUNCIL_LEAD', durationMs: Date.now() - startedAt, ...totals };
    let candidates;
    try {
        candidates = extractCandidateManifest(leadValidation.report).candidates;
    } catch {
        return { status: 'INVALID_OUTPUT', reason: 'INVALID_COUNCIL_CANDIDATES', durationMs: Date.now() - startedAt, ...totals };
    }

    if (candidates.length > 0) {
        const verifyPrompt = [
            'Adversarially verify every candidate against only the current isolated files.',
            'Try to disprove each candidate and emit BUG|DEFENSIVE|INTENTIONAL|FALSE|UNCERTAIN.',
            'First final line: VERDICT: VERIFIED|REJECTED|UNCERTAIN.',
            'End with the required fenced results JSON block.',
            JSON.stringify({ candidates }),
            visibleSource,
        ].join('\n');
        const verifyAgents = ['council-verify', 'council-verify-fb'];
        const verifies = await Promise.all(verifyAgents.map((agent, index) => runCouncilAgentCli({
            repositoryRoot: snapshot.root,
            agent,
            prompt: `${verifyPrompt}\nIndependent verify run: ${index}`,
            timeoutMs,
            env: { ...process.env, TEMP: stateRoot, TMP: stateRoot, COUNCIL_STATE_DIR: path.join(stateRoot, `verify-${index}`) },
        })));
        for (const verify of verifies) {
            for (const attempt of verify.attempts) mergeUsage(totals, attempt);
        }
        if (!verifies.every((verify) => verify.validation.valid)) {
            return { status: 'INVALID_OUTPUT', reason: 'INVALID_COUNCIL_VERIFY', durationMs: Date.now() - startedAt, ...totals };
        }
    }

    return {
        status: 'COMPLETED',
        output: { verdict: leadValidation.verdict, candidates },
        durationMs: Date.now() - startedAt,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        modelCalls: totals.modelCalls,
        toolCalls: totals.toolCalls,
        costUsd: totals.completeCost ? totals.costUsd : null,
    };
}

async function runCodingCouncil({ snapshot, stateRoot, timeoutMs, spawn = spawnProcess, terminate = terminateProcessTree }) {
    const prompt = 'Repair the current public benchmark case with the bounded Coding Council workflow.';
    const child = spawn(resolveOpenCodeExecutable(), [
        'run', '--auto', '--format', 'json', '--dir', snapshot.root,
        '--command', 'council-benchmark-coding', prompt,
    ], {
        cwd: snapshot.root,
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
    const timer = setTimeout(async () => { timedOut = true; await terminate(child); }, timeoutMs);
    const exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolve(code ?? 1));
    }).finally(() => clearTimeout(timer));
    const parsed = parseOpenCodeAgentRun({ stdout, stderr, exitCode, timedOut });
    return {
        ...parsed,
        inputTokens: parsed.usage?.inputTokens ?? null,
        outputTokens: parsed.usage?.outputTokens ?? null,
    };
}

export async function runCouncilBenchmarkArm({ snapshot, arm, stateRoot, timeoutMs, repositoryRoot }) {
    await mkdir(stateRoot, { recursive: true });
    await installCouncilConfiguration(repositoryRoot, snapshot.root);
    const before = await captureBenchmarkSnapshotFiles(snapshot.root);
    let result;
    if (arm === 'read-only-council') result = await runReadOnlyCouncil({ snapshot, stateRoot, timeoutMs, repositoryRoot });
    else if (arm === 'coding-council') result = await runCodingCouncil({ snapshot, stateRoot, timeoutMs });
    else throw new TypeError(`Unsupported Council benchmark arm: ${arm}`);
    const after = await captureBenchmarkSnapshotFiles(snapshot.root);
    const changedFiles = changedBenchmarkSnapshotFiles(before, after);
    const illegalChanges = snapshot.publicCase.scope === 'repair'
        ? changedFiles.filter((file) => !isAllowedBenchmarkChange(file, snapshot.publicCase))
        : changedFiles;
    if (illegalChanges.length > 0) {
        return { ...result, status: 'INVALID_OUTPUT', reason: 'SCOPE_VIOLATION', changedFiles, illegalChanges };
    }
    return { ...result, changedFiles };
}
