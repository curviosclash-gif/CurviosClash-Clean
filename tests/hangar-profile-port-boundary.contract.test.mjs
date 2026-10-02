import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readSource(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('the hangar page composes its state-backed profile port outside UI', () => {
    const html = readSource('../hangar.html');
    const entry = readSource('../src/composition/entries/HangarWindowEntry.js');
    const app = readSource('../src/ui/hangar/HangarWindowApp.js');

    assert.match(html, /src="\/src\/composition\/entries\/HangarWindowEntry\.js"/);
    assert.match(entry, /from '\.\.\/\.\.\/state\/arcade\/ArcadeVehicleProfileWorkshopPort\.js'/);
    assert.match(entry, /arcadeVehicleProfileWorkshop:\s*createArcadeVehicleProfileWorkshopPort\(playerStore\)/);
    assert.match(entry, /startHangarWindowApp\(\{\s*settings:\s*store\.loadSettings\(\),\s*runtimeAccess\s*\}\)/);
    assert.match(app, /export function startHangarWindowApp\(\{\s*settings\s*=\s*\{\},\s*runtimeAccess/);
    assert.match(app, /setupArcadeHangarWorkshop\(\{[\s\S]*?runtimeAccess,/);
    assert.doesNotMatch(app, /from ['"][^'"]*state\/arcade\//);
});

test('the UI fallback cannot overwrite profile records without the safe state port', () => {
    const support = readSource('../src/ui/hangar/HangarWorkshopProfileSupport.js');
    assert.doesNotMatch(support, /from ['"][^'"]*state\/arcade\//);
    assert.match(support, /save\(\)\s*\{\s*return false;\s*\}/);
});
