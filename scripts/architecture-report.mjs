import { collectArchitectureReport, formatArchitectureReport } from './architecture/ArchitectureAnalysis.mjs';

const report = collectArchitectureReport(process.cwd());

if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(formatArchitectureReport(report));
}
