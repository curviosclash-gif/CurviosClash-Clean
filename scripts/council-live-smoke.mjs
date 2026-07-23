import { execFile as execFileCallback } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
    extractResearchManifest,
    loadCouncilAgentRoutes,
    resolveOpenCodeExecutable,
    runCouncilAgentCli,
} from './council-hardening-runner.mjs';

const execFile = promisify(execFileCallback);
const LIVE_SMOKE_PROMPT = `Read the exact repository file .opencode/council-models.json directly; do not use glob or search. Verify that readOnlyCouncil.primary contains council-review. Do not inspect any other file, edit, use bash, or delegate. If the exact file and property are readable, return CLEAN; otherwise return NEEDS_DATA. Emit no status, planning, or introductory text. The first visible text line must be exactly VERDICT: CLEAN or VERDICT: NEEDS_DATA. End with exactly one fenced JSON block {"findings":[]} and no text after it.`;
const LEAD_HEALTH_PROMPT = `Health check only. Do not use tools, inspect files, edit, or delegate. Emit exactly VERDICT: CLEAN followed by one fenced JSON block {"candidates":[]} and no other text.`;

async function defaultListModels() {
    return execFile(resolveOpenCodeExecutable(), ['models'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
}

export async function runCouncilLiveSmoke({
    repositoryRoot = process.cwd(),
    timeoutMs = 300_000,
    run,
    listModels,
    onProgress = () => {},
} = {}) {
    const startedAt = Date.now();
    const { routes } = await loadCouncilAgentRoutes(repositoryRoot);
    const registeredExecution = listModels
        ? await listModels()
        : run
            ? { stdout: [...new Set(routes.values())].join('\n') }
            : await defaultListModels();
    const registered = new Set(String(registeredExecution?.stdout ?? registeredExecution ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const agents = ['council-review', 'council-review-fb', 'council-review-fb2', 'council-review-fb3', 'council-review-fb4'];
    const completed = new Set();
    const progress = setInterval(() => {
        onProgress({ scope: 'route-health', completed: completed.size, total: agents.length + 1, elapsedMs: Date.now() - startedAt });
    }, 30_000);
    let scopeResults;
    let lead;
    try {
        scopeResults = await Promise.all(agents.map(async (agent) => {
            const model = routes.get(agent);
            if (!registered.has(model)) {
                completed.add(agent);
                return { agent, model, validation: { valid: false, verdict: '', reasons: ['model-not-registered'], report: '' }, attempts: [], exitReason: 'INFRASTRUCTURE_ERROR' };
            }
            try {
                return await runCouncilAgentCli({ repositoryRoot, agent, prompt: LIVE_SMOKE_PROMPT, timeoutMs, ...(run ? { run } : {}) });
            } finally {
                completed.add(agent);
            }
        }));
        const leadModel = routes.get('council-lead');
        lead = registered.has(leadModel)
            ? await runCouncilAgentCli({ repositoryRoot, agent: 'council-lead', prompt: LEAD_HEALTH_PROMPT, timeoutMs, ...(run ? { run } : {}) })
            : { agent: 'council-lead', model: leadModel, valid: false, reasons: ['model-not-registered'], attempts: [], exitReason: 'INFRASTRUCTURE_ERROR' };
        completed.add('council-lead');
    } finally {
        clearInterval(progress);
    }
    const results = scopeResults.map((result) => {
        let structured = false;
        if (result.validation.valid) {
            try {
                structured = extractResearchManifest(result.validation.report).findings.length === 0;
            } catch {
                structured = false;
            }
        }
        return {
            agent: result.agent,
            model: result.model,
            valid: result.validation.valid && structured && result.validation.verdict === 'CLEAN',
            verdict: result.validation.verdict,
            reasons: structured ? result.validation.reasons : [...result.validation.reasons, 'invalid-findings-manifest'],
            attempts: result.attempts.length,
            timedOut: result.timedOut,
            durationMs: result.attempts.reduce((sum, attempt) => sum + Number(attempt.durationMs || 0), 0),
            exitReason: result.exitReason,
            modelStarted: result.validation.runtime?.modelStarted ?? false,
            fallbackDetected: result.validation.reasons.includes('runtime-fallback') || result.validation.reasons.includes('model-route-mismatch'),
        };
    });
    const validRuns = results.filter(({ valid }) => valid).length;
    const leadHealthy = lead.valid === true;
    return {
        passed: validRuns >= 4 && leadHealthy,
        validRuns,
        requiredValidRuns: 4,
        distinctValidRoutes: new Set(results.filter(({ valid }) => valid).map(({ model }) => model)).size,
        leadHealthy,
        lead: {
            agent: lead.agent,
            model: lead.model,
            valid: leadHealthy,
            reasons: lead.reasons,
            attempts: lead.attempts.length,
            timedOut: lead.timedOut,
            durationMs: lead.durationMs,
            exitReason: lead.exitReason,
            modelStarted: lead.validation?.runtime?.modelStarted ?? false,
            fallbackDetected: lead.reasons?.includes('runtime-fallback') || lead.reasons?.includes('model-route-mismatch') || false,
        },
        durationMs: Date.now() - startedAt,
        results,
    };
}

async function main() {
    const timeoutMs = Number.parseInt(process.env.COUNCIL_LIVE_SMOKE_TIMEOUT_MS || '300000', 10);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('COUNCIL_LIVE_SMOKE_TIMEOUT_MS must be a positive integer');
    const result = await runCouncilLiveSmoke({
        timeoutMs,
        onProgress: (progress) => process.stderr.write(`PROGRESS ${JSON.stringify(progress)}\n`),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
