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
    expect(/\n\s*edit:\s*deny\b/.test(text), `${path}: edit permission must be deny`);
    expect(/\n\s*bash:\s*deny\b/.test(text), `${path}: bash permission must be deny`);
    expect(/\n\s*task:\s*deny\b/.test(text), `${path}: task permission must be deny`);
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
}

const planPath = join(AGENT_DIR, 'plan.md');
expect(frontmatter(planPath).mode === 'all', `${planPath}: mode must be all for CLI and task dispatch`);

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

for (const file of ['code-council.md', 'code-council-loop.md', 'code-council-scope-loop.md']) {
    const path = join(COMMAND_DIR, file);
    const text = read(path);
    expect(!/git\s+checkout\s+--/i.test(text), `${path}: destructive git checkout revert is forbidden`);
    expect(!/git\s+clean\b/i.test(text), `${path}: destructive git clean is forbidden`);
}

const loopCommand = read(join(COMMAND_DIR, 'code-council-loop.md'));
expect(/Build PASSED UND Tests PASSED UND keine doppelt bestätigten/.test(loopCommand), 'code-council-loop.md: early pass must require build, tests, and no doubly confirmed actionable findings');
expect(/maximal zwei Reparaturrunden/.test(loopCommand), 'code-council-loop.md: repair loop must have a hard two-round limit');
expect(/zuständige Fach-Reviewer/.test(loopCommand), 'code-council-loop.md: repair rounds must use focused specialist review');
expect(/Verbindliches Finding-Schema/.test(loopCommand), 'code-council-loop.md: validated finding schema is required');
expect(/repair_budget_exceeded/.test(loopCommand), 'code-council-loop.md: repair budget exit must be documented');
expect(/regression_introduced/.test(loopCommand), 'code-council-loop.md: regression exit must be documented');

const scopeLoopCommand = read(join(COMMAND_DIR, 'code-council-scope-loop.md'));
expect(/--command code-council-scope-loop/.test(scopeLoopCommand), 'code-council-scope-loop.md: non-interactive dispatch must use --command');
expect(/--auto --dir/.test(scopeLoopCommand), 'code-council-scope-loop.md: temp-state dispatch must document explicit permission');
expect(/Fallback-Warnungen/.test(scopeLoopCommand), 'code-council-scope-loop.md: default-agent fallbacks must invalidate the run');
expect(/fünf Minuten/.test(scopeLoopCommand) && /15 Minuten/.test(scopeLoopCommand), 'code-council-scope-loop.md: phase and total timeouts must be bounded');

const codeCouncilCommand = read(join(COMMAND_DIR, 'code-council.md'));
expect(/council-verify ZWEIMAL parallel/.test(codeCouncilCommand), 'code-council.md: redundant verification must run twice in parallel');
expect(/BEGRENZTER REPAIR-LOOP \(maximal zwei Reparaturrunden\)/.test(codeCouncilCommand), 'code-council.md: bounded repair loop is required');

const preflightText = read(join(AGENT_DIR, 'council-preflight.md'));
for (const model of configuredFreeModels) {
    expect(preflightText.includes(model), `${join(AGENT_DIR, 'council-preflight.md')}: missing configured free model ${model}`);
}

const agentsInstructions = read(join(ROOT, 'AGENTS.md'));
expect(
    agentsInstructions.includes('opencode run --dir "<repo-root>" --agent'),
    'AGENTS.md: direct Council invocation must pin the repository with --dir',
);

if (errors.length > 0) {
    process.stderr.write(`Council configuration check failed (${errors.length}):\n`);
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exit(1);
}

process.stdout.write(`Council configuration check passed: ${SCOPES.length * SIBLINGS.length} siblings validated.\n`);
