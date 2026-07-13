import { collectArchitectureReport } from './architecture/ArchitectureAnalysis.mjs';
import { collectTouchedFiles } from './architecture/TouchedFiles.mjs';

const touchedFiles = new Set(
    collectTouchedFiles({})
        .filter((filePath) => filePath.startsWith('src/'))
        .filter((filePath) => filePath.endsWith('.js'))
);

if (touchedFiles.size === 0) {
    console.log('Architecture touched-file strict mode skipped (no touched src files).');
    process.exit(0);
}

const report = collectArchitectureReport(process.cwd());
const failures = [];

const pushViolation = (category, entry, filePath, line, detail) => {
    if (!touchedFiles.has(filePath)) return;
    if (entry.allowed !== false) return;
    failures.push({
        category,
        location: `${filePath}:${line}`,
        detail,
    });
};

for (const entry of report.findings.constructorGameMatches) {
    pushViolation('constructor(game)', entry, entry.file, entry.line, entry.snippet);
}

for (const entry of report.findings.domAccessesOutsideUi) {
    pushViolation('DOM outside src/ui', entry, entry.file, entry.line, entry.snippet);
}

for (const entry of report.findings.coreToUiImports) {
    pushViolation('core -> ui import', entry, entry.from, entry.line, `${entry.from} -> ${entry.to}`);
}

for (const entry of report.findings.uiToCoreImports) {
    pushViolation('ui -> core import', entry, entry.from, entry.line, `${entry.from} -> ${entry.to}`);
}

for (const entry of report.findings.uiToStateImports) {
    pushViolation('ui -> state import', entry, entry.from, entry.line, `${entry.from} -> ${entry.to}`);
}

for (const entry of report.findings.entitiesToCoreImports) {
    pushViolation('entities -> core import', entry, entry.from, entry.line, `${entry.from} -> ${entry.to}`);
}

for (const entry of report.findings.stateToCoreImports) {
    pushViolation('state -> core import', entry, entry.from, entry.line, `${entry.from} -> ${entry.to}`);
}

for (const entry of report.findings.sharedContractsToCoreImports) {
    pushViolation('shared/contracts -> core import', entry, entry.from, entry.line, `${entry.from} -> ${entry.to}`);
}

for (const entry of report.findings.applicationToUiImports) {
    pushViolation('application -> ui import', entry, entry.from, entry.line, `${entry.from} -> ${entry.to}`);
}

for (const entry of report.findings.applicationToCoreImports) {
    pushViolation('application -> core import', entry, entry.from, entry.line, `${entry.from} -> ${entry.to}`);
}

for (const entry of (report.findings.legacySurfaceReads || [])) {
    if (!touchedFiles.has(entry.file)) continue;
    if (entry.allowed !== false) continue;
    failures.push({
        category: `legacy-surface: ${entry.surfaceId}`,
        location: `${entry.file}:${entry.line}`,
        detail: entry.snippet,
    });
}

if (failures.length === 0) {
    console.log('Architecture touched-file strict mode passed.');
    console.log(`Touched src files checked: ${touchedFiles.size}`);
    if (report.scorecard.legacySurfaces) {
        for (const [surfaceId, data] of Object.entries(report.scorecard.legacySurfaces)) {
            console.log(`legacy-surface ${surfaceId}: ${data.totalFiles} files total (${data.disallowedFiles} disallowed)`);
        }
    }
    process.exit(0);
}

console.error('Architecture touched-file strict mode failed.');
for (const failure of failures) {
    console.error(`- ${failure.category} @ ${failure.location}`);
    console.error(`  ${failure.detail}`);
}
process.exit(1);
