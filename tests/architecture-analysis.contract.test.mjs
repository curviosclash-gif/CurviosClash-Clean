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

const domAliasFixtureRoot = fileURLToPath(new URL('./fixtures/architecture-dom-alias/', import.meta.url));

test('the DOM guard sees document access through aliases and optional chaining', () => {
    const report = collectArchitectureReport(domAliasFixtureRoot);
    const findings = report.findings.domAccessesOutsideUi;
    const matched = findings.map((finding) => finding.match).sort();
    assert.deepEqual(matched, [
        'document.activeElement',
        'documentRef.body',
        'documentRef?.createElement',
        'this._document?.addEventListener',
    ]);
    assert.equal(report.scorecard.domAccessOutsideUi.disallowedFiles, 1);
});
