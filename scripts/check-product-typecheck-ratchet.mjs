import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const rootDir = process.cwd();
const sourceRoots = ['src', 'electron', 'server', 'editor', 'prototypes/vehicle-lab'];
const baseline = JSON.parse(readFileSync(
    path.join(rootDir, 'scripts/architecture/product-typecheck-ratchet.json'),
    'utf8'
));
const baseConfig = JSON.parse(readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8'));
const converted = ts.convertCompilerOptionsFromJson({
    ...baseConfig.compilerOptions,
    allowJs: true,
    checkJs: true,
    noEmit: true,
    types: ['node'],
}, rootDir);
if (converted.errors.length > 0) {
    throw new Error('Unable to resolve product typecheck compiler options.');
}

const sourceFiles = [];
function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        if (entry.name === 'dist' || entry.name === 'node_modules') continue;
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            walk(absolutePath);
        } else if (entry.isFile() && /\.(?:cjs|mjs|js)$/i.test(entry.name)) {
            sourceFiles.push(absolutePath);
        }
    }
}
for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.join(rootDir, sourceRoot);
    if (existsSync(absoluteRoot)) walk(absoluteRoot);
}

// Ambiente Deklarationen gehoeren zu keinem Quellbaum, muessen dem Programm aber
// bekannt sein — sonst zaehlt der Ratchet Build-Zeit-Konstanten als echte Fehler.
const ambientDeclarationFiles = [
    'dev/vite/vite-build-globals.d.ts',
]
    .map((relativePath) => path.join(rootDir, relativePath))
    .filter((absolutePath) => existsSync(absolutePath));

const program = ts.createProgram([...sourceFiles, ...ambientDeclarationFiles], converted.options);
const diagnostics = ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
const REST_BUCKET = '*';

function formatDiagnostic(diagnostic) {
    const file = diagnostic.file
        ? path.relative(rootDir, diagnostic.file.fileName).replace(/\\/g, '/')
        : '<compiler>';
    const position = diagnostic.file && Number.isInteger(diagnostic.start)
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : null;
    const location = position ? `${file}:${position.line + 1}:${position.character + 1}` : file;
    return `- ${location} TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
}

function reportOverflow(bucket, count, budget, examples) {
    console.error(`Product typecheck ratchet failed: bucket ${bucket} has ${count} diagnostics, budget ${budget}.`);
    for (const diagnostic of examples.slice(0, 20)) {
        console.error(formatDiagnostic(diagnostic));
    }
}

// Altes Gesamtmass: nur noch fuer Baselines, die nicht auf Eimer umgestellt sind.
if (baseline.maxDiagnostics !== undefined) {
    const maxDiagnostics = Number(baseline.maxDiagnostics);
    if (!Number.isFinite(maxDiagnostics)) {
        throw new Error('Missing numeric maxDiagnostics in product typecheck ratchet.');
    }
    if (diagnostics.length > maxDiagnostics) {
        reportOverflow('total', diagnostics.length, maxDiagnostics, diagnostics);
        process.exit(1);
    }
    const status = diagnostics.length === maxDiagnostics ? 'at-baseline' : 'below-baseline';
    console.log(`Product typecheck ratchet passed: ${sourceFiles.length} files, ${diagnostics.length} diagnostics (${status}, baseline ${maxDiagnostics}).`);
    process.exit(0);
}

// Eimer-Mass: eine Gesamtzahl sagt nichts, solange drei JSDoc-Codes 90 % stellen und
// mit jedem neuen Objektliteral wachsen. Jeder budgetierte Code wird einzeln geprueft,
// alles Uebrige summiert gegen "*" — dort faellt echter neuer Fehlercode auf.
const budgets = baseline.budgets;
if (!budgets || typeof budgets !== 'object') {
    throw new Error('Missing budgets object in product typecheck ratchet.');
}
if (!Number.isFinite(Number(budgets[REST_BUCKET]))) {
    throw new Error(`Missing numeric "${REST_BUCKET}" budget in product typecheck ratchet.`);
}

const grouped = new Map();
for (const diagnostic of diagnostics) {
    const code = `TS${diagnostic.code}`;
    const bucket = Object.hasOwn(budgets, code) ? code : REST_BUCKET;
    let entry = grouped.get(bucket);
    if (!entry) {
        entry = [];
        grouped.set(bucket, entry);
    }
    entry.push(diagnostic);
}

let failed = false;
const summary = [];
for (const [bucket, budgetValue] of Object.entries(budgets)) {
    const budget = Number(budgetValue);
    if (!Number.isFinite(budget)) {
        throw new Error(`Non-numeric budget for bucket ${bucket} in product typecheck ratchet.`);
    }
    const found = grouped.get(bucket) || [];
    summary.push(`${bucket}=${found.length}/${budget}`);
    if (found.length > budget) {
        reportOverflow(bucket, found.length, budget, found);
        failed = true;
    }
}
if (failed) process.exit(1);

console.log(`Product typecheck ratchet passed: ${sourceFiles.length} files, ${diagnostics.length} diagnostics (${summary.join(', ')}).`);
