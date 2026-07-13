import { readFileSync } from 'node:fs';
import { collectArchitectureReport } from './architecture/ArchitectureAnalysis.mjs';

const baseline = JSON.parse(
    readFileSync('scripts/architecture/architecture-budget-ratchet.json', 'utf8')
);

const baselineBudgets = baseline?.budgets || {};
const report = collectArchitectureReport(process.cwd());

const legacySurfaceChecks = Object.entries(report.scorecard.legacySurfaces || {}).map(
    ([surfaceId, data]) => ({
        key: `legacySurface_${surfaceId.replace(/[^a-zA-Z0-9]/g, '_')}_totalFiles`,
        label: `legacy-surface ${surfaceId} total file budget`,
        actual: data.totalFiles,
    })
);

const checks = [
    {
        key: 'constructorGameFiles',
        label: 'constructor(game) legacy file budget',
        actual: report.scorecard.constructorGame.totalFiles,
    },
    {
        key: 'domAccessFiles',
        label: 'DOM outside src/ui legacy file budget',
        actual: report.scorecard.domAccessOutsideUi.totalFiles,
    },
    {
        key: 'coreToUiImportEdges',
        label: 'core -> ui legacy edge budget',
        actual: report.scorecard.coreToUiImports.totalEdges,
    },
    {
        key: 'uiToCoreImportEdges',
        label: 'ui -> core legacy edge budget',
        actual: report.scorecard.uiToCoreImports.totalEdges,
    },
    {
        key: 'uiToStateImportEdges',
        label: 'ui -> state legacy edge budget',
        actual: report.scorecard.uiToStateImports.totalEdges,
    },
    {
        key: 'stateToUiImportEdges',
        label: 'state -> ui legacy edge budget',
        actual: report.scorecard.stateToUiImports.totalEdges,
    },
    {
        key: 'entitiesToCoreImportEdges',
        label: 'entities -> core legacy edge budget',
        actual: report.scorecard.entitiesToCoreImports.totalEdges,
    },
    {
        key: 'stateToCoreImportEdges',
        label: 'state -> core legacy edge budget',
        actual: report.scorecard.stateToCoreImports.totalEdges,
    },
    {
        key: 'sharedContractsToCoreImportEdges',
        label: 'shared/contracts -> core legacy edge budget',
        actual: report.scorecard.sharedContractsToCoreImports.totalEdges,
    },
    {
        key: 'applicationToUiImportEdges',
        label: 'application -> ui legacy edge budget',
        actual: report.scorecard.applicationToUiImports.totalEdges,
    },
    {
        key: 'applicationToCoreImportEdges',
        label: 'application -> core legacy edge budget',
        actual: report.scorecard.applicationToCoreImports.totalEdges,
    },
    ...legacySurfaceChecks,
];

const observedChecks = [
    {
        key: 'electronPreloadExposures',
        label: 'electron preload exposure count',
        actual: report.scorecard.electronPreloadExposures.totalOccurrences,
    },
    {
        key: 'electronIpcRendererChannels',
        label: 'electron ipcRenderer channel count',
        actual: report.scorecard.electronIpcRendererChannels.totalOccurrences,
    },
    {
        key: 'electronIpcMainChannels',
        label: 'electron ipcMain channel count',
        actual: report.scorecard.electronIpcMainChannels.totalOccurrences,
    },
];

const failures = [];
for (const check of checks) {
    const max = Number(baselineBudgets[check.key]);
    if (!Number.isFinite(max)) {
        failures.push({
            label: check.label,
            detail: `Missing baseline key "${check.key}"`,
        });
        continue;
    }
    if (check.actual > max) {
        failures.push({
            label: check.label,
            detail: `${check.actual} exceeds ratchet baseline ${max}`,
        });
    }
}

if (failures.length === 0) {
    console.log('Architecture budget ratchet passed.');
    for (const check of checks) {
        const max = baselineBudgets[check.key];
        const status = check.actual === max ? 'at-baseline' : 'below-baseline';
        console.log(`- ${status}: ${check.label} = ${check.actual} (baseline ${max})`);
    }
    for (const check of observedChecks) {
        const max = Number(baselineBudgets[check.key]);
        if (Number.isFinite(max)) {
            const status = check.actual === max ? 'at-baseline' : check.actual < max ? 'below-baseline' : 'above-baseline';
            console.log(`- ${status}: ${check.label} = ${check.actual} (baseline ${max})`);
        } else {
            console.log(`- observed: ${check.label} = ${check.actual} (no ratchet baseline yet)`);
        }
    }
    process.exit(0);
}

console.error('Architecture budget ratchet failed.');
for (const failure of failures) {
    console.error(`- ${failure.label}: ${failure.detail}`);
}
process.exit(1);
