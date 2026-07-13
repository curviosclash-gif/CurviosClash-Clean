import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_FILES = [
    'src/core/GameRuntimeFacade.js',
    'src/core/runtime/RuntimeSettingsChangeOrchestrator.js',
    'src/ui/PauseOverlayController.js',
];

const MOJIBAKE_PATTERNS = [
    /Ã/g,
    /Â/g,
    /â€/g,
    /â€™/g,
    /â€œ/g,
    /â€/g,
    /ðŸ/g,
    /�/g,
];

function findLineMatches(content) {
    const lines = String(content || '').split(/\r?\n/);
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const hasPattern = MOJIBAKE_PATTERNS.some((pattern) => pattern.test(line));
        if (!hasPattern) continue;
        matches.push({
            line: index + 1,
            text: line.trim().slice(0, 200),
        });
    }
    return matches;
}

async function main() {
    const violations = [];
    for (const relPath of TARGET_FILES) {
        const absPath = path.resolve(ROOT, relPath);
        let content = '';
        try {
            content = await readFile(absPath, 'utf8');
        } catch (error) {
            violations.push({
                file: relPath,
                line: 1,
                message: `Datei nicht lesbar: ${error?.message || 'unknown'}`,
            });
            continue;
        }
        const lineMatches = findLineMatches(content);
        for (const match of lineMatches) {
            violations.push({
                file: relPath,
                line: match.line,
                message: match.text,
            });
        }
    }

    if (violations.length > 0) {
        console.error('[runtime-encoding-check] Mojibake-Verdacht in Runtime-Strings gefunden:');
        for (const violation of violations) {
            console.error(`- ${violation.file}:${violation.line} ${violation.message}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[runtime-encoding-check] PASS - keine Mojibake-Marker in Runtime-Strings gefunden.');
}

main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
});
