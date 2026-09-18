// Editor export: a checkpoint whose centre sits inside collision blocks the export (it used to be a
// warning shared with "too far apart" that could simply be acknowledged). Same rule as
// check:parcours for preset maps, so no new parcours map can ship a blocked ring.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    EDITOR_BLOCKING_CHECKPOINT_CODE,
    resolveCheckpointValidationItems,
} from '../editor/js/ui/EditorCheckpointValidation.js';

const at = (id, x) => ({ userData: { id }, position: { x, y: 0, z: 0, distanceTo: (other) => Math.abs(other.x - x) } });

test('a blocked checkpoint centre is its own blocking item', () => {
    const checkpoints = [at('cp1', 0), at('cp2', 50), at('cp3', 100)];
    const items = resolveCheckpointValidationItems({
        checkpoints, isBlocked: (position) => position.x === 50, maxSegmentDistance: 500,
    });
    const blocked = items.find((item) => item.code === EDITOR_BLOCKING_CHECKPOINT_CODE);
    assert.equal(blocked.ok, false);
    assert.deepEqual(blocked.objectIds, ['cp2']);
    assert.equal(items.find((item) => item.code === 'checkpoint-reachability').ok, true);
});

test('distance alone stays a warning item', () => {
    const items = resolveCheckpointValidationItems({
        checkpoints: [at('cp1', 0), at('cp2', 900)], isBlocked: () => false, maxSegmentDistance: 500,
    });
    assert.equal(items.find((item) => item.code === EDITOR_BLOCKING_CHECKPOINT_CODE).ok, true);
    assert.deepEqual(items.find((item) => item.code === 'checkpoint-reachability').objectIds, ['cp2']);
});

test('the export treats the blocked checkpoint code as an error', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../editor/js/ui/EditorWorkspaceControls.js', import.meta.url), 'utf8');
    const block = /BLOCKING_EXPORT_VALIDATION_CODES = new Set\(\[([^\]]*)\]/.exec(source)?.[1] || '';
    assert.match(block, /EDITOR_BLOCKING_CHECKPOINT_CODE/);
    assert.match(source, /resolveCheckpointValidationItems\(/);
});
