import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeRunPersistenceScheduler } from '../src/core/arcade/ArcadeRunPersistenceScheduler.js';

test('Arcade persistence uses browser-safe bound default timers', () => {
    const scheduler = new ArcadeRunPersistenceScheduler({ saveThrottleMs: 100 });
    assert.match(scheduler._setTimeout.name, /^bound /);
    assert.match(scheduler._clearTimeout.name, /^bound /);
    scheduler.dispose();
});
