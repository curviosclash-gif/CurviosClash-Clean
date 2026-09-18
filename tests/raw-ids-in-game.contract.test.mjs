import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { resolveArenaWavesChoiceLabel } from '../src/shared/contracts/ArenaWavesContract.js';
import { formatStartSetupMapLabel } from '../src/ui/start-setup/StartSetupValidationView.js';

test('five-fronts advantages read as plain German, not as ids', () => {
    const labels = ['speed', 'max_hp', 'pickup', 'mg_tuning', 'machine_gun:bastion_h3', 'supply:shield'].map(resolveArenaWavesChoiceLabel);
    labels.forEach((label) => assert.doesNotMatch(label, /_|machine_gun|supply:|\bmg\b|speed/u, label));
    assert.match(resolveArenaWavesChoiceLabel('machine_gun:bastion_h3'), /Bastion H3/);
    assert.match(resolveArenaWavesChoiceLabel('mg_tuning'), /MG/);
});

test('the map list shows the plain map name', () => {
    assert.equal(formatStartSetupMapLabel({ name: 'Parcours Rift', hasGlbModel: true }), 'Parcours Rift');
});

test('the two map filters called "Parcours" are told apart', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const collection = /<option value="parcours-collection">([^<]+)<\/option>/u.exec(html)?.[1];
    const feature = /<option value="parcours">([^<]+)<\/option>/u.exec(html)?.[1];
    assert.ok(collection && feature);
    assert.notEqual(collection, feature);
});

test('local 3- and 4-player modules offer "Klassisch" and "Kampf"', () => {
    for (const file of ['ThreePlayerSplitSetupView.js', 'FourPlayerPlanarSetupView.js']) {
        const source = readFileSync(new URL(`../src/ui/four-player-planar/${file}`, import.meta.url), 'utf8');
        assert.match(source, /<option value="classic">Klassisch<\/option>/u, file);
        assert.match(source, /<option value="hunt">Kampf<\/option>/u, file);
        assert.doesNotMatch(source, /Classic oder Hunt/u, file);
    }
});

test('the arcade run line names map, difficulty and vehicle instead of raw ids', () => {
    const source = readFileSync(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\$\{mapKey\} \| Bots/u);
    assert.doesNotMatch(source, /ship5 ohne Leistungsboni/u);
    assert.doesNotMatch(source, /toUpperCase\(\)\}` : ''/u);
});
