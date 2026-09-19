import assert from 'node:assert/strict';
import test from 'node:test';

import {
    aggregateAreas,
    evaluateCoverageRatchet,
    percentOf,
    readCoverageRatchet,
    resolveArea,
} from '../scripts/check-coverage-ratchet.mjs';
import { buildContractSummaryReporterArgs, buildCoverageArgs } from '../scripts/run-contract-tests.mjs';

function fileEntry(relativePath, { lines = [10, 10], branches = [4, 4], functions = [2, 2] } = {}) {
    return {
        path: `/repo/${relativePath}`,
        coveredLineCount: lines[0], totalLineCount: lines[1],
        coveredBranchCount: branches[0], totalBranchCount: branches[1],
        coveredFunctionCount: functions[0], totalFunctionCount: functions[1],
        coveredLinePercent: (lines[0] / lines[1]) * 100,
    };
}

function summaryOf(files) {
    return { workingDirectory: '/repo', files };
}

const AREAS = ['src/shared/contracts', 'src/state', 'src/entities/systems'];

test('a nested area keeps its own floor instead of being swallowed by its parent', () => {
    assert.equal(resolveArea('src/entities/systems/Foo.js', ['src/entities', 'src/entities/systems']), 'src/entities/systems');
    assert.equal(resolveArea('src/entities/Other.js', ['src/entities', 'src/entities/systems']), 'src/entities');
    assert.equal(resolveArea('src/ui/Menu.js', AREAS), null);
});

test('a path that only shares a name prefix does not join the area', () => {
    assert.equal(resolveArea('src/states/Foo.js', ['src/state']), null);
    assert.equal(resolveArea('src/state', ['src/state']), 'src/state');
});

test('area totals are weighted by counted units, not averaged per file', () => {
    const aggregated = aggregateAreas(summaryOf([
        fileEntry('src/state/Big.js', { lines: [10, 100] }),
        fileEntry('src/state/Small.js', { lines: [1, 1] }),
    ]), ['src/state']);
    const entry = aggregated.get('src/state');

    assert.equal(entry.coveredLineCount, 11);
    assert.equal(entry.totalLineCount, 101);
    // Der ungewichtete Mittelwert waere 55 % und wuerde eine fast ungetestete
    // Grossdatei hinter einer winzigen vollstaendigen verstecken.
    assert.equal(Math.round(percentOf(entry.coveredLineCount, entry.totalLineCount)), 11);
});

test('an area without countable units counts as complete instead of dividing by zero', () => {
    assert.equal(percentOf(0, 0), 100);
    assert.equal(percentOf(3, 0), 100);
});

test('a drop below a floor fails and names the weakest files', () => {
    const results = evaluateCoverageRatchet(
        summaryOf([
            fileEntry('src/state/Weak.js', { lines: [2, 10] }),
            fileEntry('src/state/Strong.js', { lines: [10, 10] }),
        ]),
        { areas: { 'src/state': { lines: 80, branches: 0, functions: 0 } } }
    );

    assert.equal(results[0].failed, true);
    assert.equal(Math.round(results[0].metrics.lines.actual), 60);
    assert.equal(results[0].files.sort((a, b) => a.linePercent - b.linePercent)[0].path, 'src/state/Weak.js');
});

test('meeting a floor exactly still passes', () => {
    const results = evaluateCoverageRatchet(
        summaryOf([fileEntry('src/state/Exact.js', { lines: [8, 10] })]),
        { areas: { 'src/state': { lines: 80, branches: 0, functions: 0 } } }
    );

    assert.equal(results[0].failed, false);
});

test('a missing floor is a configuration error rather than a silent pass', () => {
    assert.throws(
        () => evaluateCoverageRatchet(summaryOf([]), { areas: { 'src/state': { lines: 80 } } }),
        /Missing numeric branches floor for area src\/state/
    );
});

test('the shipped ratchet still guards the contracts at least as hard as the old global gate', () => {
    const ratchet = readCoverageRatchet();
    const contracts = ratchet.areas['src/shared/contracts'];

    assert.ok(contracts, 'src/shared/contracts stays gated');
    assert.ok(contracts.lines >= 70, `lines floor ${contracts.lines} must not fall below the old 70`);
    assert.ok(contracts.branches >= 60, `branches floor ${contracts.branches} must not fall below the old 60`);
    assert.ok(contracts.functions >= 60, `functions floor ${contracts.functions} must not fall below the old 60`);
});

test('every gated area is handed to node as a coverage include', () => {
    const areaNames = Object.keys(readCoverageRatchet().areas);
    const args = buildCoverageArgs(areaNames);

    for (const areaName of areaNames) {
        assert.ok(
            args.includes(`--test-coverage-include=${areaName}/**/*.js`),
            `${areaName} is measured, otherwise its floor would pass on an empty set`
        );
    }
    assert.ok(args.includes('--test-reporter-destination=stdout'));
});

test('coverage keeps one human reporter and one machine reporter', () => {
    const args = [
        ...buildCoverageArgs(AREAS),
        ...buildContractSummaryReporterArgs('/tmp/contract-summary.json'),
    ];
    const reporters = args.filter((arg) => arg.startsWith('--test-reporter='));

    assert.deepEqual(reporters, [
        '--test-reporter=spec',
        '--test-reporter=./scripts/contract-summary-reporter.mjs',
    ]);
});
