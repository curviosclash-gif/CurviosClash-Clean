import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
    COUNCIL_SCOPES,
    MAX_REPAIR_ROUNDS,
    classifyLoopState,
    confirmedActionableFindings,
    detectNewRegression,
    diffSnapshotFiles,
    evaluateRepairBudget,
    parseFindingsJson,
    selectGateCommands,
    selectRepairScopes,
} from './council-loop-policy.mjs';

const DEFAULT_STATE_DIR = join(tmpdir(), 'opencode');

function nowISO() { return new Date().toISOString(); }

function parseRequestedIterations(value) {
    const requested = value ? Number.parseInt(value, 10) : MAX_REPAIR_ROUNDS + 1;
    const repairRounds = Number.isInteger(requested)
        ? Math.min(MAX_REPAIR_ROUNDS, Math.max(0, requested - 1))
        : MAX_REPAIR_ROUNDS;
    return repairRounds + 1;
}

function defaultGit(args, options = {}) {
    return execFileSync('git', args, { encoding: 'utf8', ...options });
}

function hashFile(file, repositoryRoot, git = defaultGit) {
    if (!existsSync(path.join(repositoryRoot, file))) return '__deleted__';
    try {
        return git(['hash-object', '--', file], { cwd: repositoryRoot }).trim();
    } catch {
        return createHash('sha256').update(readFileSync(path.join(repositoryRoot, file))).digest('hex');
    }
}

export function captureWorkingTreeSnapshot(repositoryRoot, git = defaultGit) {
    const output = git(['ls-files', '--modified', '--others', '--exclude-standard'], { cwd: repositoryRoot });
    const files = output.split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll('\\', '/'));
    return Object.fromEntries(files.map((file) => [file, hashFile(file, repositoryRoot, git)]));
}

function readNameStatuses(repositoryRoot, git = defaultGit) {
    const output = git(['diff', '--name-status', 'HEAD'], { cwd: repositoryRoot });
    return output.split(/\r?\n/).filter(Boolean).map((line) => {
        const [status, ...files] = line.split('\t');
        return { status, file: files.at(-1)?.replaceAll('\\', '/') || '' };
    });
}

function readDiffStat(repositoryRoot, changedFiles, git = defaultGit) {
    if (changedFiles.length === 0) return { files: 0, added: 0, removed: 0, diffFiles: [] };
    const output = git(['diff', '--numstat', 'HEAD', '--', ...changedFiles], { cwd: repositoryRoot });
    let added = 0;
    let removed = 0;
    for (const row of output.split(/\r?\n/).filter(Boolean)) {
        const [addedText, removedText] = row.split('\t');
        if (/^\d+$/.test(addedText)) added += Number.parseInt(addedText, 10);
        if (/^\d+$/.test(removedText)) removed += Number.parseInt(removedText, 10);
    }
    return { files: changedFiles.length, added, removed, diffFiles: changedFiles };
}

function runSelectedGates(commands, repositoryRoot, execute = execSync) {
    const results = commands.map(({ kind, command }) => {
        try {
            execute(command, { cwd: repositoryRoot, encoding: 'utf8', timeout: 240_000, stdio: 'pipe' });
            return { kind, command, passed: true, output: '' };
        } catch (error) {
            return { kind, command, passed: false, output: error.stderr?.toString() || error.message };
        }
    });
    return {
        results,
        buildPassed: results.filter((result) => result.kind === 'build').every((result) => result.passed),
        testsPassed: results.filter((result) => result.kind === 'test').every((result) => result.passed),
    };
}

function validateReportedCounts(args, findings) {
    const reported = ['critical', 'major', 'minor'].map((_, index) => Number.parseInt(args[index] || '0', 10));
    if (reported.some((count) => !Number.isInteger(count) || count < 0)) throw new TypeError('Finding-Zähler müssen nichtnegative Ganzzahlen sein.');
    const actual = [
        findings.filter((finding) => finding.severity === '🔴').length,
        findings.filter((finding) => finding.severity === '🟠').length,
        findings.filter((finding) => finding.severity === '🟡').length,
    ];
    if (reported.some((count, index) => count !== actual[index])) {
        throw new TypeError(`Finding-Zähler stimmen nicht mit dem validierten JSON überein; erwartet ${actual.join(' ')}.`);
    }
    return { critical: actual[0], major: actual[1], minor: actual[2] };
}

function buildFeedbackContext(history) {
    const previous = history.at(-1);
    if (!previous) return '';
    const lines = [
        `## Feedback aus Iteration ${previous.iteration}`,
        `### Gates: ${previous.buildPassed && previous.testsPassed ? 'PASSED' : 'FAILED'}`,
        '### Doppelt bestätigte 🔴/🟠-Findings:',
    ];
    for (const finding of confirmedActionableFindings(previous)) {
        lines.push(`- ${finding.id} [${finding.scope}] [${finding.file}:${finding.line}-${finding.endLine}] ${finding.problem}`);
        lines.push(`  Evidence (${finding.evidence.type}): ${finding.evidence.detail}`);
    }
    lines.push(`### Council-Delta: ${previous.filesChanged} Dateien, +${previous.linesAdded}/-${previous.linesRemoved} Zeilen`);
    return lines.join('\n');
}

function printPrompt(state, write) {
    const repairRound = Math.max(0, state.iteration - 1);
    const isInitial = state.iteration === 1;
    write(`
=== CODING COUNCIL ITERATION ${state.iteration} ===
${buildFeedbackContext(state.history)}
INSTRUKTIONEN:
- ${isInitial ? 'Vollständiger Plan und vollständiges Council-Review.' : 'Nur die gelisteten, doppelt bestätigten Findings an ihrer belegten Ursache reparieren.'}
- ${isInitial ? '30 read-only Reviews.' : 'Je aktivem Scope ein Fach-Reviewer, danach zwei unabhängige Verify-Läufe.'}
- Reparaturrunde ${repairRound} von ${MAX_REPAIR_ROUNDS}; keine neue Architektur, Abhängigkeit, Contract-Änderung, Löschung oder Umbenennung.
AKTIVE SCOPES: ${state.activeScopes.join(' → ')}
`);
}

function printReport(state, write) {
    write(`CODING COUNCIL LOOP — ${state.exitReason || 'active'} nach ${state.history.length} aufgezeichneten Iterationen\n`);
    for (const entry of state.history) {
        write(`Iteration ${entry.iteration}: 🔴 ${entry.findings.critical}, 🟠 ${entry.findings.major}, 🟡 ${entry.findings.minor}, Build ${entry.buildPassed ? 'PASS' : 'FAIL'}, Tests ${entry.testsPassed ? 'PASS' : 'FAIL'}, Delta ${entry.filesChanged} Dateien\n`);
    }
}

export function createCouncilRunner({
    repositoryRoot = process.cwd(),
    stateDir = process.env.COUNCIL_STATE_DIR || DEFAULT_STATE_DIR,
    maxIterations = parseRequestedIterations(process.env.COUNCIL_MAX_ITERATIONS),
    git = defaultGit,
    execute = execSync,
    write = (value) => process.stdout.write(value),
    storage,
} = {}) {
    const stateFile = join(stateDir, 'code-council-loop-state.json');
    const defaultStorage = {
        load: () => existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null,
        save: (state) => {
            if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
            writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
        },
        reset: () => { if (existsSync(stateFile)) unlinkSync(stateFile); },
    };
    const stateStorage = storage || defaultStorage;
    const load = () => stateStorage.load();
    const save = (state) => stateStorage.save(state);

    return function run(argv) {
        const [command, ...args] = argv;
        if (command === 'init') {
            const snapshot = captureWorkingTreeSnapshot(repositoryRoot, git);
            save({ task: args[0] || '', startedAt: nowISO(), iteration: 0, history: [], converged: false, exitReason: '', activeScopes: [...COUNCIL_SCOPES], baselineSnapshot: snapshot, lastSnapshot: snapshot });
            write(`State initialisiert: ${stateFile}\n`);
            return 0;
        }
        if (command === 'reset') {
            stateStorage.reset();
            write('State gelöscht.\n');
            return 0;
        }

        const state = load();
        if (!state) throw new Error('Kein State. Führe zuerst "init" aus.');
        if (command === 'report') {
            printReport(state, write);
            return 0;
        }
        if (command === 'next') {
            if (state.converged) {
                printReport(state, write);
                return 0;
            }
            if (state.iteration >= maxIterations) {
                state.converged = true;
                state.exitReason = 'max_iterations';
                save(state);
                printReport(state, write);
                return 0;
            }
            state.iteration += 1;
            save(state);
            printPrompt(state, write);
            return 0;
        }
        if (command === 'record') {
            if (state.iteration < 1) throw new Error('Rufe vor record zuerst next auf.');
            const findings = parseFindingsJson(args[3] || process.env.COUNCIL_FINDINGS_JSON || '', { repositoryRoot });
            const counts = validateReportedCounts(args, findings);
            const currentSnapshot = captureWorkingTreeSnapshot(repositoryRoot, git);
            const changedFiles = diffSnapshotFiles(state.lastSnapshot, currentSnapshot);
            const diff = readDiffStat(repositoryRoot, changedFiles, git);
            const budget = evaluateRepairBudget({ iteration: state.iteration, findings, changedFiles, nameStatuses: readNameStatuses(repositoryRoot, git) });
            const commands = selectGateCommands(changedFiles, { final: confirmedActionableFindings({ openFindings: findings }).length === 0 });
            const gates = runSelectedGates(commands, repositoryRoot, execute);
            const verificationDisagreed = findings.some((finding) =>
                (finding.severity === '🔴' || finding.severity === '🟠') && finding.verifyRun1 !== finding.verifyRun2);
            const entry = {
                iteration: state.iteration,
                buildPassed: gates.buildPassed,
                testsPassed: gates.testsPassed,
                gateResults: gates.results,
                findings: counts,
                openFindings: findings,
                verificationDisagreed,
                regressionIntroduced: state.iteration > 1 && detectNewRegression(state.history, findings),
                budget,
                filesChanged: diff.files,
                linesAdded: diff.added,
                linesRemoved: diff.removed,
                diffFiles: diff.diffFiles,
                timestamp: nowISO(),
            };
            state.history.push(entry);
            state.lastSnapshot = currentSnapshot;
            state.activeScopes = selectRepairScopes(findings);
            const outcome = classifyLoopState(state.history);
            if (outcome.exit) {
                state.converged = true;
                state.exitReason = outcome.reason;
            }
            save(state);
            write(`Iteration ${state.iteration} aufgezeichnet: ${state.exitReason || 'repair_required'}\n`);
            return gates.buildPassed && gates.testsPassed && budget.passed ? 0 : 1;
        }
        throw new Error('Verwendung: council-runner.mjs <init|next|record|report|reset>');
    };
}

export function runCouncilCli(argv = process.argv.slice(2)) {
    try {
        return createCouncilRunner()(argv);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(runCouncilCli());
}
