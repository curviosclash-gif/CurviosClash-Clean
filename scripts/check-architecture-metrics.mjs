import { readFileSync } from 'node:fs';
import { collectArchitectureReport, formatArchitectureReport } from './architecture/ArchitectureAnalysis.mjs';

const report = collectArchitectureReport(process.cwd());

let ratchetBaselines = {};
try {
    const ratchet = JSON.parse(readFileSync('scripts/architecture/architecture-budget-ratchet.json', 'utf8'));
    ratchetBaselines = ratchet?.budgets || {};
} catch {
    // ratchet file optional for metrics display
}

function resolveBudget(key, fallback) {
    const ratchetBaseline = Number(ratchetBaselines[key]);
    return Number.isFinite(ratchetBaseline) ? ratchetBaseline : fallback;
}

const legacySurfaceChecks = Object.entries(report.scorecard.legacySurfaces || {}).map(
    ([surfaceId, data]) => {
        const key = `legacySurface_${surfaceId.replace(/[^a-zA-Z0-9]/g, '_')}_totalFiles`;
        return {
            label: `legacy-surface ${surfaceId} total files`,
            actual: data.totalFiles,
            max: resolveBudget(key, data.totalFiles),
        };
    }
);

const checks = [
    {
        label: 'CONFIG writes',
        actual: report.scorecard.configWrites.total,
        max: report.targets.configWrites,
    },
    {
        label: 'constructor(game) legacy file budget',
        actual: report.scorecard.constructorGame.totalFiles,
        max: resolveBudget('constructorGameFiles', report.budgets.constructorGameFiles),
    },
    {
        label: 'DOM outside src/ui legacy file budget',
        actual: report.scorecard.domAccessOutsideUi.totalFiles,
        max: resolveBudget('domAccessFiles', report.budgets.domAccessFiles),
    },
    {
        label: 'core -> ui legacy edge budget',
        actual: report.scorecard.coreToUiImports.totalEdges,
        max: resolveBudget('coreToUiImportEdges', report.budgets.coreToUiImportEdges),
    },
    {
        label: 'ui -> core legacy edge budget',
        actual: report.scorecard.uiToCoreImports.totalEdges,
        max: resolveBudget('uiToCoreImportEdges', report.budgets.uiToCoreImportEdges),
    },
    {
        label: 'ui -> state legacy edge budget',
        actual: report.scorecard.uiToStateImports.totalEdges,
        max: resolveBudget('uiToStateImportEdges', report.budgets.uiToStateImportEdges),
    },
    {
        label: 'state -> ui legacy edge budget',
        actual: report.scorecard.stateToUiImports.totalEdges,
        max: resolveBudget('stateToUiImportEdges', report.budgets.stateToUiImportEdges),
    },
    {
        label: 'entities -> core legacy edge budget',
        actual: report.scorecard.entitiesToCoreImports.totalEdges,
        max: resolveBudget('entitiesToCoreImportEdges', report.budgets.entitiesToCoreImportEdges),
    },
    {
        label: 'state -> core legacy edge budget',
        actual: report.scorecard.stateToCoreImports.totalEdges,
        max: resolveBudget('stateToCoreImportEdges', report.budgets.stateToCoreImportEdges),
    },
    {
        label: 'shared/contracts -> core legacy edge budget',
        actual: report.scorecard.sharedContractsToCoreImports.totalEdges,
        max: resolveBudget('sharedContractsToCoreImportEdges', report.budgets.sharedContractsToCoreImportEdges),
    },
    {
        label: 'application -> ui legacy edge budget',
        actual: report.scorecard.applicationToUiImports.totalEdges,
        max: resolveBudget('applicationToUiImportEdges', report.budgets.applicationToUiImportEdges),
    },
    {
        label: 'application -> core legacy edge budget',
        actual: report.scorecard.applicationToCoreImports.totalEdges,
        max: resolveBudget('applicationToCoreImportEdges', report.budgets.applicationToCoreImportEdges),
    },
    ...legacySurfaceChecks,
];

const observedChecks = [
    {
        label: 'electron preload exposures',
        actual: report.scorecard.electronPreloadExposures.totalOccurrences,
    },
    {
        label: 'electron ipcRenderer channels',
        actual: report.scorecard.electronIpcRendererChannels.totalOccurrences,
    },
    {
        label: 'electron ipcMain channels',
        actual: report.scorecard.electronIpcMainChannels.totalOccurrences,
    },
];

const failures = checks.filter((check) => check.actual > check.max);

console.log(formatArchitectureReport(report));
console.log('');
console.log('Architecture metric budgets:');
for (const check of checks) {
    const status = check.actual <= check.max ? 'OK' : 'FAIL';
    console.log(`- ${status}: ${check.label} = ${check.actual} (budget ${check.max})`);
}
console.log('');
console.log('Architecture observed surfaces:');
for (const check of observedChecks) {
    console.log(`- OBSERVED: ${check.label} = ${check.actual}`);
}

if (failures.length > 0) {
    process.exit(1);
}
