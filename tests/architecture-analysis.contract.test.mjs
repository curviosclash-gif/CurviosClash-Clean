import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectArchitectureReport } from '../scripts/architecture/ArchitectureAnalysis.mjs';
import { DOM_ACCESS_PAGE_FILES } from '../scripts/architecture/ArchitectureConfig.mjs';

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
        'doc?.querySelector',
        'document.activeElement',
        'documentRef.body',
        'documentRef?.createElement',
        'this._document?.addEventListener',
    ]);
    assert.equal(report.scorecard.domAccessOutsideUi.disallowedFiles, 1);
});

const domPageFileFixtureRoot = fileURLToPath(new URL('./fixtures/architecture-dom-zone/', import.meta.url));

// Page-owning files are exempt one by one; a new file next to them is scanned like any other.
test('the DOM guard exempts listed page files only, not their whole folder', () => {
    const report = collectArchitectureReport(domPageFileFixtureRoot);
    const findings = report.findings.domAccessesOutsideUi;
    assert.deepEqual(findings.map((finding) => `${finding.file} ${finding.match}`), [
        'src/platform/browser/NewThing.js document.querySelector',
    ]);
    assert.equal(findings[0].allowed, false);
});

test('every page-file DOM exemption names an existing file and a reason', () => {
    const repoRoot = fileURLToPath(new URL('../', import.meta.url));
    for (const [file, reason] of DOM_ACCESS_PAGE_FILES) {
        assert.ok(existsSync(`${repoRoot}${file}`), `${file} is listed but missing`);
        assert.ok(reason.length > 20, `${file} needs a reason`);
    }
});

const ipcHelperFixtureRoot = fileURLToPath(new URL('./fixtures/architecture-ipc-helper/', import.meta.url));

// ADR 0001 caps the IPC surface; channels routed through a helper or a constant count like literal ones.
test('the IPC count sees channels behind helper functions and constants', () => {
    const report = collectArchitectureReport(ipcHelperFixtureRoot);
    const channelsOf = (entries) => entries.map((entry) => entry.channel).sort();
    assert.deepEqual(channelsOf(report.findings.electronIpcRendererChannels), [
        'x:literal',
        'x:request',
        'x:start',
        'x:stop',
        'x:update',
        'x:y',
    ]);
    assert.deepEqual(channelsOf(report.findings.electronIpcMainChannels), [
        '<dynamic:channel>',
        'x:get-all',
        'x:literal',
        'x:set-value',
    ]);
});

// The collector only resolves helpers and constants inside one file. Anything it cannot resolve
// (a method helper, a loop over channels, a renamed ipcMain) shows up as <dynamic…>; only the two
// teardown loops over channel tables that are counted elsewhere may stay that way.
test('the real Electron code has no unresolved IPC channels besides the teardown loops', () => {
    const report = collectArchitectureReport(fileURLToPath(new URL('../', import.meta.url)));
    const unresolved = [...report.findings.electronIpcRendererChannels, ...report.findings.electronIpcMainChannels]
        .filter((entry) => entry.channel.startsWith('<dynamic'))
        .map((entry) => `${entry.file} ${entry.kind} ${entry.channel}`)
        .sort();
    assert.deepEqual(unresolved, [
        'electron/settings-studio/ipc/settings-studio-ipc.cjs ipcMain.removeHandler <dynamic:channel>',
        'electron/tuning-ipc.cjs ipcMain.removeHandler <dynamic:channel>',
    ]);
});
