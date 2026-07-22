import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

const STATE_DIR = join(tmpdir(), 'opencode');
const STATE_FILE = join(STATE_DIR, 'code-council-loop-state.json');
const requestedIterations = process.env.COUNCIL_MAX_ITERATIONS
    ? Number.parseInt(process.env.COUNCIL_MAX_ITERATIONS, 10)
    : 3;
const MAX_REPAIR_ROUNDS = Number.isInteger(requestedIterations)
    ? Math.min(2, Math.max(0, requestedIterations - 1))
    : 2;
const MAX_ITERATIONS = MAX_REPAIR_ROUNDS + 1;

const SCOPES = ['arch', 'refactor', 'review', 'sec', 'test', 'perf'];

function nowISO() { return new Date().toISOString(); }

function ensureStateDir() {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function loadState() {
    if (!existsSync(STATE_FILE)) return null;
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
    ensureStateDir();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function initState(task) {
    return {
        task,
        startedAt: nowISO(),
        iteration: 0,
        history: [],
        converged: false,
        exitReason: '',
        activeScopes: [...SCOPES],
    };
}

function gitDiffStat() {
    try {
        const out = execFileSync('git', ['diff', '--numstat', 'HEAD'], { encoding: 'utf8' });
        const rows = out.trim().split(/\r?\n/).filter(Boolean);
        let added = 0;
        let removed = 0;
        const diffFiles = [];
        for (const row of rows) {
            const [addedText, removedText, ...fileParts] = row.split('\t');
            const file = fileParts.join('\t');
            if (file) diffFiles.push(file);
            if (/^\d+$/.test(addedText)) added += Number.parseInt(addedText, 10);
            if (/^\d+$/.test(removedText)) removed += Number.parseInt(removedText, 10);
        }
        return { files: diffFiles.length, added, removed, diffFiles };
    } catch {
        return { files: 0, added: 0, removed: 0, diffFiles: [] };
    }
}

function runBuild() {
    try {
        execSync('npm run build', { encoding: 'utf8', timeout: 120_000, stdio: 'pipe' });
        return { passed: true, output: '' };
    } catch (e) {
        return { passed: false, output: e.stderr?.toString() || e.message };
    }
}

function runTests() {
    try {
        execSync('npm run test:contract:fast', { encoding: 'utf8', timeout: 180_000, stdio: 'pipe' });
        return { passed: true, output: '' };
    } catch (e) {
        return { passed: false, output: e.stderr?.toString() || e.message };
    }
}

function parseOpenFindings(value) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) throw new TypeError('Findings JSON muss ein Array sein.');
        return parsed.filter((finding) => finding && typeof finding === 'object');
    } catch (error) {
        throw new Error(`Ungültiges Findings JSON: ${error.message}`);
    }
}

function isConfirmedFinding(finding) {
    return finding.verified === true
        || (finding.verifyRun1 === 'TRUE' && finding.verifyRun2 === 'TRUE');
}

function confirmedActionableFindings(entry) {
    return (entry.openFindings || []).filter((finding) =>
        (finding.severity === '🔴' || finding.severity === '🟠')
        && isConfirmedFinding(finding));
}

function buildFeedbackContext(history) {
    if (history.length === 0) return '';
    const prev = history[history.length - 1];
    const lines = [
        `## Feedback aus Iteration ${prev.iteration}`,
        `### Build: ${prev.buildPassed ? 'PASSED' : 'FAILED'}`,
    ];
    const confirmed = confirmedActionableFindings(prev);
    if (confirmed.length > 0) {
        lines.push('### Doppelt bestätigte 🔴/🟠-Findings:');
        for (const f of confirmed) {
            lines.push(`- [${f.scope}] [${f.file}:${f.line}] ${f.problem}`);
        }
    }
    lines.push(`### Änderungsstatistik: ${prev.filesChanged} Dateien, +${prev.linesAdded}/-${prev.linesRemoved} Lines`);
    return lines.join('\n');
}

function checkOscillation(history) {
    if (history.length < 2) return false;
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    if (!last.diffFiles || !prev.diffFiles) return false;
    const sameFiles = last.diffFiles.length === prev.diffFiles.length
        && last.diffFiles.every((f) => prev.diffFiles.includes(f));
    const oscillation = last.findings.critical === prev.findings.critical
        && last.findings.major === prev.findings.major;
    return sameFiles && oscillation;
}

function checkConvergence(history) {
    const last = history[history.length - 1];
    if (!last) return { exit: false };

    const actionable = confirmedActionableFindings(last);
    if (last.buildPassed && last.testsPassed && actionable.length === 0) {
        return { exit: true, reason: 'early_pass' };
    }
    if (history.length >= 2) {
        const prev = history[history.length - 2];
        const previousActionableCount = confirmedActionableFindings(prev).length;
        if (actionable.length >= previousActionableCount && actionable.length > 0) {
            return { exit: true, reason: 'stagnation' };
        }
    }
    if (checkOscillation(history)) {
        return { exit: true, reason: 'oscillation_detected' };
    }
    return { exit: false };
}

function printPrompt(iteration, feedbackContext, activeScopes) {
    const skipList = SCOPES.filter((s) => !activeScopes.includes(s));
    const skipNote = skipList.length > 0
        ? `\nÜBERSPRINGE Scopes (0 Delta in Vorrunde): ${skipList.join(', ')}`
        : '';
    const reviewInstruction = iteration === 1
        ? 'Vollständiges Council-Review (30 Reviews).'
        : 'Fokussiertes Re-Review: je aktivem Scope nur der zuständige Fach-Reviewer; danach council-verify zweimal unabhängig.';
    const planFocus = iteration === 1
        ? 'Erstelle einen vollständigen Plan.'
        : 'Plane und repariere NUR die doppelt bestätigten 🔴/🟠-Findings aus dem Feedback-Kontext.';

    process.stdout.write(`
=== CODING COUNCIL ITERATION ${iteration} ===
${'-'.repeat(40)}
${feedbackContext}
${'-'.repeat(40)}
INSTRUKTIONEN:
- ${planFocus}
- Fokussiere auf Dateien aus vorherigen Findings.
- ${reviewInstruction}
- Reparaturrunde ${Math.max(0, iteration - 1)} von ${MAX_REPAIR_ROUNDS}; keine neue Architekturentscheidung und keine parallelen Schreibzugriffe.
${skipNote}
AKTIVE SCOPES: ${activeScopes.join(' → ')}
${'-'.repeat(40)}
`);
}

function printReport(state) {
    const h = state.history;
    process.stdout.write(`
${'='.repeat(60)}
CODING COUNCIL LOOP — ABSCHLUSS
${'='.repeat(60)}
Grund: ${state.exitReason || 'N/A'}
Iterationen: ${h.length}

Metriken:
${'Iteration'.padEnd(10)} ${'🔴'.padEnd(5)} ${'🟠'.padEnd(5)} ${'🟡'.padEnd(5)} ${'Build'.padEnd(8)} ${'Files'.padEnd(7)} ±Lines
${'-'.repeat(60)}
`);
    for (const entry of h) {
        const line = `${String(entry.iteration).padEnd(10)} ${String(entry.findings.critical).padEnd(5)} ${String(entry.findings.major).padEnd(5)} ${String(entry.findings.minor).padEnd(5)} ${(entry.buildPassed ? 'PASSED' : 'FAILED').padEnd(8)} ${String(entry.filesChanged).padEnd(7)} +${entry.linesAdded}/-${entry.linesRemoved}`;
        process.stdout.write(line + '\n');
    }

    if (h.length >= 2) {
        const first = h[0];
        const last = h[h.length - 1];
        process.stdout.write(`
Trend:
🔴: ${first.findings.critical} → ${last.findings.critical} (Δ${first.findings.critical - last.findings.critical})
🟠: ${first.findings.major} → ${last.findings.major} (Δ${first.findings.major - last.findings.major})
🟡: ${first.findings.minor} → ${last.findings.minor} (Δ${first.findings.minor - last.findings.minor})
`);
    }

    process.stdout.write(`State-Datei: ${STATE_FILE}\n`);
}

const command = process.argv[2];
const task = process.argv[3] || '';

switch (command) {
    case 'init': {
        const state = initState(task);
        saveState(state);
        process.stdout.write(`State initialisiert: Iteration 0\nDatei: ${STATE_FILE}\n`);
        break;
    }

    case 'next': {
        const state = loadState();
        if (!state) { process.stderr.write('Kein State. Führe zuerst "init" aus.\n'); process.exit(1); }
        if (state.converged) { process.stderr.write(`Bereits konvergiert: ${state.exitReason}\n`); process.exit(0); }

        if (state.history.length > 0) {
            const conv = checkConvergence(state.history);
            if (conv.exit) {
                state.converged = true;
                state.exitReason = conv.reason;
                saveState(state);
                printReport(state);
                process.exit(0);
            }
        }

        state.iteration += 1;

        if (state.iteration > MAX_ITERATIONS) {
            state.converged = true;
            state.exitReason = 'max_iterations';
            saveState(state);
            printReport(state);
            process.exit(0);
        }

        const feedbackContext = buildFeedbackContext(state.history);
        printPrompt(state.iteration, feedbackContext, state.activeScopes);
        saveState(state);
        break;
    }

    case 'record': {
        const state = loadState();
        if (!state) { process.stderr.write('Kein State.\n'); process.exit(1); }

        const critical = parseInt(process.argv[3] || '0', 10);
        const major = parseInt(process.argv[4] || '0', 10);
        const minor = parseInt(process.argv[5] || '0', 10);
        const findings = { critical, major, minor };
        let openFindings;
        try {
            openFindings = parseOpenFindings(process.argv[6] || process.env.COUNCIL_FINDINGS_JSON || '');
        } catch (error) {
            process.stderr.write(`${error.message}\n`);
            process.exit(1);
        }
        const diff = gitDiffStat();
        const build = runBuild();
        const tests = runTests();

        state.history.push({
            iteration: state.iteration,
            buildPassed: build.passed,
            testsPassed: tests.passed,
            findings,
            openFindings,
            filesChanged: diff.files,
            linesAdded: diff.added,
            linesRemoved: diff.removed,
            diffFiles: diff.diffFiles,
            timestamp: nowISO(),
        });

        const repairScopes = [...new Set(openFindings
            .filter((finding) =>
                (finding.severity === '🔴' || finding.severity === '🟠')
                && isConfirmedFinding(finding)
                && SCOPES.includes(finding.scope))
            .map((finding) => finding.scope))];
        if (repairScopes.length > 0) state.activeScopes = repairScopes;

        const conv = checkConvergence(state.history);
        if (conv.exit) {
            state.converged = true;
            state.exitReason = conv.reason;
        }

        saveState(state);
        process.stdout.write(`Iteration ${state.iteration} aufgezeichnet. Build: ${build.passed ? 'PASSED' : 'FAILED'}. Tests: ${tests.passed ? 'PASSED' : 'FAILED'}. 🔴: ${findings.critical}\n`);
        if (state.converged) {
            process.stdout.write(`KONVERGIERT: ${state.exitReason}\n`);
            printReport(state);
        } else {
            process.stdout.write(`Nächste Iteration: ${state.iteration + 1}\n`);
        }
        break;
    }

    case 'report': {
        const state = loadState();
        if (!state) { process.stderr.write('Kein State.\n'); process.exit(1); }
        printReport(state);
        break;
    }

    case 'reset': {
        if (existsSync(STATE_FILE)) {
            const { unlinkSync } = await import('node:fs');
            unlinkSync(STATE_FILE);
        }
        process.stdout.write('State gelöscht.\n');
        break;
    }

    default: {
        process.stdout.write(`Council Loop Runner

Verwendung:
  node scripts/council-runner.mjs init "<Aufgabenbeschreibung>"
  node scripts/council-runner.mjs next
  node scripts/council-runner.mjs record <critical> <major> <minor> '[{"severity":"🔴","scope":"review","file":"src/example.js","line":1,"problem":"...","verifyRun1":"TRUE","verifyRun2":"TRUE"}]'
  node scripts/council-runner.mjs report
  node scripts/council-runner.mjs reset

Umgebungsvariablen:
  COUNCIL_MAX_ITERATIONS=3  (default: Erstdurchlauf + 2 Reparaturrunden)
  COUNCIL_FINDINGS_JSON='[...]'  (Alternative zum letzten record-Argument)
`);
    }
}
