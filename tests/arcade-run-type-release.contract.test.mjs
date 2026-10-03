import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { releaseButtonOnlyArcadeRun } from '../src/ui/arcade/ArcadeRunTypeOps.js';

test('the generic arcade start releases runs that only their own button may start', () => {
    for (const runType of ['five_portals', 'arena_waves', 'weapon_race', 'demolition']) {
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

test('the generic arcade capture guard releases button-only runs before preparing a run', () => {
    const source = readFileSync(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    const binding = source.match(/bindValidatedArcadeStartCapture\s*\(\s*bind\s*,\s*ui\.startButton\s*,[\s\S]*?\n\s*\}\);/);
    assert.ok(binding, 'generic start remains registered through the capture guard');
    const handler = binding[0];
    assert.match(handler, /\(\) => shouldShowArcade\(settings\)/, 'non-Arcade starts bypass the Arcade-only guard');
    assert.match(handler, /\(\) => validateLocalArcadeProfileStart\(settings, arcadeProfiles, runtimeAccess\)/,
        'Arcade profile validation remains the capture-phase gate');

    const validate = handler.indexOf('validateLocalArcadeProfileStart(settings, arcadeProfiles, runtimeAccess)');
    const release = handler.indexOf('releaseButtonOnlyArcadeRun(settings)');
    const prepare = handler.indexOf('prepareHangarRunStart()');
    assert.ok(validate >= 0 && release > validate && prepare > release,
        'the actual guarded callback validates, releases the leftover run type, then prepares');
});
