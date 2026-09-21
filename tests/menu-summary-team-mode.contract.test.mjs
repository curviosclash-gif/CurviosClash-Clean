import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatMenuRulesSummary,
    renderStartSetupSummaryAndPreview,
} from '../src/ui/start-setup/StartSetupMultiplayerUiSync.js';

function element() {
    const node = {
        children: [], textContent: '', dataset: {},
        classList: { add() {} },
        setAttribute() {},
        appendChild(child) { this.children.push(child); },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
    };
    Object.defineProperty(node, 'firstChild', { get() { return this.children[0] || null; } });
    return node;
}

const teamFight = {
    mode: '1p', gameMode: 'HUNT', numBots: 8, botDifficulty: 'EASY', winsNeeded: 12,
    vehicles: { PLAYER_1: 'ship5' },
    hunt: {
        teamMode: true, teamSize: 3, teamObjective: 'FLAGS',
        respawnEnabled: true, deathmatchKillLimit: 5,
    },
};

test('both menu summaries describe the active team objective instead of irrelevant counts', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: element };
    try {
        const menuSummary = element();
        const quickStartLastSummary = element();
        renderStartSetupSummaryAndPreview({
            ui: { menuSummary, quickStartLastSummary },
            settings: teamFight,
            sessionType: 'single', modePath: 'fight', effectiveMapKey: 'standard',
            surfaceEntryCopy: { sessionSummaryLabels: { single: 'Einzelspieler' } },
            sessionContract: {}, resolvedMultiplayerSessionState: null,
            hasActiveLobbySession: false,
            ghostDuelState: { effectiveMode: 'off', duelSelectable: false, effectiveTrailCollisionEnabled: false, trailCollisionSelectable: false },
        });
        const rules = menuSummary.children.find((child) => child.children[0]?.textContent === 'Regeln')?.children[1]?.textContent;
        assert.equal(rules, 'Teams 3 gegen 3 · Flaggen erobern');
        assert.match(quickStartLastSummary.textContent, /Teams 3 gegen 3 · Flaggen erobern/);
        assert.doesNotMatch(quickStartLastSummary.textContent, /Abschüsse|Siege|8 Bots/);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('team objectives have distinct labels and stale team flags do not affect Classic or Arcade', () => {
    assert.equal(formatMenuRulesSummary({ ...teamFight, hunt: { ...teamFight.hunt, teamObjective: 'ESCORT' } }, 'fight'),
        'Teams 3 gegen 3 · Panzer eskortieren');
    assert.equal(formatMenuRulesSummary({ ...teamFight, hunt: { ...teamFight.hunt, teamObjective: 'HUNT' } }, 'fight'),
        'Teams 3 gegen 3 · Teamkampf');
    assert.match(formatMenuRulesSummary({ ...teamFight, gameMode: 'CLASSIC' }, 'normal'), /8 Bots/);
    assert.match(formatMenuRulesSummary(teamFight, 'normal'), /8 Bots/);
    assert.match(formatMenuRulesSummary({ ...teamFight, gameMode: 'ARCADE', arcade: { sectorCount: 7 } }, 'arcade'), /7 Sektoren/);
    assert.match(formatMenuRulesSummary({ ...teamFight, hunt: { ...teamFight.hunt, teamMode: false } }, 'fight'), /5 Abschüsse/);
    assert.equal(formatMenuRulesSummary({ ...teamFight, gameMode: 'ESCORT', hunt: { teamMode: false, teamSize: 3 } }, 'fight'),
        'Teams 3 gegen 3 · Panzer eskortieren');
});
