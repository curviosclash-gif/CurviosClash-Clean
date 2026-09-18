// ============================================
// spec-serial-mode.contract.test.mjs - the core-targeted specs must not chain
// ============================================
//
// A serial describe makes Playwright skip every remaining test of the block as soon as one
// fails ("didNotRun"). In core-surface that hid 38 of 47 tests behind a single red one, so a
// run said nothing about the area it was started for. Every desktop test gets its own Electron
// app (fixture `desktopHarness` in tests/helpers.desktop.js), calls loadGame itself and cleans
// up the storage keys it wrote, so the chain buys nothing and costs the whole verdict.
//
// Removing the chain does not reorder anything: playwright.config.js runs with
// fullyParallel:false and one worker, so the declaration order stays exactly as it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Both spellings Playwright accepts for a serial block.
 * `test.describe.configure({ mode: 'serial' })` and `test.describe.serial(...)`.
 */
const SERIAL_PATTERN = /test\.describe\.(?:configure\s*\(\s*\{[^}]*mode\s*:\s*['"]serial['"]|serial\s*\()/;

/**
 * Files that stay serial on purpose. Key = file name, value = the reason.
 * An entry is a decision, not a parking spot: it has to name why the chain is worth the
 * blindness. Empty today - the five core-targeted specs all run unchained.
 */
const SERIAL_EXCEPTIONS = Object.freeze({});

function readSpec(fileName) {
    return readFileSync(path.join(TESTS_DIR, fileName), 'utf8');
}

function listCoreTargetedSpecs() {
    return readdirSync(TESTS_DIR)
        .filter((name) => /^core-targeted.*\.spec\.js$/.test(name))
        .sort();
}

test('the serial detector actually matches a serial block', () => {
    // Counter-check first: a guard whose pattern never fires is green for the wrong reason.
    assert.equal(SERIAL_PATTERN.test("    test.describe.configure({ mode: 'serial' });"), true);
    assert.equal(SERIAL_PATTERN.test('    test.describe.configure({ mode: "serial" });'), true);
    assert.equal(SERIAL_PATTERN.test("test.describe.serial('block', () => {"), true);
    assert.equal(SERIAL_PATTERN.test("    test.describe.configure({ timeout: 120000 });"), false);
    assert.equal(SERIAL_PATTERN.test("// mode: 'serial' was removed here"), false);
});

test('the guard looks at every core-targeted spec', () => {
    const specs = listCoreTargetedSpecs();
    assert.deepEqual(specs, [
        'core-targeted-platform.spec.js',
        'core-targeted-regressions.spec.js',
        'core-targeted-runtime.spec.js',
        'core-targeted-surface.spec.js',
        'core-targeted.spec.js',
    ]);
});

test('no core-targeted spec chains its tests with mode: serial', () => {
    const offenders = listCoreTargetedSpecs()
        .filter((fileName) => SERIAL_PATTERN.test(readSpec(fileName)))
        .filter((fileName) => !Object.prototype.hasOwnProperty.call(SERIAL_EXCEPTIONS, fileName));

    assert.deepEqual(
        offenders,
        [],
        `Serial blocks hide every later test of the file behind the first red one. `
        + `Remove the chain or add the file to SERIAL_EXCEPTIONS with a reason: ${offenders.join(', ')}`
    );
});

test('every serial exception carries a reason', () => {
    for (const [fileName, reason] of Object.entries(SERIAL_EXCEPTIONS)) {
        assert.equal(typeof reason, 'string');
        assert.ok(reason.trim().length >= 20, `${fileName} needs a real reason, not "${reason}"`);
        assert.equal(
            SERIAL_PATTERN.test(readSpec(fileName)),
            true,
            `${fileName} is listed as an exception but is not serial any more - drop the entry`
        );
    }
});

// stress.spec.js keeps its chain on purpose, so the decision is pinned here instead of living
// only in a plan document: T64 and T66 park corrupted settings in the shared user profile and
// only clean up in their last line. The profile is per run, not per test (helpers.desktop.js
// resolveDesktopUserDataRoot), so a test that dies before its cleanup would poison every
// following test of the file. It also runs only in the on-request cluster `gpu-stress`, where
// the hidden tests cost the standard suite nothing.
test('stress.spec.js keeps its serial chain on purpose', () => {
    assert.equal(
        SERIAL_PATTERN.test(readSpec('stress.spec.js')),
        true,
        'stress.spec.js writes corrupted settings into the shared profile and cleans up last; '
        + 'unchaining it would turn one red test into a cascade. Change this only with a decision.'
    );
});
