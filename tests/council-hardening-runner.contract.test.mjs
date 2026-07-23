import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    createRoundFixtures,
    buildResearchPrompt,
    buildVerifyPrompt,
    calculateScopeAgreement,
    extractFinalText,
    extractCandidateManifest,
    extractVerifyManifest,
    FIXTURE_NAMES,
    loadCouncilAgentRoutes,
    runAgent,
    runAgentWithRetry,
    runCouncilAgentCli,
    resolveOpenCodeExecutable,
    resolveCouncilAgentRoute,
    runResearchScope,
    runResearchRound,
    validateResearchReport,
    validateLeadReport,
    validateSpecialistReport,
    validateVerifyReport,
} from '../scripts/council-hardening-runner.mjs';
import { runCouncilLiveSmoke } from '../scripts/council-live-smoke.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const reportEvent = (text) => JSON.stringify({ type: 'text', text });
const specialistReport = (verdict = 'CLEAN', findings = []) => `VERDICT: ${verdict}\n\n\`\`\`json\n${JSON.stringify({ findings })}\n\`\`\``;

test('Windows resolves the native OpenCode executable instead of spawning a cmd wrapper', () => {
    if (process.platform !== 'win32') return;
    const executable = resolveOpenCodeExecutable();
    assert.match(executable, /opencode\.exe$/i);
});

test('Council process receives the resolved model route explicitly', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let args;
    const resultPromise = runAgent({
        repositoryRoot: ROOT,
        agent: 'council-review',
        model: 'opencode/big-pickle',
        prompt: 'health',
        spawn: (_executable, receivedArgs) => {
            args = receivedArgs;
            queueMicrotask(() => {
                child.exitCode = 0;
                child.emit('exit', 0);
            });
            return child;
        },
        inspectSession: null,
    });
    await resultPromise;
    assert.deepEqual(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 4), [
        '--agent', 'council-review', '--model', 'opencode/big-pickle',
    ]);
});

test('hardening fixtures are isolated below the OpenCode system temp root and preserve bytes', async () => {
    const prepared = await createRoundFixtures({ repositoryRoot: ROOT, runId: 'contract-fixtures', round: 1 });
    assert.ok(prepared.fixtureRoot.startsWith(path.join(tmpdir(), 'opencode', 'council-hardening')));
    assert.equal(prepared.fixtureRoot.startsWith(ROOT), false);
    for (const name of FIXTURE_NAMES) {
        assert.deepEqual(
            await readFile(path.join(prepared.fixtureRoot, name)),
            await readFile(path.join(ROOT, 'tests', 'council-test-loop', name)),
        );
    }
    await assert.rejects(() => createRoundFixtures({ repositoryRoot: ROOT, runId: '../escape', round: 1 }), /runId/);
});

test('only the final JSON text event is validated and VERDICT must be first', () => {
    const stdout = `${reportEvent('working')}\n${reportEvent('VERDICT: ISSUES_FOUND\nFinding')}\n${reportEvent('report complete')}`;
    assert.equal(extractFinalText(stdout), 'VERDICT: ISSUES_FOUND\nFinding');
    assert.deepEqual(validateResearchReport({ stdout }).warnings, ['post-report-summary']);
    assert.deepEqual(validateResearchReport({ stdout: reportEvent('Intro\nVERDICT: CLEAN') }).reasons, ['verdict-not-first-line']);
    assert.deepEqual(validateResearchReport({ stdout: reportEvent('```text\nVERDICT: CLEAN\n```') }).reasons, ['verdict-inside-code-fence']);
    assert.deepEqual(validateResearchReport({ stdout: reportEvent('No verdict') }).reasons, ['no-verdict-event']);
});

test('finding prose containing fallback stays valid but runtime fallback does not', () => {
    const stdout = reportEvent('VERDICT: ISSUES_FOUND\nOptions fallback is incorrect');
    assert.equal(validateResearchReport({ stdout }).valid, true);
    assert.equal(validateResearchReport({ stdout, stderr: 'Fallback warning: using default agent' }).valid, false);
});

test('Council routes resolve from the central matrix and match every agent frontmatter', async () => {
    const { routes } = await loadCouncilAgentRoutes(ROOT);
    const siblings = ['council-review', 'council-review-fb', 'council-review-fb2', 'council-review-fb3', 'council-review-fb4'];
    assert.equal(new Set(siblings.map((agent) => routes.get(agent))).size, 5);
    for (const agent of [...siblings, 'council-lead', 'council-verify', 'council-verify-fb']) {
        assert.equal(await resolveCouncilAgentRoute({ repositoryRoot: ROOT, agent }), routes.get(agent));
    }
    assert.equal(routes.get('council-lead'), 'opencode-go/deepseek-v4-pro');
    assert.notEqual(routes.get('council-verify'), routes.get('council-verify-fb'));
});

test('frontmatter and matrix drift is rejected before an agent process can start', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'council-route-drift-'));
    await mkdir(path.join(tempRoot, '.opencode', 'agents'), { recursive: true });
    await writeFile(
        path.join(tempRoot, '.opencode', 'council-models.json'),
        await readFile(path.join(ROOT, '.opencode', 'council-models.json')),
    );
    const agentPath = path.join(tempRoot, '.opencode', 'agents', 'council-review.md');
    const source = await readFile(path.join(ROOT, '.opencode', 'agents', 'council-review.md'), 'utf8');
    await writeFile(agentPath, source.replace('model: opencode/big-pickle', 'model: opencode/other-model'), 'utf8');
    let started = false;
    await assert.rejects(() => runCouncilAgentCli({
        repositoryRoot: tempRoot,
        agent: 'council-review',
        prompt: 'must not start',
        run: async () => {
            started = true;
            return {};
        },
    }), /route mismatch/);
    assert.equal(started, false);
});

test('runtime model mismatch and fallback events invalidate a Council report', () => {
    const sessionExport = {
        info: { id: 'child', parentID: 'parent' },
        messages: [{
            info: {
                role: 'assistant',
                agent: 'council-review',
                providerID: 'opencode',
                modelID: 'unexpected-model',
                tokens: { total: 1 },
            },
            parts: [],
        }],
    };
    const validation = validateResearchReport({
        stdout: reportEvent(specialistReport()),
        expectedModel: 'opencode/big-pickle',
        sessionExport,
        requireRouteEvidence: true,
    });
    assert.equal(validation.valid, false);
    assert.deepEqual(validation.reasons, ['model-route-mismatch', 'missing-model-route-evidence']);
});

test('specialist validation requires the machine-readable findings manifest', () => {
    assert.equal(validateSpecialistReport({ stdout: reportEvent(specialistReport()) }).valid, true);
    assert.match(validateSpecialistReport({ stdout: reportEvent('VERDICT: CLEAN') }).reasons[0], /invalid-research-manifest/);
});

test('lead candidate manifest is extracted from the final JSON block and validated', () => {
    const report = `VERDICT: ISSUES_FOUND\n\n\`\`\`json\n${JSON.stringify({ candidates: [{
        id: 'AA-01', file: 'fixture.mjs', symbol: 'acquire', claim: 'pending remains poisoned',
        evidence: 'second call returns rejected promise', potentialImpact: 'HIGH',
    }] })}\n\`\`\``;
    const manifest = extractCandidateManifest(report);
    assert.equal(manifest.candidates[0].id, 'AA-01');
    assert.equal(validateLeadReport({ stdout: reportEvent(report) }).valid, true);
    assert.match(validateLeadReport({ stdout: reportEvent('VERDICT: CLEAN') }).reasons[0], /invalid-candidate-manifest/);
    assert.throws(() => extractCandidateManifest('```json\n{"candidates":[{"id":"AA"}]}\n```'), /candidate\.file/);
});

test('verify uses compact candidate context and emits validated classifications', () => {
    const prompt = buildVerifyPrompt({ manifestFile: 'round/candidates.json', fixtureRoot: 'round/fixtures' });
    assert.match(prompt, /candidates\.json/);
    assert.doesNotMatch(prompt, /lead\.report/);
    assert.match(prompt, /Fixture-APIs sind die zu pruefende Contract-Oberflaeche/);
    assert.match(prompt, /nicht allein wegen fehlender Importe/);
    assert.ok(prompt.length < 1_500);
    const report = `VERDICT: VERIFIED\n\n\`\`\`json\n${JSON.stringify({ results: [{
        id: 'AA-01', classification: 'BUG', productPath: 'state -> call -> fault -> impact', counterEvidence: 'none',
    }] })}\n\`\`\``;
    assert.equal(extractVerifyManifest(report).results[0].classification, 'BUG');
    const stdout = `${reportEvent(report)}\n${reportEvent('verification complete')}`;
    assert.equal(validateVerifyReport({ stdout }).valid, true);
    assert.throws(() => extractVerifyManifest('```json\n{"results":[{"id":"AA","classification":"TRUE"}]}\n```'), /classification/);
});

test('scope agreement is deterministic and requires four valid agreeing models', () => {
    const finding = { file: 'fixture.mjs', symbol: 'acquire', category: 'pending-rejection', claim: 'claim', evidence: 'evidence', confidence: 'HIGH', impact: 'HIGH' };
    const result = (agent, valid = true) => ({
        agent,
        validation: { valid, report: `VERDICT: ISSUES_FOUND\n\n\`\`\`json\n${JSON.stringify({ findings: [finding] })}\n\`\`\`` },
    });
    const agreement = calculateScopeAgreement({ scope: 'perf', results: [
        result('council-perf'), result('council-perf-fb'), result('council-perf-fb2'), result('council-perf-fb3'), result('council-perf-fb4', false),
    ] });
    assert.equal(agreement.validRuns, 4);
    assert.equal(agreement.findings[0].agreementCount, 4);
    assert.equal(agreement.findings[0].highConfidence, true);
    const insufficient = calculateScopeAgreement({ scope: 'perf', results: [
        result('council-perf'), result('council-perf-fb'), result('council-perf-fb2'), result('council-perf-fb3', false), result('council-perf-fb4', false),
    ] });
    assert.equal(insufficient.findings[0].highConfidence, false);
});

test('research scope runs five siblings in parallel with one bounded retry', async () => {
    let active = 0;
    let maxActive = 0;
    const attempts = new Map();
    const prompts = [];
    const run = async ({ agent, prompt }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        prompts.push(prompt);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        const count = (attempts.get(agent) || 0) + 1;
        attempts.set(agent, count);
        if (agent === 'council-test-fb2' && count === 1) {
            return { agent, stdout: '', stderr: 'Streaming response failed', exitCode: 1, timedOut: false };
        }
        return { agent, stdout: reportEvent(specialistReport()), stderr: '', exitCode: 0, timedOut: false };
    };
    const result = await runResearchScope({ repositoryRoot: ROOT, scope: 'test', prompt: 'same', timeoutMs: 1_000, run });
    assert.equal(maxActive, 5);
    assert.equal(prompts.every((prompt) => prompt === 'same'), true);
    assert.equal(attempts.get('council-test-fb2'), 2);
    assert.equal(result.results.every(({ validation }) => validation.valid), true);
});

test('invalid Council output is retried once with the identical frozen prompt', async () => {
    const prompts = [];
    const result = await runAgentWithRetry({
        repositoryRoot: ROOT,
        agent: 'council-review',
        prompt: 'frozen benchmark prompt',
        timeoutMs: 1_000,
    }, async ({ agent, prompt }) => {
        prompts.push(prompt);
        return {
            agent,
            stdout: reportEvent(prompts.length === 1 ? 'summary without verdict' : specialistReport()),
            stderr: '',
            exitCode: 0,
            timedOut: false,
        };
    });
    assert.deepEqual(prompts, ['frozen benchmark prompt', 'frozen benchmark prompt']);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.validation.valid, true);
});

test('timed-out Council output receives one retry within the shared deadline', async () => {
    const attemptTimeouts = [];
    const result = await runAgentWithRetry({
        repositoryRoot: ROOT,
        agent: 'council-review',
        prompt: 'same prompt',
        timeoutMs: 1_000,
    }, async ({ agent, timeoutMs }) => {
        attemptTimeouts.push(timeoutMs);
        return {
            agent,
            stdout: reportEvent(attemptTimeouts.length === 1 ? 'partial' : specialistReport()),
            stderr: '',
            exitCode: attemptTimeouts.length === 1 ? 1 : 0,
            timedOut: attemptTimeouts.length === 1,
        };
    });
    assert.equal(result.attempts.length, 2);
    assert.deepEqual(result.attemptBudgetsMs, attemptTimeouts);
    assert.equal(result.retryBudgetMs, attemptTimeouts[1]);
    assert.ok(attemptTimeouts[0] >= 700);
    assert.ok(attemptTimeouts[1] > attemptTimeouts[0]);
    assert.equal(result.validation.valid, true);
});

test('provider failures are infrastructure errors and are never reported as model timeouts', async () => {
    const result = await runAgentWithRetry({
        repositoryRoot: ROOT,
        agent: 'council-review',
        model: 'opencode/big-pickle',
        prompt: 'same',
        timeoutMs: 100,
    }, async () => ({
        stdout: '',
        stderr: 'Provider transport unavailable',
        exitCode: 1,
        timedOut: false,
        durationMs: 1,
    }));
    assert.equal(result.attempts.length, 2);
    assert.equal(result.exitReason, 'INFRASTRUCTURE_ERROR');
    assert.equal(result.timedOut, false);
});

test('bounded Council CLI accepts both independent verify routes and rejects unknown agents', async () => {
    const report = `VERDICT: REJECTED\n\n\`\`\`json\n${JSON.stringify({ results: [] })}\n\`\`\``;
    for (const agent of ['council-verify', 'council-verify-fb']) {
        const result = await runCouncilAgentCli({
            repositoryRoot: ROOT,
            agent,
            prompt: 'verify',
            timeoutMs: 1_000,
            run: async ({ agent: selectedAgent }) => ({ agent: selectedAgent, stdout: reportEvent(report), stderr: '', exitCode: 0, timedOut: false }),
        });
        assert.equal(result.valid, true);
        assert.equal(result.verdict, 'REJECTED');
    }
    await assert.rejects(() => runCouncilAgentCli({ repositoryRoot: ROOT, agent: 'default', prompt: 'no', run: async () => ({}) }), /unsupported/);
});

test('live smoke requires four structured CLEAN reports from real-agent adapters', async () => {
    let calls = 0;
    const report = `VERDICT: CLEAN\n\n\`\`\`json\n${JSON.stringify({ findings: [] })}\n\`\`\``;
    const result = await runCouncilLiveSmoke({
        repositoryRoot: ROOT,
        timeoutMs: 1_000,
        run: async ({ agent }) => {
            calls += 1;
            if (agent === 'council-lead') {
                return {
                    agent,
                    stdout: reportEvent('VERDICT: CLEAN\n```json\n{"candidates":[]}\n```'),
                    stderr: '',
                    exitCode: 0,
                    timedOut: false,
                };
            }
            return {
                agent,
                stdout: reportEvent(agent === 'council-review-fb4' ? 'VERDICT: NEEDS_DATA\n```json\n{"findings":[]}\n```' : report),
                stderr: '',
                exitCode: 0,
                timedOut: false,
            };
        },
    });
    assert.equal(calls, 6);
    assert.equal(result.validRuns, 4);
    assert.equal(result.distinctValidRoutes, 4);
    assert.equal(result.leadHealthy, true);
    assert.equal(result.passed, true);
});

test('live smoke rejects unregistered routes before invoking their agents', async () => {
    const called = [];
    const result = await runCouncilLiveSmoke({
        repositoryRoot: ROOT,
        timeoutMs: 1_000,
        listModels: async () => ({ stdout: 'opencode/big-pickle\n' }),
        run: async ({ agent }) => {
            called.push(agent);
            return {
                agent,
                stdout: reportEvent(specialistReport()),
                stderr: '',
                exitCode: 0,
                timedOut: false,
            };
        },
    });
    assert.deepEqual(called, ['council-review']);
    assert.equal(result.passed, false);
    assert.equal(result.results.filter(({ exitReason }) => exitReason === 'INFRASTRUCTURE_ERROR').length, 4);
});

test('benchmark and live-smoke Council paths cannot bypass the bounded wrapper', async () => {
    const benchmark = await readFile(path.join(ROOT, 'scripts', 'council-benchmark-opencode.mjs'), 'utf8');
    const liveSmoke = await readFile(path.join(ROOT, 'scripts', 'council-live-smoke.mjs'), 'utf8');
    assert.doesNotMatch(benchmark, /runAgentWithRetry/);
    assert.match(benchmark, /runCouncilAgentCli/);
    assert.match(liveSmoke, /runCouncilAgentCli/);
});

test('research round keeps scopes sequential and supplies scope-specific prompts', async () => {
    let active = 0;
    let maxActive = 0;
    const seenPrompts = new Set();
    const run = async ({ prompt }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        seenPrompts.add(prompt);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { stdout: reportEvent(specialistReport()), stderr: '', exitCode: 0, timedOut: false };
    };
    const results = await runResearchRound({
        repositoryRoot: ROOT,
        promptForScope: (scope) => `scope:${scope}`,
        timeoutMs: 1_000,
        run,
    });
    assert.equal(results.length, 4);
    assert.equal(maxActive, 5);
    assert.deepEqual([...seenPrompts], ['scope:review', 'scope:arch', 'scope:test', 'scope:perf']);
    assert.match(buildResearchPrompt('review', 'tmp/fixtures'), /Scope: review/);
});

test('agent timeout drains streams and terminates the process', async () => {
    const child = new EventEmitter();
    child.pid = 123;
    child.exitCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let terminated = false;
    const terminate = async () => {
        terminated = true;
        child.exitCode = 1;
        child.emit('exit', 1);
    };
    const promise = runAgent({
        repositoryRoot: ROOT,
        agent: 'council-test',
        model: 'opencode/big-pickle',
        prompt: 'test',
        timeoutMs: 10,
        spawn: () => child,
        terminate,
        inspectSession: null,
    });
    child.stdout.write(`${reportEvent('partial')}\n`);
    const result = await promise;
    assert.equal(terminated, true);
    assert.equal(result.timedOut, true);
    assert.match(result.stdout, /partial/);
});
