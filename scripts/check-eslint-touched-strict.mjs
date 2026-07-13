import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { LEGACY_MAX_LINES } from './architecture/LegacyMaxLinesConfig.mjs';
import { collectTouchedFiles } from './architecture/TouchedFiles.mjs';

function countLines(text) {
    if (!text) return 0;
    return String(text).split(/\r?\n/).length;
}

const touchedFiles = collectTouchedFiles({})
    .filter((filePath) => filePath.startsWith('src/'))
    .filter((filePath) => filePath.endsWith('.js'));
const lineGrowthBudget = Number.isFinite(Number(process.env.ARCH_TOUCHED_LINE_GROWTH))
    ? Math.max(0, Math.floor(Number(process.env.ARCH_TOUCHED_LINE_GROWTH)))
    : 8;

function readHeadLines(filePath) {
    try {
        const output = execSync(`git show HEAD:${filePath}`, {
            stdio: ['ignore', 'pipe', 'ignore'],
        }).toString('utf8');
        return countLines(output);
    } catch {
        return 0;
    }
}

const failures = [];

for (const filePath of touchedFiles) {
    if (!Object.prototype.hasOwnProperty.call(LEGACY_MAX_LINES, filePath)) {
        continue;
    }
    let lineCount = 0;
    try {
        lineCount = countLines(readFileSync(filePath, 'utf8'));
    } catch {
        continue;
    }
    const headLineCount = readHeadLines(filePath);
    if (lineCount <= (headLineCount + lineGrowthBudget)) {
        continue;
    }
    failures.push({
        filePath,
        lineCount,
        headLineCount,
        lineGrowthBudget,
        legacyLimit: LEGACY_MAX_LINES[filePath],
    });
}

if (failures.length === 0) {
    console.log('ESLint touched-file strict mode passed.');
    console.log(`Touched src files checked: ${touchedFiles.length}`);
    process.exit(0);
}

console.error('ESLint touched-file strict mode failed.');
for (const failure of failures) {
    console.error(
        `- ${failure.filePath}: ${failure.lineCount} lines exceeds touched baseline ${failure.headLineCount} + budget ${failure.lineGrowthBudget} (legacy ${failure.legacyLimit})`
    );
}
process.exit(1);
