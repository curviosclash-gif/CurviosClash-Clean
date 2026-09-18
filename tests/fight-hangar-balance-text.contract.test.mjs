import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { FIGHT_BALANCE_HINT, formatFightBalanceText } from '../src/ui/hangar/HangarWorkshopRenderText.js';

test('a balanced fight build reads as balanced, not as a budget of 0', () => {
    const text = formatFightBalanceText({ balanceScore: 0, bonuses: { speedBonusPct: 4, turningBonusPct: 0, maxHpBonus: -12 } });
    assert.equal(text, 'Ausgleich: ausgeglichen');
    assert.doesNotMatch(text, /Leistungsbudget/);
    assert.match(FIGHT_BALANCE_HINT, /Vorteil/);
});

test('an unbalanced fight build names the side it leans to', () => {
    assert.equal(
        formatFightBalanceText({ balanceScore: 12, bonuses: { speedBonusPct: 4, turningBonusPct: 0, maxHpBonus: 0 } }),
        'Ausgleich: +12 zugunsten Tempo'
    );
    assert.equal(
        formatFightBalanceText({ balanceScore: -6, bonuses: { speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: -6 } }),
        'Ausgleich: -6 zulasten Lebenspunkte'
    );
});

function readSource(path) {
    return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('the fight hangar speaks of the next fight, not the next run', () => {
    const workshop = readSource('../src/ui/hangar/ArcadeHangarWorkshop.js');
    assert.match(workshop, /hangarMode === 'fight' \? 'Build gespeichert und für den nächsten Kampf aktiviert\.'/);
    const renderer = readSource('../src/ui/hangar/ArcadeHangarWorkshopRenderer.js');
    assert.match(renderer, /Aktiver \$\{mode === 'fight' \? 'Kampf' : 'Run'\}-Build/);
    assert.doesNotMatch(renderer, /Leistungsbudget/);
    const shell = readSource('../src/ui/hangar/ArcadeHangarWorkshopShell.js');
    assert.match(shell, /mode === 'fight' \? 'Aktiver Kampf-Build: Standard' : 'Aktiver Run-Build: Standard'/);
});
