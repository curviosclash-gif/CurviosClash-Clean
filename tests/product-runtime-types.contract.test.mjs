import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repairedDiagnostics = new Map([
    ['editor/js/EditorAssetLoader.js', new Set([2345])],
    ['src/core/Audio.js', new Set([2322, 2741])],
]);

test('repaired product runtime files stay type-safe', () => {
    const baseConfig = JSON.parse(readFileSync(path.join(repoRoot, 'tsconfig.json'), 'utf8'));
    const converted = ts.convertCompilerOptionsFromJson({
        ...baseConfig.compilerOptions,
        allowJs: true,
        checkJs: true,
        noEmit: true,
        types: ['node'],
    }, repoRoot);
    assert.deepEqual(converted.errors, []);

    const targetPaths = [...repairedDiagnostics.keys()].map((file) => path.join(repoRoot, file));
    const targetCodes = new Map([...repairedDiagnostics].map(([file, codes]) => [
        path.resolve(repoRoot, file),
        codes,
    ]));
    const ambientDeclaration = path.join(repoRoot, 'dev/vite/vite-build-globals.d.ts');
    const program = ts.createProgram([...targetPaths, ambientDeclaration], converted.options);
    const diagnostics = ts.getPreEmitDiagnostics(program)
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
        .filter((diagnostic) => targetCodes.get(path.resolve(diagnostic.file?.fileName || ''))?.has(diagnostic.code))
        .map((diagnostic) => {
            const file = path.relative(repoRoot, diagnostic.file.fileName).replace(/\\/g, '/');
            const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
            return `${file}:${position.line + 1}:${position.character + 1} TS${diagnostic.code} ${message}`;
        });

    assert.deepEqual(diagnostics, []);
});
