import { collectArchitectureReport } from './architecture/ArchitectureAnalysis.mjs';

const report = collectArchitectureReport(process.cwd());

const violations = [
    ...report.findings.configWrites.map((entry) => ({
        category: 'CONFIG write',
        location: `${entry.file}:${entry.line}`,
        detail: entry.snippet,
    })),
    ...report.findings.constructorGameMatches
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: entry.kind,
            location: `${entry.file}:${entry.line}`,
            detail: entry.snippet,
        })),
    ...report.findings.domAccessesOutsideUi
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'DOM outside src/ui',
            location: `${entry.file}:${entry.line}`,
            detail: entry.snippet,
        })),
    ...report.findings.coreToUiImports
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'core -> ui import',
            location: `${entry.from}:${entry.line}`,
            detail: `${entry.from} -> ${entry.to}`,
        })),
    ...report.findings.uiToCoreImports
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'ui -> core import',
            location: `${entry.from}:${entry.line}`,
            detail: `${entry.from} -> ${entry.to}`,
        })),
    ...report.findings.uiToStateImports
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'ui -> state import',
            location: `${entry.from}:${entry.line}`,
            detail: `${entry.from} -> ${entry.to}`,
        })),
    ...report.findings.stateToUiImports
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'state -> ui import',
            location: `${entry.from}:${entry.line}`,
            detail: `${entry.from} -> ${entry.to}`,
        })),
    ...report.findings.entitiesToCoreImports
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'entities -> core import',
            location: `${entry.from}:${entry.line}`,
            detail: `${entry.from} -> ${entry.to}`,
        })),
    ...report.findings.stateToCoreImports
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'state -> core import',
            location: `${entry.from}:${entry.line}`,
            detail: `${entry.from} -> ${entry.to}`,
        })),
    ...report.findings.sharedContractsToCoreImports
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'shared/contracts -> core import',
            location: `${entry.from}:${entry.line}`,
            detail: `${entry.from} -> ${entry.to}`,
        })),
    ...report.findings.applicationToUiImports
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'application -> ui import',
            location: `${entry.from}:${entry.line}`,
            detail: `${entry.from} -> ${entry.to}`,
        })),
    ...report.findings.applicationToCoreImports
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: 'application -> core import',
            location: `${entry.from}:${entry.line}`,
            detail: `${entry.from} -> ${entry.to}`,
        })),
    ...(report.findings.legacySurfaceReads || [])
        .filter((entry) => !entry.allowed)
        .map((entry) => ({
            category: `legacy-surface: ${entry.surfaceId}`,
            location: `${entry.file}:${entry.line}`,
            detail: entry.snippet,
        })),
];

if (violations.length === 0) {
    console.log('Architecture boundary guard passed.');
    console.log(`CONFIG writes: ${report.scorecard.configWrites.total}`);
    console.log(`constructor(game)/this.game = game disallowed files: ${report.scorecard.constructorGame.disallowedFiles}`);
    console.log(`DOM outside src/ui disallowed files: ${report.scorecard.domAccessOutsideUi.disallowedFiles}`);
    console.log(`core -> ui disallowed imports: ${report.scorecard.coreToUiImports.disallowedEdges}`);
    console.log(`ui -> core disallowed imports: ${report.scorecard.uiToCoreImports.disallowedEdges}`);
    console.log(`ui -> state disallowed imports: ${report.scorecard.uiToStateImports.disallowedEdges}`);
    console.log(`state -> ui disallowed imports: ${report.scorecard.stateToUiImports.disallowedEdges}`);
    console.log(`entities -> core disallowed imports: ${report.scorecard.entitiesToCoreImports.disallowedEdges}`);
    console.log(`state -> core disallowed imports: ${report.scorecard.stateToCoreImports.disallowedEdges}`);
    console.log(`shared/contracts -> core disallowed imports: ${report.scorecard.sharedContractsToCoreImports.disallowedEdges}`);
    console.log(`application -> ui disallowed imports: ${report.scorecard.applicationToUiImports.disallowedEdges}`);
    console.log(`application -> core disallowed imports: ${report.scorecard.applicationToCoreImports.disallowedEdges}`);
    console.log(`electron preload exposures: ${report.scorecard.electronPreloadExposures.totalOccurrences} across ${report.scorecard.electronPreloadExposures.totalFiles} files`);
    console.log(`electron ipcRenderer channels: ${report.scorecard.electronIpcRendererChannels.totalOccurrences} across ${report.scorecard.electronIpcRendererChannels.totalFiles} files`);
    console.log(`electron ipcMain channels: ${report.scorecard.electronIpcMainChannels.totalOccurrences} across ${report.scorecard.electronIpcMainChannels.totalFiles} files`);
    if (report.scorecard.legacySurfaces) {
        for (const [surfaceId, data] of Object.entries(report.scorecard.legacySurfaces)) {
            console.log(`legacy-surface ${surfaceId}: ${data.totalFiles} files (${data.disallowedFiles} disallowed)`);
        }
    }
    process.exit(0);
}

console.error('Architecture boundary guard failed.');
for (const violation of violations) {
    console.error(`- ${violation.category} @ ${violation.location}`);
    console.error(`  ${violation.detail}`);
}
process.exit(1);
