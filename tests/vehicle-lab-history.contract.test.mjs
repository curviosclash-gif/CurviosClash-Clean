import assert from 'node:assert/strict';
import test from 'node:test';

import { VehicleHistory } from '../prototypes/vehicle-lab/src/VehicleHistory.js';

test('VehicleHistory exposes undo and redo state for workshop status controls', () => {
    const history = new VehicleHistory({ parts: [{ name: 'Base' }] });

    assert.deepEqual(history.getState(), {
        index: 0,
        length: 1,
        canUndo: false,
        canRedo: false,
    });

    history.save({ parts: [{ name: 'Base' }, { name: 'Wing' }] });
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);

    const previous = history.undo();
    assert.equal(previous.parts.length, 1);
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), true);

    const next = history.redo();
    assert.equal(next.parts.length, 2);
    assert.equal(history.getState().index, 1);
});

test('VehicleHistory drops redo branch after a new workshop edit', () => {
    const history = new VehicleHistory({ parts: [{ name: 'Base' }] });
    history.save({ parts: [{ name: 'Base' }, { name: 'Wing' }] });
    history.undo();

    history.save({ parts: [{ name: 'Base' }, { name: 'Engine' }] });

    assert.equal(history.canRedo(), false);
    assert.equal(history.getState().length, 2);
    assert.equal(history.redo(), null);
});
