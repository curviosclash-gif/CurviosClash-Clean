import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const checker = path.resolve('scripts/check-commit-message.mjs');

function check(message) {
    const directory = mkdtempSync(path.join(tmpdir(), 'curvios-commit-message-'));
    const messageFile = path.join(directory, 'COMMIT_EDITMSG');
    writeFileSync(messageFile, `${message}\n`, 'utf8');

    try {
        return spawnSync(process.execPath, [checker, messageFile], {
            encoding: 'utf8',
        });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test('accepts scoped Conventional Commit subjects', () => {
    assert.equal(check('feat(hangar): add vehicle presets').status, 0);
    assert.equal(check('fix(runtime/session): clean up resources').status, 0);
});

test('accepts Git-generated merge and revert subjects', () => {
    assert.equal(check('Merge branch \'main\'').status, 0);
    assert.equal(check('Revert "feat(hangar): add vehicle presets"').status, 0);
});

test('rejects unscoped or vague subjects', () => {
    assert.equal(check('fix: clean up resources').status, 1);
    assert.equal(check('updated stuff').status, 1);
});
