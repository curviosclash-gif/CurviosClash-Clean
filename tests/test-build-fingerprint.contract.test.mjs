import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkTestBuildFresh } from '../scripts/playtest/playtest-provenance.mjs';
import { computeSourceFingerprint, writeBuildFingerprint } from '../scripts/test-build-fingerprint.mjs';

const roots = [];
test.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curvios-build-fp-'));
    roots.push(dir);
    return dir;
}

function makeRepo() {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'src', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'game.js'), 'export const speed = 22;\n');
    fs.writeFileSync(path.join(root, 'src', 'node_modules', 'dep.js'), 'ignored\n');
    fs.writeFileSync(path.join(root, 'style.css'), 'body {}\n');
    // Every source predates the builds below; each test moves only the file it is about.
    for (const file of ['src/game.js', 'src/node_modules/dep.js', 'style.css']) fs.utimesSync(path.join(root, file), 500, 500);
    return root;
}

/** A build made at `builtAt` (seconds) from the sources as they are now. */
function build(root, builtAt, { fingerprint = true } = {}) {
    const dir = path.join(root, 'dist-app-test');
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, 'index.html');
    fs.writeFileSync(marker, '<!doctype html>');
    fs.utimesSync(marker, builtAt, builtAt);
    if (fingerprint) writeBuildFingerprint(dir, computeSourceFingerprint(root));
}

function touch(file, at) {
    fs.utimesSync(file, at, at);
}

test('a source rewritten with the same content keeps the build fresh', () => {
    const root = makeRepo();
    build(root, 1000);
    touch(path.join(root, 'src', 'game.js'), 2000);
    const result = checkTestBuildFresh(root);
    assert.equal(result.fresh, true, result.reason);
    assert.equal(result.checkedBy, 'content');
});

test('a source with changed content makes the build stale', () => {
    const root = makeRepo();
    build(root, 1000);
    fs.writeFileSync(path.join(root, 'src', 'game.js'), 'export const speed = 30;\n');
    touch(path.join(root, 'src', 'game.js'), 2000);
    const result = checkTestBuildFresh(root);
    assert.equal(result.fresh, false);
    assert.equal(result.checkedBy, 'content');
    assert.match(result.reason, /game\.js/);
});

test('a build without a stored fingerprint keeps the timestamp verdict', () => {
    const root = makeRepo();
    build(root, 1000, { fingerprint: false });
    touch(path.join(root, 'src', 'game.js'), 2000);
    assert.deepEqual(
        { fresh: checkTestBuildFresh(root).fresh, by: checkTestBuildFresh(root).checkedBy },
        { fresh: false, by: 'timestamp' },
    );
});

test('the fingerprint ignores excluded folders and follows file renames', () => {
    const root = makeRepo();
    const before = computeSourceFingerprint(root).fingerprint;
    fs.writeFileSync(path.join(root, 'src', 'node_modules', 'dep.js'), 'changed\n');
    assert.equal(computeSourceFingerprint(root).fingerprint, before);
    fs.renameSync(path.join(root, 'src', 'game.js'), path.join(root, 'src', 'ship.js'));
    assert.notEqual(computeSourceFingerprint(root).fingerprint, before);
});

test('a node_modules junction (as in a worktree) is skipped like a real folder', () => {
    const root = makeRepo();
    const shared = makeTempDir();
    fs.writeFileSync(path.join(shared, 'big.js'), 'shared dependency\n');
    const before = computeSourceFingerprint(root);
    fs.mkdirSync(path.join(root, 'electron'));
    fs.symlinkSync(shared, path.join(root, 'electron', 'node_modules'), 'junction');
    assert.deepEqual(computeSourceFingerprint(root), before);
});

test('a missing build is never fresh', () => {
    assert.equal(checkTestBuildFresh(makeRepo()).fresh, false);
});
