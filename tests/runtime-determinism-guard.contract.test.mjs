import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applySourceExceptions,
    buildReExportScanPlan,
    extractPureReExportTargets,
    findDeterminismViolations,
    SCAN_TARGETS,
} from '../scripts/check-runtime-determinism.mjs';

function details(source) {
    return findDeterminismViolations(source).map((violation) => violation.detail);
}

test('a call to the wall clock or the global roll is reported', () => {
    assert.deepEqual(details('const t = Date.now();'), ['Date.now(']);
    assert.deepEqual(details('const r = Math.random();'), ['Math.random(']);
    assert.deepEqual(details('const p = performance.now();'), ['performance.now(']);
});

// Das war die Luecke: der alte Ausdruck verlangte die oeffnende Klammer, deshalb blieb
// jede Zuweisung unsichtbar, obwohl sie denselben ungesetzten Wuerfel weiterreicht.
test('handing the global roll on as a value is reported too', () => {
    assert.deepEqual(details('this._random = Math.random;'), ['Math.random (handed on as a value)']);
    assert.deepEqual(
        details('const now = typeof options.now === \'function\' ? options.now : Date.now;'),
        ['Date.now (handed on as a value)']
    );
    assert.deepEqual(
        details('function pick(entries, random = Math.random) {}'),
        ['Math.random (handed on as a value)']
    );
});

test('a capability check asks about the platform and is not a use', () => {
    assert.deepEqual(details('if (typeof performance.now === \'function\') {}'), []);
    assert.deepEqual(
        details('if (typeof performance !== \'undefined\' && typeof performance.now === \'function\') {}'),
        []
    );
});

test('a capability check does not excuse the call that follows it', () => {
    const source = [
        'if (typeof performance !== \'undefined\' && typeof performance.now === \'function\') {',
        '    return performance.now() * 0.001;',
        '}',
    ].join('\n');

    assert.deepEqual(details(source), ['performance.now(']);
});

test('a comment naming the global roll does not trip the guard', () => {
    assert.deepEqual(details('// falls back to Math.random when unseeded'), []);
    assert.deepEqual(details('/* Date.now is deliberately avoided here */'), []);
});

test('AST locations keep the reported line pointing at the real source line', () => {
    const source = [
        '/*',
        ' * Math.random must not appear in a report.',
        ' */',
        'const seed = 1;',
        'const roll = Math.random();',
    ].join('\n');
    const violations = findDeterminismViolations(source);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 5);
});

test('comments and string contents do not hide or invent direct clock and RNG references', () => {
    const source = [
        "const endpoint = 'https://host'; const stamp = Date.now();",
        "const example = '/* Math.random() */'; const roll = Math /* spaced */ . random();",
        '// performance.now() is only mentioned here',
        'const label = `Date.now() ${performance?.now?.()}`;',
    ].join('\n');
    const violations = findDeterminismViolations(source);

    assert.deepEqual(violations.map(({ line, token, detail }) => ({ line, token, detail })), [
        { line: 1, token: 'Date.now', detail: 'Date.now(' },
        { line: 2, token: 'Math.random', detail: 'Math.random(' },
        { line: 4, token: 'performance.now', detail: 'performance.now(' },
    ]);
});

test('optional and constant bracket accesses are detected while typeof capability checks remain excluded', () => {
    const source = [
        'const clock = Date[\'now\'];',
        'const random = Math[`random`];',
        "if (typeof (performance.now) === 'function') {}",
        'const sample = typeof performance.now() === \'number\';',
    ].join('\n');

    assert.deepEqual(findDeterminismViolations(source).map(({ line, token, detail }) => ({ line, token, detail })), [
        { line: 1, token: 'Date.now', detail: 'Date.now (handed on as a value)' },
        { line: 2, token: 'Math.random', detail: 'Math.random (handed on as a value)' },
        { line: 4, token: 'performance.now', detail: 'performance.now(' },
    ]);
});

test('parenthesized direct receivers and direct destructuring bindings are reported', () => {
    const source = [
        '(Math).random();',
        '(Date).now();',
        '(globalThis.performance).now();',
        'const { now: clock } = Date;',
        'const { random } = Math;',
        '({ now: assignedClock } = (globalThis.Date));',
        'function pick({ random: sample } = Math) {}',
        'function read({ now } = (globalThis.performance)) {}',
    ].join('\n');

    assert.deepEqual(findDeterminismViolations(source).map(({ line, token, detail }) => ({ line, token, detail })), [
        { line: 1, token: 'Math.random', detail: 'Math.random(' },
        { line: 2, token: 'Date.now', detail: 'Date.now(' },
        { line: 3, token: 'performance.now', detail: 'performance.now(' },
        { line: 4, token: 'Date.now', detail: 'Date.now (handed on as a value)' },
        { line: 5, token: 'Math.random', detail: 'Math.random (handed on as a value)' },
        { line: 6, token: 'Date.now', detail: 'Date.now (handed on as a value)' },
        { line: 7, token: 'Math.random', detail: 'Math.random (handed on as a value)' },
        { line: 8, token: 'performance.now', detail: 'performance.now (handed on as a value)' },
    ]);
});

test('destructuring from harmless local objects and mentions in strings remain unreported', () => {
    const source = [
        'const localMath = { random: () => 0.5 };',
        'const localDate = { now: () => 1 };',
        'const moduleValue = { Math: localMath, Date: localDate };',
        'const { random: sample } = localMath;',
        'const { now: clock } = localDate;',
        'moduleValue.Math.random(); moduleValue.Date.now();',
        '({ random: assigned } = localMath);',
        'function take({ now } = localDate) {}',
        'const note = "const { random } = Math; https://host";',
    ].join('\n');

    assert.deepEqual(findDeterminismViolations(source), []);
});

test('parenthesized constant keys are detected in properties, bindings, assignments, and parameter defaults', () => {
    const source = [
        "Date[('now')]();",
        "globalThis[('Math')].random();",
        'Date[((`now`))]();',
        "const { [('random')]: picked } = Math;",
        'const { [((`now`))]: clock } = globalThis.performance;',
        "({ [('now')]: assignedClock } = Date);",
        '({ [((`random`))]: assignedRoll } = globalThis.Math);',
        "function choose({ [('random')]: localRoll } = Math) {}",
        'function read({ [((`now`))]: localClock } = globalThis.Date) {}',
    ].join('\n');

    assert.deepEqual(findDeterminismViolations(source).map(({ line, token, detail }) => ({ line, token, detail })), [
        { line: 1, token: 'Date.now', detail: 'Date.now(' },
        { line: 2, token: 'Math.random', detail: 'Math.random(' },
        { line: 3, token: 'Date.now', detail: 'Date.now(' },
        { line: 4, token: 'Math.random', detail: 'Math.random (handed on as a value)' },
        { line: 5, token: 'performance.now', detail: 'performance.now (handed on as a value)' },
        { line: 6, token: 'Date.now', detail: 'Date.now (handed on as a value)' },
        { line: 7, token: 'Math.random', detail: 'Math.random (handed on as a value)' },
        { line: 8, token: 'Math.random', detail: 'Math.random (handed on as a value)' },
        { line: 9, token: 'Date.now', detail: 'Date.now (handed on as a value)' },
    ]);
});

test('several uses on one line are each reported', () => {
    assert.deepEqual(
        details('const x = Math.random() > 0.5 ? Date.now() : 0;'),
        ['Math.random(', 'Date.now(']
    );
});

test('the guard scans the added hunt, state, arcade, and runtime paths without a duplicate runtime target', () => {
    for (const target of ['src/hunt', 'src/state', 'src/core/arcade', 'src/core/runtime']) {
        assert.ok(SCAN_TARGETS.includes(target), `${target} must be scanned`);
    }
    assert.equal(SCAN_TARGETS.filter((target) => target === 'src/core/runtime').length, 1);
    assert.ok(!SCAN_TARGETS.includes('src/core/runtime/MenuRuntimeSessionService.js'));
});

test('an exact exception does not hide a new use elsewhere in the same file', () => {
    const filePath = 'src/network/LatencyMonitor.js';
    const source = [
        'const pingStarted = performance.now();',
        'const gameplaySeed = Math.random();',
    ].join('\n');
    const exceptions = {
        [filePath]: [{
            snippet: 'const pingStarted = performance.now();',
            tokens: { 'performance.now': 1 },
            reason: 'real network timing',
        }],
    };
    const result = applySourceExceptions(filePath, source, findDeterminismViolations(source), exceptions);

    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.violations.map((violation) => violation.detail), ['Math.random(']);
});

test('an exception does not excuse a global passed as a value on another line', () => {
    const filePath = 'src/network/LatencyMonitor.js';
    const source = 'const pingStarted = performance.now();\nconst suppliedClock = Date.now;';
    const exceptions = {
        [filePath]: [{
            snippet: 'const pingStarted = performance.now();',
            tokens: { 'performance.now': 1 },
            reason: 'real network timing',
        }],
    };
    const result = applySourceExceptions(filePath, source, findDeterminismViolations(source), exceptions);

    assert.deepEqual(result.violations.map((violation) => violation.detail), ['Date.now (handed on as a value)']);
});

test('an exact line can declare multiple token uses and suppresses only those counts', () => {
    const filePath = 'src/network/LatencyMonitor.js';
    const snippet = 'const pingId = `${Date.now()}-${Math.random()}`;';
    const exceptions = {
        [filePath]: [{
            snippet,
            tokens: { 'Date.now': 1, 'Math.random': 1 },
            reason: 'transport identifier timestamp and entropy',
        }],
    };
    const valid = applySourceExceptions(filePath, snippet, findDeterminismViolations(snippet), exceptions);
    assert.deepEqual(valid.failures, []);
    assert.deepEqual(valid.violations, []);

    const changed = 'const pingId = `${Date.now()}-${Math.random()}-${Date.now()}`;';
    const invalid = applySourceExceptions(filePath, changed, findDeterminismViolations(changed), exceptions);
    assert.ok(invalid.failures.some((failure) => failure.detail === 'source_exception_stale_snippet'));
    assert.deepEqual(invalid.violations.map((violation) => violation.token), ['Date.now', 'Math.random', 'Date.now']);
});

test('stale exceptions fail configuration and leave source uses unexempted', () => {
    const filePath = 'src/network/LatencyMonitor.js';
    const source = 'const now = Date.now();';
    const exceptions = {
        [filePath]: [{
            snippet: 'const now = performance.now();',
            tokens: { 'performance.now': 1 },
            reason: 'stale source line',
        }],
    };
    const result = applySourceExceptions(filePath, source, findDeterminismViolations(source), exceptions);

    assert.ok(result.failures.some((failure) => failure.detail === 'source_exception_stale_snippet'));
    assert.deepEqual(result.violations.map((violation) => violation.detail), ['Date.now(']);
});

test('duplicate snippets and mismatched line-use counts fail closed', () => {
    const filePath = 'src/network/LatencyMonitor.js';
    const snippet = 'const id = Math.random() + Math.random();';
    const entry = { snippet, tokens: { 'Math.random': 1 }, reason: 'expected one use' };
    const duplicate = applySourceExceptions(filePath, snippet, findDeterminismViolations(snippet), {
        [filePath]: [entry, { ...entry }],
    });
    assert.ok(duplicate.failures.some((failure) => failure.detail === 'source_exception_duplicate_snippet'));
    assert.equal(duplicate.violations.length, 2);

    const countMismatch = applySourceExceptions(filePath, snippet, findDeterminismViolations(snippet), {
        [filePath]: [entry],
    });
    assert.ok(countMismatch.failures.some((failure) => failure.detail.includes('use_count_mismatch:Math.random:expected=1:actual=2')));
    assert.equal(countMismatch.violations.length, 2);
});

test('usage counts ignore capability checks and enforce repeated source-line totals', () => {
    const filePath = 'src/hunt/HuntTargetingOps.js';
    const capabilityAndCall = "const sample = typeof performance.now === 'function' ? performance.now() : 0;";
    const capabilityResult = applySourceExceptions(filePath, capabilityAndCall, findDeterminismViolations(capabilityAndCall), {
        [filePath]: [{
            snippet: capabilityAndCall,
            tokens: { 'performance.now': 1 },
            reason: 'capability check plus one actual timing sample',
        }],
    });
    assert.deepEqual(capabilityResult.failures, []);
    assert.deepEqual(capabilityResult.violations, []);

    const repeatedLine = 'const timestamp = Date.now();';
    const twoLines = `${repeatedLine}\n${repeatedLine}`;
    const twoLineException = {
        [filePath]: [{
            snippet: repeatedLine,
            tokens: { 'Date.now': 1 },
            expectedLines: 2,
            reason: 'two persisted epoch metadata sites',
        }],
    };
    const twoLineResult = applySourceExceptions(filePath, twoLines, findDeterminismViolations(twoLines), twoLineException);
    assert.deepEqual(twoLineResult.failures, []);
    assert.deepEqual(twoLineResult.violations, []);

    const threeLines = `${twoLines}\n${repeatedLine}`;
    const overflowResult = applySourceExceptions(filePath, threeLines, findDeterminismViolations(threeLines), twoLineException);
    assert.ok(overflowResult.failures.some((failure) => failure.detail === 'source_exception_snippet_line_count_mismatch'));
    assert.equal(overflowResult.violations.length, 3);
});

test('a pure re-export shell adds its out-of-scope local target to the scan closure', () => {
    const shellPath = 'src/entities/PickupRegistry.js';
    const targetPath = 'src/shared/contracts/PickupRegistryContract.js';
    const targetSource = 'export function pickWeightedPickupType(types, modeType, random = Math.random) {}';
    const sources = new Map([
        [shellPath, "export * from '../shared/contracts/PickupRegistryContract.js';"],
        [targetPath, targetSource],
    ]);
    const plan = buildReExportScanPlan([shellPath], sources, new Set(sources.keys()));

    assert.deepEqual(plan.failures, []);
    assert.deepEqual(plan.shells, [shellPath]);
    assert.ok(plan.files.includes(targetPath));
    assert.deepEqual(findDeterminismViolations(targetSource).map((violation) => violation.token), ['Math.random']);
});

test('mixed modules keep scanning their code and follow re-export targets transitively', () => {
    const wrapper = 'src/entities/MixedWrapper.js';
    const pureShell = 'src/shared/PureShell.js';
    const target = 'src/shared/contracts/ClockSource.js';
    const wrapperSource = [
        "export { source } from '../shared/PureShell.js';",
        'const localEntropy = Math.random;',
    ].join('\n');
    const targetSource = 'export const source = Date.now();';
    const sources = new Map([
        [wrapper, wrapperSource],
        [pureShell, "export { source } from './contracts/ClockSource.js';"],
        [target, targetSource],
    ]);
    const plan = buildReExportScanPlan([wrapper], sources, new Set(sources.keys()));

    assert.deepEqual(plan.failures, []);
    assert.ok(plan.files.includes(wrapper));
    assert.ok(plan.files.includes(pureShell));
    assert.ok(plan.files.includes(target));
    assert.deepEqual(plan.shells, [pureShell]);
    assert.deepEqual(findDeterminismViolations(wrapperSource).map((violation) => violation.token), ['Math.random']);
    assert.deepEqual(findDeterminismViolations(targetSource).map((violation) => violation.token), ['Date.now']);
});

test('transitive re-export targets are followed and cycles fail without recurring forever', () => {
    const first = 'src/entities/One.js';
    const second = 'src/shared/Two.js';
    const third = 'src/shared/contracts/Three.js';
    const sources = new Map([
        [first, "export { value } from '../shared/Two.js';"],
        [second, "export * from './contracts/Three.js';"],
        [third, 'export const value = 1;'],
    ]);
    const plan = buildReExportScanPlan([first], sources, new Set(sources.keys()));
    assert.deepEqual(plan.failures, []);
    assert.deepEqual(new Set(plan.shells), new Set([first, second]));
    assert.ok(plan.files.includes(third));

    const cycle = new Map([
        [first, "export * from '../shared/Two.js';"],
        [second, "export * from '../entities/One.js';"],
    ]);
    const cyclePlan = buildReExportScanPlan([first], cycle, new Set(cycle.keys()));
    assert.ok(cyclePlan.failures.some((failure) => failure.detail.startsWith('reexport_cycle:')));
    assert.equal(cyclePlan.files.length, 2);
});

test('missing or non-local re-export targets fail closed, and unsupported shells remain scan code', () => {
    const shellPath = 'src/entities/PickupRegistry.js';
    const missing = buildReExportScanPlan(
        [shellPath],
        new Map([[shellPath, "export * from '../shared/contracts/Missing.js';"]]),
        new Set([shellPath])
    );
    assert.ok(missing.failures.some((failure) => failure.detail === 'reexport_target_missing'));

    const external = buildReExportScanPlan(
        [shellPath],
        new Map([[shellPath, "export * from 'external-package';"]]),
        new Set([shellPath])
    );
    assert.ok(external.failures.some((failure) => failure.detail === 'reexport_target_not_local'));

    const ambiguousPaths = new Set([shellPath, 'src/shared/contracts/Choice.js', 'src/shared/contracts/Choice/index.js']);
    const ambiguous = buildReExportScanPlan(
        [shellPath],
        new Map([[shellPath, "export * from '../shared/contracts/Choice';"]]),
        ambiguousPaths
    );
    assert.ok(ambiguous.failures.some((failure) => failure.detail === 'reexport_target_ambiguous'));

    const notPure = "export const selected = Math.random;";
    assert.equal(extractPureReExportTargets(notPure), null);
    assert.deepEqual(findDeterminismViolations(notPure).map((violation) => violation.token), ['Math.random']);

    const fakeExports = [
        "// export * from '../shared/contracts/Missing.js';",
        "const description = \"export * from '../shared/contracts/AlsoMissing.js';\";",
    ].join('\n');
    assert.equal(extractPureReExportTargets(fakeExports), null);
    const fakePlan = buildReExportScanPlan([shellPath], new Map([[shellPath, fakeExports]]), new Set([shellPath]));
    assert.deepEqual(fakePlan.failures, []);
    assert.deepEqual(fakePlan.files, [shellPath]);
});
