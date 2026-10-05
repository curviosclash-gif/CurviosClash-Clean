import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
    resolveDesktopUserDataRoot,
    resolveRunTag,
    resolveSpecProfileSlug,
} from './desktop-user-data-root.mjs';

const CWD = path.resolve('repo-root');
const profile = { file: path.join(CWD, 'tests', 'player-profiles.desktop.spec.js'), testId: 'abc123-def' };
const env = { PW_RUN_TAG: 'desktop-flows' };

function resolve(testInfo, extraEnv = {}) {
    return resolveDesktopUserDataRoot({ env: { ...env, ...extraEnv }, cwd: CWD, testInfo });
}

test('specs of one run get separate profile folders, so profiles and split settings cannot leak between files', () => {
    const polluter = resolve({ file: path.join(CWD, 'tests', 'arcade-profile-bindings.desktop.spec.js'), testId: 'a' });
    const victim = resolve({ file: path.join(CWD, 'tests', 'player-profiles.desktop.spec.js'), testId: 'b' });
    assert.notEqual(polluter, victim);
    assert.equal(path.dirname(polluter), path.dirname(victim));
    assert.equal(path.dirname(victim), path.join(CWD, 'tmp', 'playwright', 'desktop-flows', 'user-data'));
});

test('tests of the same spec file keep sharing one profile', () => {
    assert.equal(
        resolve({ ...profile, testId: 'first' }),
        resolve({ ...profile, testId: 'second' }),
    );
});

test('same basename in different folders does not share a profile', () => {
    const a = resolveSpecProfileSlug(path.join(CWD, 'tests', 'x.spec.js'), CWD);
    const b = resolveSpecProfileSlug(path.join(CWD, 'tests', 'sub', 'x.spec.js'), CWD);
    assert.notEqual(a, b);
});

test('PW_FRESH_PROFILE=1 still gives every test its own profile under the run root', () => {
    const first = resolve({ ...profile, testId: 'first' }, { PW_FRESH_PROFILE: '1' });
    const second = resolve({ ...profile, testId: 'second' }, { PW_FRESH_PROFILE: '1' });
    assert.notEqual(first, second);
    assert.equal(first, path.join(CWD, 'tmp', 'playwright', 'desktop-flows', 'user-data', 'first'));
});

test('a configured CURVIOS_USER_DATA_ROOT is the base for the per-spec folders', () => {
    const root = path.resolve('somewhere', 'profiles');
    const resolved = resolve(profile, { CURVIOS_USER_DATA_ROOT: root });
    assert.equal(path.dirname(resolved), root);
});

test('profile folder names are a single safe path segment', () => {
    const slug = resolveSpecProfileSlug(path.join(CWD, 'tests', '..', '..', 'evil name!.spec.js'), CWD);
    assert.match(slug, /^[a-zA-Z0-9-_]+$/);
    assert.equal(resolveRunTag({ PW_RUN_TAG: '../../out' }), 'out');
    assert.equal(resolveRunTag({}), 'local');
    assert.match(resolveSpecProfileSlug('', CWD), /^spec$/);
});
