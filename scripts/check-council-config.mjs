import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AGENT_DIR = join(ROOT, '.opencode', 'agents');
const COMMAND_DIR = join(ROOT, '.opencode', 'commands');
const CONFIG_PATH = join(ROOT, '.opencode', 'council-models.json');
const SCOPES = ['review', 'arch', 'sec', 'perf', 'test', 'refactor'];
const SIBLINGS = ['fb', 'fb2', 'fb3', 'fb4'];
const errors = [];

function read(path) {
    return readFileSync(path, 'utf8');
}

function frontmatter(path) {
    const text = read(path);
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
        errors.push(`${path}: missing YAML frontmatter`);
        return {};
    }

    const values = {};
    for (const line of match[1].split(/\r?\n/)) {
        const field = line.match(/^([a-zA-Z][\w-]*):\s*(.+)$/);
        if (field) values[field[1]] = field[2].trim();
    }
    return values;
}

function expect(condition, message) {
    if (!condition) errors.push(message);
}

const config = JSON.parse(read(CONFIG_PATH));
expect(!Object.hasOwn(config, '$schema'), `${CONFIG_PATH}: dangling $schema is not allowed`);

const primaryAgents = Object.entries(config.readOnlyCouncil?.primary ?? {})
    .filter(([, value]) => value && typeof value === 'object')
    .map(([name]) => name);
for (const name of primaryAgents) {
    const path = join(AGENT_DIR, `${name}.md`);
    const metadata = frontmatter(path);
    const text = read(path);
    expect(metadata.mode === 'primary', `${path}: directly invoked Council agent must use mode primary`);
    expect(metadata.model === config.readOnlyCouncil.primary[name].model, `${path}: model ${metadata.model ?? '<missing>'} does not match central route ${config.readOnlyCouncil.primary[name].model}`);
    expect(/\n\s*edit:\s*deny\b/.test(text), `${path}: edit permission must be deny`);
    expect(/\n\s*bash:\s*deny\b/.test(text), `${path}: bash permission must be deny`);
    expect(/\n\s*task:\s*deny\b/.test(text), `${path}: task permission must be deny`);
    expect(/Ein leerer Glob-Treffer beweist niemals/.test(text), `${path}: hidden-path discovery guard missing`);
}

const configuredFreeModels = new Set(config.freeModels?.models ?? []);
for (const scope of SCOPES) {
    const configured = config.readOnlyCouncil?.fbSiblings?.[`council-${scope}`];
    expect(Boolean(configured), `${CONFIG_PATH}: missing council-${scope} sibling mapping`);
    if (!configured) continue;

    const distinctModels = new Set();
    for (const sibling of SIBLINGS) {
        const name = `council-${scope}-${sibling}`;
        const path = join(AGENT_DIR, `${name}.md`);
        const metadata = frontmatter(path);
        const configuredModel = configured[sibling];
        const expectedModel = `opencode/${configuredModel}`;

        expect(metadata.mode === 'all', `${path}: mode must be all for CLI and task dispatch`);
        expect(metadata.model === expectedModel, `${path}: model ${metadata.model ?? '<missing>'} does not match ${expectedModel}`);
        expect(configuredFreeModels.has(configuredModel), `${CONFIG_PATH}: ${configuredModel} is not listed in freeModels`);
        distinctModels.add(configuredModel);

        const text = read(path);
        expect(/\n\s*edit:\s*deny\b/.test(text), `${path}: edit permission must be deny`);
        expect(/\n\s*bash:\s*deny\b/.test(text), `${path}: bash permission must be deny`);
        expect(/\n\s*task:\s*deny\b/.test(text), `${path}: task permission must be deny`);
    }
    expect(distinctModels.size === SIBLINGS.length, `${CONFIG_PATH}: council-${scope} siblings must use four distinct models`);

    const baseAgent = read(join(AGENT_DIR, `council-${scope}.md`));
    expect(/VERBINDLICHES FINDING-GATE/.test(baseAgent), `council-${scope}.md: adversarial finding gate missing`);
    expect(/Ausgangszustand → Aufrufstelle → fehlerhafte Operation → sichtbare Produktauswirkung/.test(baseAgent), `council-${scope}.md: reachable product path evidence missing`);
    expect(/DEFENSIVE/.test(baseAgent) && /INTENTIONAL/.test(baseAgent), `council-${scope}.md: defensive and intentional classifications missing`);
}

const planPath = join(AGENT_DIR, 'plan.md');
expect(frontmatter(planPath).mode === 'all', `${planPath}: mode must be all for CLI and task dispatch`);

const deepSeekPath = join(AGENT_DIR, 'deepseek-v4-pro.md');
const deepSeekMetadata = frontmatter(deepSeekPath);
const deepSeekText = read(deepSeekPath);
const deepSeekConfig = config.supportAgents?.['deepseek-v4-pro'];
expect(deepSeekMetadata.mode === 'subagent', `${deepSeekPath}: mode must be subagent for isolated OpenCode dispatch`);
expect(deepSeekMetadata.model === 'opencode-go/deepseek-v4-pro', `${deepSeekPath}: exact DeepSeek V4 Pro route is required`);
expect(deepSeekConfig?.model === deepSeekMetadata.model, `${CONFIG_PATH}: DeepSeek route must match its agent frontmatter`);
expect(deepSeekConfig?.mode === deepSeekMetadata.mode, `${CONFIG_PATH}: DeepSeek mode must match its agent frontmatter`);
expect(deepSeekConfig?.task === 'deny', `${CONFIG_PATH}: DeepSeek may not delegate to another LLM`);
expect(/\n\s*edit:\s*deny\b/.test(deepSeekText), `${deepSeekPath}: detection must be read-only by default`);
expect(/\n\s*task:\s*deny\b/.test(deepSeekText), `${deepSeekPath}: task permission must be deny`);
expect(!/council-(?:review|arch|sec|perf|test|refactor|lead|verify)/i.test(deepSeekText), `${deepSeekPath}: DeepSeek worker may not reference Council agents`);
const deepSeekCommandPath = join(COMMAND_DIR, 'deepseek-v4-pro.md');
const deepSeekCommandMetadata = frontmatter(deepSeekCommandPath);
expect(deepSeekCommandMetadata.agent === 'deepseek-v4-pro', `${deepSeekCommandPath}: exact DeepSeek agent is required`);
expect(deepSeekCommandMetadata.subtask === 'true', `${deepSeekCommandPath}: subtask must be true`);
expect(deepSeekCommandMetadata.model === 'opencode-go/deepseek-v4-pro', `${deepSeekCommandPath}: exact DeepSeek command route is required`);

const allowedApproaches = {
    primary: new Set(['Ausgewogen']),
    alt1: new Set(['Robustheit', 'Defensiv']),
    alt2: new Set(['Minimalismus', 'Durchsatz']),
};
for (const scope of SCOPES) {
    for (const variant of ['primary', 'alt1', 'alt2']) {
        const suffix = variant === 'primary' ? '' : `-${variant}`;
        const path = join(AGENT_DIR, `council-code-${scope}${suffix}.md`);
        const metadata = frontmatter(path);
        const approach = read(path).match(/^## Ansatz:\s*(.+)$/m)?.[1].trim();
        expect(metadata.mode === 'subagent', `${path}: Coding Council agents must use mode subagent`);
        const text = read(path);
        expect(/\n\s*edit:\s*allow\b/.test(text), `${path}: edit permission must be allow`);
        expect(/\n\s*bash:\s*allow\b/.test(text), `${path}: bash permission must be allow`);
        expect(/\n\s*task:\s*allow\b/.test(text), `${path}: task permission must be allow`);
        expect(allowedApproaches[variant].has(approach), `${path}: invalid ${variant} approach label ${approach ?? '<missing>'}`);
    }
}

const proposalPath = join(AGENT_DIR, 'council-code-proposal.md');
const proposalMetadata = frontmatter(proposalPath);
const proposalText = read(proposalPath);
expect(proposalMetadata.mode === 'subagent', `${proposalPath}: proposal agent must use mode subagent`);
expect(/\n\s*edit:\s*deny\b/.test(proposalText), `${proposalPath}: proposal edit permission must be deny`);
expect(/\n\s*bash:\s*deny\b/.test(proposalText), `${proposalPath}: proposal bash permission must be deny`);
expect(/\n\s*task:\s*deny\b/.test(proposalText), `${proposalPath}: proposal task permission must be deny`);
expect(config.codingCouncil?.proposalAgent?.name === 'council-code-proposal', `${CONFIG_PATH}: proposal agent mapping is missing`);

for (const file of ['code-council.md', 'code-council-loop.md', 'code-council-scope-loop.md']) {
    const path = join(COMMAND_DIR, file);
    const text = read(path);
    expect(!/git\s+checkout\s+--/i.test(text), `${path}: destructive git checkout revert is forbidden`);
    expect(!/git\s+clean\b/i.test(text), `${path}: destructive git clean is forbidden`);
}

const loopCommand = read(join(COMMAND_DIR, 'code-council-loop.md'));
expect(/Build PASSED UND Tests PASSED UND keine doppelt bestätigten/.test(loopCommand), 'code-council-loop.md: early pass must require build, tests, and no doubly confirmed actionable findings');
expect(/maximal zwei Reparaturrunden/.test(loopCommand), 'code-council-loop.md: repair loop must have a hard two-round limit');
expect(/Reviews anhand des maschinellen Risiko-Plans/.test(loopCommand), 'code-council-loop.md: repair rounds must use risk-based specialist review');
expect(/Verbindliches Finding-Schema/.test(loopCommand), 'code-council-loop.md: validated finding schema is required');
expect(/repair_budget_exceeded/.test(loopCommand), 'code-council-loop.md: repair budget exit must be documented');
expect(/regression_introduced/.test(loopCommand), 'code-council-loop.md: regression exit must be documented');

const scopeLoopCommand = read(join(COMMAND_DIR, 'code-council-scope-loop.md'));
expect(/--command code-council-scope-loop/.test(scopeLoopCommand), 'code-council-scope-loop.md: non-interactive dispatch must use --command');
expect(/--auto --dir/.test(scopeLoopCommand), 'code-council-scope-loop.md: temp-state dispatch must document explicit permission');
expect(/Fallback-Warnungen/.test(scopeLoopCommand), 'code-council-scope-loop.md: default-agent fallbacks must invalidate the run');
expect(/fünf Minuten/.test(scopeLoopCommand) && /15 Minuten/.test(scopeLoopCommand), 'code-council-scope-loop.md: phase and total timeouts must be bounded');

const leadAgent = read(join(AGENT_DIR, 'council-lead.md'));
expect(/Die allererste Ausgabezeile MUSS exakt/.test(leadAgent), 'council-lead.md: first-line VERDICT contract missing');
expect(/VERDICT: CLEAN\|ISSUES_FOUND\|NEEDS_DATA\|UNCERTAIN/.test(leadAgent), 'council-lead.md: VERDICT values missing');
expect(/weniger als 4 gültigen Läufen/.test(leadAgent), 'council-lead.md: incomplete redundancy must keep findings as candidates');
expect(/Nur `BUG \+ BUG`/.test(leadAgent), 'council-lead.md: final severity must require two BUG verifications');

const verifyAgent = read(join(AGENT_DIR, 'council-verify.md'));
expect(/Die allererste Ausgabezeile MUSS exakt/.test(verifyAgent), 'council-verify.md: first-line VERDICT contract missing');
expect(/VERDICT: VERIFIED\|REJECTED\|UNCERTAIN/.test(verifyAgent), 'council-verify.md: VERDICT values missing');
expect(/BUG\/DEFENSIVE\/INTENTIONAL\/FALSE\/UNCERTAIN/.test(verifyAgent), 'council-verify.md: adversarial result classes missing');
expect(/alle produktiven Caller/.test(verifyAgent), 'council-verify.md: caller traversal missing');
expect(/Initialisierungs-, Restart- und Dispose-Reihenfolge/.test(verifyAgent), 'council-verify.md: lifecycle traversal missing');
const verifyFbAgent = read(join(AGENT_DIR, 'council-verify-fb.md'));
expect(/BUG.*DEFENSIVE.*INTENTIONAL.*FALSE.*UNCERTAIN/s.test(verifyFbAgent), 'council-verify-fb.md: adversarial result classes missing');
expect(config.readOnlyCouncil.primary['council-verify'].model !== config.readOnlyCouncil.primary['council-verify-fb'].model, `${CONFIG_PATH}: verify routes must use different models`);

const codeCouncilCommand = read(join(COMMAND_DIR, 'code-council.md'));
expect(/council-verify` und `council-verify-fb` parallel/.test(codeCouncilCommand), 'code-council.md: independent verification routes must run in parallel');
expect(/council-code-proposal/.test(codeCouncilCommand), 'code-council.md: read-only proposal agent is required');
expect(/council:runner:scope-start/.test(codeCouncilCommand) && /council:runner:scope-record/.test(codeCouncilCommand), 'code-council.md: machine-tracked scope deltas are required');
expect(/council:runner:implementation-plan/.test(codeCouncilCommand), 'code-council.md: risk-based implementation plan is required');
expect(/council:runner:review-plan/.test(codeCouncilCommand), 'code-council.md: risk-based review plan is required');
expect(/BEGRENZTER REPAIR-LOOP \(maximal zwei Reparaturrunden\)/.test(codeCouncilCommand), 'code-council.md: bounded repair loop is required');
expect((codeCouncilCommand.match(/npm run --silent council:agent/g) ?? []).length >= 4, 'code-council.md: every direct Council phase must use the bounded wrapper');
const benchmarkCodingCommand = read(join(COMMAND_DIR, 'council-benchmark-coding.md'));
expect((benchmarkCodingCommand.match(/npm run --silent council:agent/g) ?? []).length >= 2, 'council-benchmark-coding.md: read-only Council and lead must use the bounded wrapper');

const baselineScript = read(join(ROOT, 'scripts', 'council-baseline.mjs'));
const perfScript = read(join(ROOT, 'scripts', 'council-perf-run.mjs'));
expect(/COUNCIL_RUN_ID/.test(baselineScript) && /REPOSITORY_ID/.test(baselineScript), 'council-baseline.mjs: performance snapshots must be isolated by repository and run');
expect(/RAW_JSON/.test(perfScript) && /JSON\.stringify\(report\)/.test(perfScript), 'council-perf-run.mjs: --raw must emit parseable JSON');

const preflightText = read(join(AGENT_DIR, 'council-preflight.md'));
for (const model of configuredFreeModels) {
    expect(preflightText.includes(model), `${join(AGENT_DIR, 'council-preflight.md')}: missing configured free model ${model}`);
}

const agentsInstructions = read(join(ROOT, '.opencode', 'AGENTS.md'));
expect(
    agentsInstructions.includes('npm run --silent council:agent -- <council-agent>'),
    '.opencode/AGENTS.md: direct Council invocation must use the bounded wrapper',
);
expect(agentsInstructions.includes('npm run council:validate'), '.opencode/AGENTS.md: Council changes must require the live validation gate');
expect(/`@council-verify` und `@council-verify-fb`/.test(agentsInstructions), '.opencode/AGENTS.md: both independent verify routes are required');
expect(/`BUG \+ BUG`/.test(agentsInstructions), '.opencode/AGENTS.md: only double BUG may confirm a finding');
expect(
    read(join(ROOT, 'AGENTS.md')).includes('.opencode/AGENTS.md'),
    'AGENTS.md: root instructions must point to the Council rules',
);

const hardeningRunner = read(join(ROOT, 'scripts', 'council-hardening-runner.mjs'));
expect(/'--agent', agent, '--model', model/.test(hardeningRunner), 'council-hardening-runner.mjs: OpenCode Council process must receive explicit --model');
const benchmarkCouncil = read(join(ROOT, 'scripts', 'council-benchmark-opencode.mjs'));
expect(!/runAgentWithRetry/.test(benchmarkCouncil), 'council-benchmark-opencode.mjs: benchmark must not bypass the Council wrapper');
expect(/runCouncilAgentCli/.test(benchmarkCouncil), 'council-benchmark-opencode.mjs: benchmark must use the Council wrapper');
const liveSmoke = read(join(ROOT, 'scripts', 'council-live-smoke.mjs'));
expect(/runCouncilAgentCli/.test(liveSmoke), 'council-live-smoke.mjs: live smoke must use the Council wrapper');

if (errors.length > 0) {
    process.stderr.write(`Council configuration check failed (${errors.length}):\n`);
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exit(1);
}

process.stdout.write(`Council configuration check passed: ${SCOPES.length * SIBLINGS.length} siblings validated.\n`);
