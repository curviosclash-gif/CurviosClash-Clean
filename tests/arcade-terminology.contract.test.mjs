// One vocabulary for the Arcade texts: "Kombo" (as on the result board, ArcadeResultTexts.js),
// "Karte" instead of "Map", "Modifikator" instead of "Modifier", German mission names, readable
// racer names instead of "Fahrer 0", and the Five Fronts advantage is said to last for this run
// only (the old text called it permanent).
import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { MISSION_TYPES } from '../src/shared/contracts/ArcadeMissionContract.js';

registerMapCatalogConfigSource({ MAPS: { standard: { name: 'Standardarena', size: [80, 30, 80] } } });

const { ArcadeScoreHUD } = await import('../src/ui/arcade/ArcadeScoreHUD.js');
const { MatchFlowArcadeOverlayController } = await import('../src/ui/MatchFlowArcadeOverlayController.js');

function element(tagName = 'div') {
    return {
        tagName, id: '', textContent: '', className: '', attributes: {}, children: [], style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren() { this.children.length = 0; },
        removeChild(child) { this.children = this.children.filter((node) => node !== child); return child; },
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        addEventListener() {},
        focus() {},
        querySelector() { return null; },
    };
}

function textOf(node) {
    return [node.textContent, ...(node.children || []).map(textOf)].join('\n');
}

function withDom(run) {
    const previous = globalThis.document;
    globalThis.document = { createElement: (tag) => element(tag), getElementById: () => null };
    try {
        return run();
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
}

const ENGLISH_HUD_WORDS = /\b(Combo|Map|Modifier|Fahrer)\b/;

test('the score box says Kombo, Karte and Modifikator', () => {
    withDom(() => {
        const hud = new ArcadeScoreHUD(element());
        hud.update({ runType: '', phase: 'sector_active', sectorIndex: 1, score: { total: 0, breakdown: {} } });
        const standard = textOf(hud._container);
        assert.match(standard, /Kombo/);
        assert.match(standard, /Kein Modifikator aktiv/);
        assert.doesNotMatch(standard, ENGLISH_HUD_WORDS);

        hud.update({ runType: 'five_portals', mapIndex: 0, mapCount: 5, currentMapKey: 'standard', currentTimeMs: 0 });
        assert.equal(hud._scoreLabel.textContent, 'Kartenzeit');
        assert.match(hud._arenaWavesSection.textContent, /^Karte 1\/5: Standardarena/);
    });
});

test('the weapon race standings name the player and the bots instead of "Fahrer 0"', () => {
    withDom(() => {
        const hud = new ArcadeScoreHUD(element());
        hud.update({
            runType: 'weapon_race', place: 2, racerCount: 3, checkpoint: 1, checkpointCount: 9,
            standings: [
                { playerId: '2', place: 1, result: 'finished', finishTimeMs: 61000 },
                { playerId: '0', place: 2, result: 'DNF', checkpointIndex: 4 },
                { playerId: '1', place: 3, result: 'DNF', checkpointIndex: 2 },
            ],
        });
        const text = hud._arenaWavesSection.textContent;
        assert.match(text, /1\. Bot 3 · 01:01/);
        assert.match(text, /2\. Spieler 1 · CP 4/);
        assert.match(text, /3\. Bot 2 · CP 2/);
        assert.doesNotMatch(text, /Fahrer/);
    });
});

test('the Five Fronts advantage lasts for this run, not for ever', () => {
    withDom(() => {
        const controller = new MatchFlowArcadeOverlayController({ runtime: { ui: { messageOverlay: element() } }, runtimePort: {} });
        controller._renderArenaWavesUpgradePanel({ runType: 'arena_waves', phase: 'upgrade', choices: ['speed'] });
        const text = textOf(controller._arcadeOverlayPanel);
        assert.match(text, /für diesen Run/);
        assert.doesNotMatch(text, /dauerhaft/);
    });
});

test('the intermission route choice says Karte and Modifikator', () => {
    withDom(() => {
        const controller = new MatchFlowArcadeOverlayController({ runtime: { ui: { messageOverlay: element() } }, runtimePort: {} });
        controller._renderArcadeIntermissionPanel({
            intermission: { nextSectorIndex: 2, choices: [{ id: 'a', mapKey: 'standard' }], rewardChoices: [] },
        });
        const text = textOf(controller._arcadeOverlayPanel);
        assert.match(text, /Karten- und Modifikator-Wahl/);
        assert.match(text, /Kein Modifikator/);
        // The "Nächster Sektor" card (postrun/ArcadePostRunBlocks.js) still says "Modifier"; it is
        // outside this change, so only the choice itself is checked here.
        assert.doesNotMatch(text, /Map-\/Modifier-Wahl|Kein Modifier\nStandardsektor/);
    });
});

test('mission names and progress lines are German', () => {
    const english = /\b(Eliminate|Collect|Survive|Reach|Exit|Speed Run|No Damage|Untouched|Hits|Trail Master|Item Chain|chain|Close Call|survived|Done|Find)\b/;
    for (const [id, type] of Object.entries(MISSION_TYPES)) {
        assert.doesNotMatch(type.label, english, `${id} label "${type.label}"`);
        for (const progress of [{}, { reached: true, hitCount: 2, chain: 1, count: 1 }]) {
            const line = type.format(progress);
            assert.doesNotMatch(line, english, `${id} progress "${line}"`);
        }
    }
    assert.equal(MISSION_TYPES.KILL_COUNT.label, 'Gegner ausschalten');
    assert.equal(MISSION_TYPES.COLLECT_ITEMS.label, 'Items sammeln');
});
