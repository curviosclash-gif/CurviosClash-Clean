import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lfsHookNames = ['post-checkout', 'post-commit', 'post-merge', 'pre-push'];

test('Git LFS hooks remain tracked alongside the existing commit-message hook', () => {
    const trackedHooks = execFileSync('git', ['ls-files', '--stage', '--', '.githooks'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    })
        .split(/\r?\n/)
        .filter(Boolean)
        .map((entry) => {
            const match = /^(\d{6}) [a-f0-9]+ 0\t(.+)$/.exec(entry);
            assert.ok(match, `unexpected staged hook entry: ${entry}`);
            return { mode: match[1], file: match[2] };
        })
        .sort((left, right) => left.file.localeCompare(right.file));

    assert.deepEqual(trackedHooks, [
        { mode: '100755', file: '.githooks/commit-msg' },
        ...lfsHookNames.map((name) => ({ mode: '100755', file: `.githooks/${name}` })),
    ].sort((left, right) => left.file.localeCompare(right.file)));
});

test('each versioned LFS hook guards the dependency and dispatches its matching lifecycle event', () => {
    for (const hookName of lfsHookNames) {
        const source = readFileSync(new URL(`../.githooks/${hookName}`, import.meta.url), 'utf8');
        assert.match(source, /^#!\/bin\/sh/m, `${hookName} should use the portable shell`);
        assert.match(source, /command -v git-lfs/, `${hookName} should explain the required dependency`);
        assert.match(source, new RegExp(`^git lfs ${hookName} "\\$@"$`, 'm'));
    }
});
