import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { releaseButtonOnlyArcadeRun } from '../src/ui/arcade/ArcadeRunTypeOps.js';

test('the generic arcade start releases runs that only their own button may start', () => {
    for (const runType of ['five_portals', 'arena_waves']) {
        const settings = { arcade: { runType, combatProfile: 'hunt' } };
        assert.equal(releaseButtonOnlyArcadeRun(settings), true, runType);
        assert.deepEqual(settings.arcade, { runType: 'gauntlet', combatProfile: '' }, runType);
    }
});

test('preset driven and normal run types stay untouched', () => {
    for (const runType of ['endless_parcours', 'gauntlet', '']) {
        const settings = { arcade: { runType, combatProfile: 'hunt' } };
        assert.equal(releaseButtonOnlyArcadeRun(settings), false, runType);
        assert.equal(settings.arcade.runType, runType);
    }
    assert.equal(releaseButtonOnlyArcadeRun({}), false);
    assert.equal(releaseButtonOnlyArcadeRun(null), false);
});

test('the arcade start button handler releases a leftover button-only run before it starts', () => {
    const source = readFileSync(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    const handler = source.slice(source.indexOf('bind(ui.startButton'));
    assert.ok(handler.indexOf('releaseButtonOnlyArcadeRun(settings)') > 0, 'generic start must release the run type');
    assert.ok(
        handler.indexOf('releaseButtonOnlyArcadeRun(settings)') < handler.indexOf('prepareHangarRunStart()'),
        'the release happens before the run is prepared'
    );
});
