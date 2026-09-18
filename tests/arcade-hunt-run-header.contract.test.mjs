// Endless hunt and Five Fronts run on the fight HUD, but they are not an elimination match: the
// header said "Elimination · letzter Überlebender gewinnt" and the Five Fronts / Five Portals score
// box printed the raw map key (notre_dame_arena) instead of the map name.

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

registerMapCatalogConfigSource({ MAPS: { notre_dame_arena: { name: 'Notre-Dame Arena', size: [80, 30, 80] } } });

const { HuntHUD } = await import('../src/ui/HuntHUD.js');
const { ArcadeScoreHUD } = await import('../src/ui/arcade/ArcadeScoreHUD.js');

function element() {
    const classes = new Set();
    return {
        style: {}, textContent: '', attributes: {}, children: [], dataset: {},
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        insertBefore(child) { this.children.push(child); return child; },
        querySelector() { return null; },
        remove() {},
    };
}

function headerFor(runType) {
    const objective = element();
    const hud = new HuntHUD({
        runtime: { activeGameMode: 'HUNT', state: 'PLAYING', runtimeConfig: { arcade: { enabled: true, runType } } },
        refs: { root: element(), objective, scoreboard: element() },
    });
    hud.update(0.2, {
        players: [{ playerIndex: 0, isBot: false, alive: true, hp: 100, maxHp: 100 }],
        hunt: { active: true, respawnEnabled: false, scoreboardRows: [], overheatByPlayer: {}, killFeed: [] },
    });
    return objective.textContent;
}

test('arcade hunt runs name their own goal instead of the elimination rule', () => {
    assert.doesNotMatch(headerFor('arena_waves'), /Elimination|Überlebender/);
    assert.match(headerFor('arena_waves'), /Fünf Fronten/);
    assert.doesNotMatch(headerFor('endless_parcours'), /Elimination|Überlebender/);
    assert.match(headerFor('endless_parcours'), /Endlosjagd/);
    assert.match(headerFor(''), /Elimination · letzter Überlebender gewinnt/, 'a plain arcade fight keeps the old line');
});

test('the Five Fronts score box shows the map name, not the internal key', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => element(), getElementById: () => null };
    try {
        const hud = new ArcadeScoreHUD(element());
        hud.update({
            runType: 'arena_waves', phase: 'combat', mapIndex: 0, mapCount: 5, currentMapKey: 'notre_dame_arena',
            score: { total: 20 }, kills: {}, upgrades: {}, wave: 1,
        });
        assert.match(hud._arenaWavesSection.textContent, /Karte 1\/5: Notre-Dame Arena/);
        assert.doesNotMatch(hud._arenaWavesSection.textContent, /notre_dame_arena/);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});
