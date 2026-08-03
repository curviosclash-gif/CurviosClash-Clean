import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { collectArchitectureReport } from '../scripts/architecture/ArchitectureAnalysis.mjs';

const fixtureRoot = fileURLToPath(new URL('./fixtures/architecture-reexport/', import.meta.url));

test('architecture analysis scans product tools and rejects re-export boundary bypasses', () => {
    const report = collectArchitectureReport(fixtureRoot);
    assert.equal(report.sourceFileCount, 4);
    assert.equal(report.scorecard.entitiesToCoreImports.totalEdges, 1);
    assert.equal(report.scorecard.entitiesToCoreImports.disallowedEdges, 1);
    assert.equal(report.findings.entitiesToCoreImports[0]?.kind, 're-export');
});
