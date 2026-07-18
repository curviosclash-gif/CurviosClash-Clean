import assert from 'node:assert/strict';
import test from 'node:test';

import { readPlaytestSessionType } from '../src/core/PlaytestLaunchParams.js';

test('playtest session accepts only supported offline session types', () => {
    assert.equal(readPlaytestSessionType('?session=single'), 'single');
    assert.equal(readPlaytestSessionType('?session=splitscreen'), 'splitscreen');
    assert.equal(readPlaytestSessionType('?session=multiplayer'), null);
    assert.equal(readPlaytestSessionType('?session=unknown'), null);
    assert.equal(readPlaytestSessionType(''), null);
});
