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

const program = ts.createProgram(sourceFiles, converted.options);
const diagnostics = ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
const maxDiagnostics = Number(baseline.maxDiagnostics);
if (!Number.isFinite(maxDiagnostics)) {
    throw new Error('Missing numeric maxDiagnostics in product typecheck ratchet.');
}

if (diagnostics.length > maxDiagnostics) {
    console.error(`Product typecheck ratchet failed: ${diagnostics.length} diagnostics exceed baseline ${maxDiagnostics}.`);
    for (const diagnostic of diagnostics.slice(0, 20)) {
        const file = diagnostic.file
            ? path.relative(rootDir, diagnostic.file.fileName).replace(/\\/g, '/')
            : '<compiler>';
        const position = diagnostic.file && Number.isInteger(diagnostic.start)
            ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
            : null;
        const location = position ? `${file}:${position.line + 1}:${position.character + 1}` : file;
        console.error(`- ${location} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
    }
    process.exit(1);
}

const status = diagnostics.length === maxDiagnostics ? 'at-baseline' : 'below-baseline';
console.log(`Product typecheck ratchet passed: ${sourceFiles.length} files, ${diagnostics.length} diagnostics (${status}, baseline ${maxDiagnostics}).`);
