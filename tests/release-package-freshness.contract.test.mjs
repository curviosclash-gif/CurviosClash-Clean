import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-release-package-fresh.mjs');

const OLD = new Date('2020-01-01T00:00:00Z');
const NEW = new Date('2020-01-02T00:00:00Z');

function createFixture(t) {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'curvios-freshness-'));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    return fixture;
}

function writeDated(filePath, date) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, 'fixture');
    utimesSync(filePath, date, date);
}

function runFreshnessCheck(marker, inputs) {
    return spawnSync(process.execPath, [SCRIPT, marker, ...inputs], { encoding: 'utf8' });
}

test('freshness check exits 0 when the package marker is newer than all inputs', (t) => {
    const fixture = createFixture(t);
    const marker = path.join(fixture, 'pkg', 'index.html');
    const source = path.join(fixture, 'src', 'ui', 'HUD.js');
    writeDated(marker, NEW);
    writeDated(source, OLD);

    const result = runFreshnessCheck(marker, [path.join(fixture, 'src')]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /^fresh:/);
});

test('freshness check exits 1 with the stale file when an input is newer than the marker', (t) => {
    const fixture = createFixture(t);
    const marker = path.join(fixture, 'pkg', 'index.html');
    const older = path.join(fixture, 'src', 'old.js');
    const newer = path.join(fixture, 'src', 'ui', 'new.js');
    writeDated(marker, OLD);
    writeDated(older, OLD);
    writeDated(newer, NEW);

    const result = runFreshnessCheck(marker, [path.join(fixture, 'src'), marker]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /^stale:/);
    assert.ok(result.stdout.includes('new.js'), `stale reason names the newest input: ${result.stdout}`);
});

test('freshness check exits 1 when the package marker is missing', (t) => {
    const fixture = createFixture(t);
    const marker = path.join(fixture, 'pkg', 'index.html');
    const source = path.join(fixture, 'src', 'HUD.js');
    writeDated(source, OLD);

    const result = runFreshnessCheck(marker, [path.join(fixture, 'src')]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /^stale:/);
});

test('freshness check ignores node_modules trees inside watched inputs', (t) => {
    const fixture = createFixture(t);
    const marker = path.join(fixture, 'pkg', 'index.html');
    const tracked = path.join(fixture, 'electron', 'main.cjs');
    const dependency = path.join(fixture, 'electron', 'node_modules', 'dep', 'index.js');
    writeDated(marker, NEW);
    writeDated(tracked, OLD);
    writeDated(dependency, NEW); // newer than the marker, but excluded

    const result = runFreshnessCheck(marker, [path.join(fixture, 'electron')]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('freshness check exits 2 without a marker argument', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage:/);
});

test('package launcher rebuilds stale packages through the freshness subroutine', () => {
    const source = readFileSync(path.join(ROOT, 'START_CURVIOSCLASH.cmd'), 'utf8');

    assert.match(source, /call :package_is_valid/);
    assert.match(source, /call :package_is_stale/);
    assert.match(source, /if errorlevel 1 goto :package_outdated/);
    assert.match(source, /:package_is_stale/);
    assert.ok(
        source.includes('scripts\\check-release-package-fresh.mjs'),
        'freshness subroutine invokes the node freshness script'
    );
    assert.ok(
        source.includes('resources\\dist-app\\index.html'),
        'freshness check uses the packaged renderer as marker'
    );
    // A missing helper or Node.js must never block launching a valid package.
    assert.match(source, /check-release-package-fresh\.mjs" exit \/b 0/);
    // Staleness detection feeds back into the regular package build path.
    assert.ok(
        source.indexOf('goto :package_outdated') < source.indexOf('call npm run app:package'),
        'outdated packages reach the app:package build step'
    );
    assert.match(source, /call npm run app:package/);
    assert.match(source, /"%PACKAGE_EXE%" %\*/);
});
