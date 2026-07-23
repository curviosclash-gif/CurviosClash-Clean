import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    DEEPSEEK_AGENT,
    DEEPSEEK_COMMAND,
    DEEPSEEK_MODEL,
    DEEPSEEK_OPENCODE_MODEL,
    maskDeepSeekSecrets,
    parseOpenCodeAgentRun,
    preflightDeepSeekV4Pro,
    runDeepSeekV4ProAgent,
} from '../scripts/council-benchmark-deepseek.mjs';
import {
    BENCHMARK_MANIFEST_VERSION,
    assertPublicBenchmarkCase,
    createBenchmarkSnapshot,
    createPublicBenchmarkCase,
    normalizeBenchmarkPath,
    validateBenchmarkCase,
    validateBenchmarkManifest,
    validateManifestSources,
} from '../scripts/council-benchmark-manifest.mjs';
import {
    createBenchmarkDryRun,
    loadLocalBenchmarkManifest,
    runBenchmarkHarnessSmoke,
} from '../scripts/council-benchmark-runner.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PRIVATE_FIELDS = ['fixedRevision', 'expectedClassification', 'expectedFiles', 'expectedSymbols', 'hiddenTestCommands', 'fixedFiles', 'goldPatch', 'gold'];

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

test('local evaluator manifest is versioned, pinned, unique, and backed by intact files', async () => {
    const manifest = await loadLocalBenchmarkManifest(ROOT);
    assert.equal(manifest.schemaVersion, BENCHMARK_MANIFEST_VERSION);
    assert.equal(manifest.cases.length, 3);
    assert.equal(new Set(manifest.cases.map(({ id }) => id)).size, 3);
    assert.deepEqual(manifest.cases.map(({ split }) => split), ['development', 'development', 'development']);
    assert.equal(manifest.cases.filter(({ negativeControl }) => negativeControl).length, 1);
});

test('manifest validation rejects invalid enums, revisions, command overlap, split leakage, and traversal', async () => {
    const manifest = await loadLocalBenchmarkManifest(ROOT);
    const invalidScope = clone(manifest.cases[0]);
    invalidScope.scope = 'unknown';
    assert.throws(() => validateBenchmarkCase(invalidScope), /scope/);

    const invalidRevision = clone(manifest.cases[0]);
    invalidRevision.fixedRevision = 'main';
    assert.throws(() => validateBenchmarkCase(invalidRevision), /fixedRevision/);

    const mismatchedRevision = clone(manifest.cases[0]);
    mismatchedRevision.fixedRevision = `sha256:${'1'.repeat(64)}`;
    assert.throws(() => validateBenchmarkCase(mismatchedRevision), /single fixed file/);

    const overlappingCommands = clone(manifest.cases[0]);
    overlappingCommands.hiddenTestCommands = [...overlappingCommands.visibleTestCommands];
    assert.throws(() => validateBenchmarkCase(overlappingCommands), /may not overlap/);

    const traversal = clone(manifest.cases[0]);
    traversal.visibleFiles[0].target = '../gold.mjs';
    assert.throws(() => validateBenchmarkCase(traversal), /traverse/);
    assert.throws(() => normalizeBenchmarkPath('C:\\secret.txt'), /relative/);
    assert.throws(() => normalizeBenchmarkPath('fixture.mjs\0..\\secret'), /control character/);

    const splitLeakage = clone(manifest);
    splitLeakage.cases[1].groupId = splitLeakage.cases[0].groupId;
    splitLeakage.cases[1].split = 'holdout';
    assert.throws(() => validateBenchmarkManifest(splitLeakage), /split boundaries/);
});

test('public case is allowlist-generated and cannot expose evaluator gold data', async () => {
    const manifest = await loadLocalBenchmarkManifest(ROOT);
    const publicCase = createPublicBenchmarkCase(manifest.cases[0]);
    assert.equal(assertPublicBenchmarkCase(publicCase), true);
    const serialized = JSON.stringify(publicCase);
    for (const field of PRIVATE_FIELDS) assert.doesNotMatch(serialized, new RegExp(`"${field}"`));
    assert.deepEqual(publicCase.files, [{ path: 'fixture.mjs', sha256: manifest.cases[0].integrityHash }]);
    const leaked = { ...publicCase, hiddenTestCommands: ['secret'] };
    assert.throws(() => assertPublicBenchmarkCase(leaked), /leaked/);
});

test('paired arms receive byte-identical isolated snapshots without private metadata', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'council-benchmark-contract-'));
    const report = await createBenchmarkDryRun({ repositoryRoot: ROOT, tempRoot });
    assert.equal(report.passed, true);
    assert.equal(report.externalModelCalls, 0);
    assert.equal(report.cases.length, 3);
    for (const benchmarkCase of report.cases) {
        assert.equal(benchmarkCase.identicalVisibleInputs, true);
        assert.equal(new Set(benchmarkCase.snapshots.map(({ digest }) => digest)).size, 1);
        for (const snapshot of benchmarkCase.snapshots) {
            assert.ok(snapshot.root.startsWith(tempRoot));
            assert.deepEqual(snapshot.files, ['case.public.json', 'fixture.mjs']);
            const publicText = await readFile(path.join(snapshot.root, 'case.public.json'), 'utf8');
            for (const field of PRIVATE_FIELDS) assert.doesNotMatch(publicText, new RegExp(`"${field}"`));
            assert.doesNotMatch(publicText, /tests\/council-test-loop\/errors-/);
        }
        const [first, second] = benchmarkCase.snapshots;
        await writeFile(path.join(first.root, 'fixture.mjs'), 'changed', 'utf8');
        assert.notEqual(await readFile(path.join(first.root, 'fixture.mjs'), 'utf8'), await readFile(path.join(second.root, 'fixture.mjs'), 'utf8'));
    }
});

test('snapshot source integrity rejects symlink inputs and hash mismatches', async (t) => {
    const manifest = await loadLocalBenchmarkManifest(ROOT);
    const mismatch = clone(manifest);
    mismatch.cases[0].visibleFiles[0].sha256 = '0'.repeat(64);
    await assert.rejects(() => validateManifestSources(mismatch, ROOT), /integrity/);

    const fakeRoot = await mkdtemp(path.join(tmpdir(), 'council-benchmark-symlink-'));
    const realContent = 'export const value = 1;\n';
    await writeFile(path.join(fakeRoot, 'real.mjs'), realContent, 'utf8');
    try {
        await symlink('real.mjs', path.join(fakeRoot, 'link.mjs'), 'file');
    } catch (error) {
        if (error.code === 'EPERM') return t.skip('File symlinks require Windows developer mode.');
        throw error;
    }
    const linked = clone(manifest);
    linked.cases = [linked.cases[0]];
    linked.cases[0].visibleFiles = [{
        source: 'link.mjs',
        target: 'fixture.mjs',
        sha256: createHash('sha256').update(realContent).digest('hex'),
    }];
    await assert.rejects(() => validateManifestSources(linked, fakeRoot), /non-symlink/);
});

test('DeepSeek preflight requires the exact OpenCode model route and never falls back', async () => {
    let calls = 0;
    const unavailable = await preflightDeepSeekV4Pro({ listModels: async () => { calls += 1; return { stdout: 'opencode/another-model\n' }; } });
    assert.equal(unavailable.status, 'INFRASTRUCTURE_ERROR');
    assert.equal(unavailable.reason, 'MODEL_NOT_AVAILABLE');
    assert.equal(calls, 1);
    const ready = await preflightDeepSeekV4Pro({ listModels: async () => ({ stdout: `${DEEPSEEK_OPENCODE_MODEL}\n` }) });
    assert.equal(ready.status, 'READY');
    assert.equal(DEEPSEEK_MODEL, 'deepseek-v4-pro');
    assert.equal(DEEPSEEK_AGENT, 'deepseek-v4-pro');
    assert.equal(DEEPSEEK_OPENCODE_MODEL, 'opencode-go/deepseek-v4-pro');
});

test('DeepSeek is a pinned native subtask command with deny-by-default delegation and edits', async () => {
    const agent = await readFile(path.join(ROOT, '.opencode', 'agents', 'deepseek-v4-pro.md'), 'utf8');
    const command = await readFile(path.join(ROOT, '.opencode', 'commands', `${DEEPSEEK_COMMAND}.md`), 'utf8');
    assert.match(agent, /^---[\s\S]*\nmode: subagent\n/m);
    assert.match(agent, /\nmodel: opencode-go\/deepseek-v4-pro\n/);
    assert.match(agent, /\n\s*edit: deny\n/);
    assert.match(agent, /\n\s*task: deny\n/);
    assert.doesNotMatch(agent, /council-(?:review|arch|sec|perf|test|refactor|lead|verify)/i);
    assert.match(command, /\nagent: deepseek-v4-pro\n/);
    assert.match(command, /\nsubtask: true\n/);
    assert.match(command, /\nmodel: opencode-go\/deepseek-v4-pro\n/);
    const adapter = await readFile(path.join(ROOT, 'scripts', 'council-benchmark-deepseek.mjs'), 'utf8');
    assert.match(adapter, /\['serve', '--hostname=127\.0\.0\.1', '--port=0'\]/);
    assert.match(adapter, /parentID: parent\.id/);
    assert.match(adapter, /\/message\$\{query\}/);
    assert.doesNotMatch(adapter, /@opencode-ai\/sdk/);
    assert.doesNotMatch(adapter, /args\.push\('--agent'/);
});

test('DeepSeek route evidence requires one child-session model and no task or Council agent', () => {
    const report = 'VERDICT: CLEAN\n```json\n{"verdict":"CLEAN","summary":"ok","findings":[]}\n```';
    const stdout = [
        JSON.stringify({ type: 'text', sessionID: 'child', part: { type: 'text', text: report } }),
        JSON.stringify({ type: 'step_finish', sessionID: 'child', part: { type: 'step-finish', tokens: { input: 1, output: 1, total: 2 } } }),
    ].join('\n');
    const sessionExport = {
        info: { id: 'child', parentID: 'parent', agent: DEEPSEEK_AGENT },
        messages: [{
            info: {
                role: 'assistant',
                agent: DEEPSEEK_AGENT,
                providerID: 'opencode-go',
                modelID: 'deepseek-v4-pro',
                tokens: { total: 2 },
            },
            parts: [],
        }],
    };
    const valid = parseOpenCodeAgentRun({ stdout, sessionExport, routeEvidenceRequired: true });
    assert.equal(valid.status, 'COMPLETED');
    assert.deepEqual(valid.runtime.modelRoutes, [DEEPSEEK_OPENCODE_MODEL]);
    assert.equal(valid.runtime.parentId, 'parent');

    sessionExport.messages[0].parts.push({ type: 'tool', tool: 'task' });
    const rejected = parseOpenCodeAgentRun({ stdout, sessionExport, routeEvidenceRequired: true });
    assert.equal(rejected.status, 'INFRASTRUCTURE_ERROR');
    assert.equal(rejected.reason, 'DEEPSEEK_ROUTE_CONTRACT_VIOLATION');
});

test('DeepSeek OpenCode adapter records tokens, validates output, and masks diagnostics', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'council-benchmark-deepseek-'));
    const manifest = await loadLocalBenchmarkManifest(ROOT);
    const snapshot = await createBenchmarkSnapshot({
        benchmarkCase: manifest.cases[0],
        repositoryRoot: ROOT,
        tempRoot,
        arm: 'deepseek-contract',
    });
    const report = 'VERDICT: CLEAN\n```json\n{"verdict":"CLEAN","summary":"no issue","findings":[]}\n```';
    const stdout = [
        JSON.stringify({ type: 'text', part: { type: 'text', text: report } }),
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', tokens: { input: 11, output: 7, total: 18 }, cost: 0.01 } }),
    ].join('\n');
    const agentResult = await runDeepSeekV4ProAgent({
        snapshot,
        repositoryRoot: ROOT,
        stateRoot: path.join(tempRoot, 'state'),
        listModels: async () => ({ stdout: `${DEEPSEEK_OPENCODE_MODEL}\n` }),
        runOpenCode: async ({ snapshotRoot, stateRoot }) => {
            assert.equal(snapshotRoot, snapshot.root);
            assert.ok(stateRoot.startsWith(tempRoot));
            return { stdout, stderr: '', exitCode: 0, timedOut: false };
        },
    });
    assert.equal(agentResult.status, 'COMPLETED');
    assert.deepEqual(agentResult.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });
    assert.equal(agentResult.costUsd, 0.01);
    assert.equal(agentResult.modelCalls, 1);
    assert.equal(maskDeepSeekSecrets('Authorization: top-secret failed: top-secret', ['top-secret']), 'Authorization: [REDACTED] failed: [REDACTED]');
    const fallback = parseOpenCodeAgentRun({ stdout, stderr: 'default agent fallback warning', exitCode: 0 });
    assert.equal(fallback.status, 'INFRASTRUCTURE_ERROR');
    assert.equal(fallback.reason, 'MODEL_FALLBACK_OR_PROVIDER_FAILURE');
});

test('OpenCode timeout after streamed model steps is classified as model timeout', () => {
    const parsed = parseOpenCodeAgentRun({
        stdout: `${JSON.stringify({
            type: 'step_finish',
            part: { type: 'step-finish', tokens: { input: 1, output: 1, total: 2 } },
        })}\n`,
        timedOut: true,
    });
    assert.equal(parsed.status, 'MODEL_TIMEOUT');
    assert.equal(parsed.reason, 'OPENCODE_RUN_TIMEOUT');
    assert.equal(parsed.modelCalls, 1);
});

test('DeepSeek OpenCode repair is rejected when the isolated agent changes a forbidden path', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'council-benchmark-scope-'));
    const manifest = await loadLocalBenchmarkManifest(ROOT);
    const snapshot = await createBenchmarkSnapshot({
        benchmarkCase: manifest.cases[1],
        repositoryRoot: ROOT,
        tempRoot,
        arm: 'deepseek-scope',
    });
    const report = 'VERDICT: ISSUES_FOUND\n```json\n{"verdict":"ISSUES_FOUND","summary":"patched","findings":[]}\n```';
    const result = await runDeepSeekV4ProAgent({
        snapshot,
        repositoryRoot: ROOT,
        stateRoot: path.join(tempRoot, 'state'),
        listModels: async () => ({ stdout: `${DEEPSEEK_OPENCODE_MODEL}\n` }),
        runOpenCode: async ({ snapshotRoot }) => {
            await writeFile(path.join(snapshotRoot, 'package.json'), '{}\n', 'utf8');
            return { stdout: JSON.stringify({ type: 'text', part: { type: 'text', text: report } }), stderr: '', exitCode: 0, timedOut: false };
        },
    });
    assert.equal(result.status, 'INVALID_OUTPUT');
    assert.equal(result.reason, 'SCOPE_VIOLATION');
    assert.deepEqual(result.illegalChanges, ['package.json']);
});

test('DeepSeek format retry continues the same OpenCode session and aggregates usage', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'council-benchmark-format-'));
    const manifest = await loadLocalBenchmarkManifest(ROOT);
    const snapshot = await createBenchmarkSnapshot({ benchmarkCase: manifest.cases[2], repositoryRoot: ROOT, tempRoot, arm: 'deepseek-format' });
    const calls = [];
    const result = await runDeepSeekV4ProAgent({
        snapshot,
        repositoryRoot: ROOT,
        stateRoot: path.join(tempRoot, 'state'),
        listModels: async () => ({ stdout: `${DEEPSEEK_OPENCODE_MODEL}\n` }),
        runOpenCode: async ({ sessionId }) => {
            calls.push(sessionId);
            const text = sessionId
                ? 'VERDICT: CLEAN\n```json\n{"verdict":"CLEAN","summary":"clean","findings":[]}\n```'
                : 'analysis first\nVERDICT: CLEAN';
            return {
                stdout: [
                    JSON.stringify({ type: 'text', sessionID: 'session-1', part: { type: 'text', text } }),
                    JSON.stringify({ type: 'step_finish', sessionID: 'session-1', part: { type: 'step-finish', tokens: { input: 2, output: 1, total: 3 }, cost: 0.001 } }),
                ].join('\n'),
                stderr: '',
                exitCode: 0,
                timedOut: false,
            };
        },
    });
    assert.deepEqual(calls, [null, 'session-1']);
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.formatRetry, true);
    assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
    assert.equal(result.costUsd, 0.002);
});

test('non-graded smoke classifies unavailable OpenCode model as infrastructure and blocks baseline', async () => {
    let modelChecks = 0;
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'council-benchmark-smoke-'));
    const smoke = await runBenchmarkHarnessSmoke({
        repositoryRoot: ROOT,
        tempRoot,
        listModels: async () => { modelChecks += 1; return { stdout: 'opencode/another-model\n' }; },
    });
    assert.equal(smoke.passed, false);
    assert.equal(smoke.baselineEligible, false);
    assert.equal(smoke.dryRunPassed, true);
    assert.equal(smoke.cases, 3);
    assert.equal(smoke.armRuns.length, 6);
    assert.equal(smoke.infrastructureErrors, 3);
    assert.equal(smoke.exitReason, 'MODEL_NOT_AVAILABLE');
    assert.equal(modelChecks, 1);
});

test('non-graded smoke requires actual completion from every injected arm executor', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'council-benchmark-executor-'));
    let executions = 0;
    const stateRoots = new Set();
    const completed = await runBenchmarkHarnessSmoke({
        repositoryRoot: ROOT,
        tempRoot,
        listModels: async () => ({ stdout: `${DEEPSEEK_OPENCODE_MODEL}\n` }),
        executeArm: async ({ stateRoot }) => {
            executions += 1;
            stateRoots.add(stateRoot);
            return { status: 'COMPLETED', modelCalls: 1, toolCalls: 0, inputTokens: 1, outputTokens: 1, costUsd: null };
        },
    });
    assert.equal(completed.passed, true);
    assert.equal(completed.baselineEligible, true);
    assert.equal(completed.validRuns, 6);
    assert.equal(executions, 6);
    assert.equal(stateRoots.size, 6);
    assert.deepEqual(completed.tokens, { input: 6, output: 6 });
});
