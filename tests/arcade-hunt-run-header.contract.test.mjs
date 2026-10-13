// Endless hunt and Five Fronts run on the fight HUD, but they are not an elimination match: the
// header said "Elimination · letzter Überlebender gewinnt" and the Five Fronts / Five Portals score
// box printed the raw map key (notre_dame_arena) instead of the map name.

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

registerMapCatalogConfigSource({ MAPS: { notre_dame_arena: { name: 'Notre-Dame Arena', size: [80, 30, 80] } } });

const { HuntHUD } = await import('../src/ui/HuntHUD.js');
const { ArcadeScoreHUD } = await import('../src/ui/arcade/ArcadeScoreHUD.js');
const { WeaponRaceRuntime } = await import('../src/core/arcade/WeaponRaceRuntime.js');

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
    assert.doesNotMatch(headerFor('demolition'), /Elimination|Überlebender/);
    assert.match(headerFor('demolition'), /Abrisskommando/);
    assert.match(headerFor(''), /Elimination · letzter Überlebender gewinnt/, 'a plain arcade fight keeps the old line');
});

test('the demolition score box shows its map, timer, briefing, damage target and warning', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => element(), getElementById: () => null };
    try {
        const hud = new ArcadeScoreHUD(element());
        hud.update({
            runType: 'demolition', phase: 'active', mapIndex: 1, mapCount: 3,
            currentMapKey: 'reactor_site', currentMapLabel: 'Reaktorgelände', remainingSeconds: 41.2,
            score: { total: 510, currentMap: { total: 210 } }, breakEvents: 2, unitsDestroyed: 1, kills: 3,
            briefing: 'Reaktor zuletzt zerstören.', warning: 'Reaktor zuletzt!',
            destructible: { focusSegment: { label: 'Reaktor', ratio: 0.4 } },
        });
        assert.match(hud._arenaWavesSection.textContent, /Karte 2\/3: Reaktorgelände/);
        assert.match(hud._arenaWavesSection.textContent, /Zeit 42 s \| Kartenpunkte 210/);
        assert.match(hud._arenaWavesSection.textContent, /Auftrag: Reaktor zuletzt zerstören\./);
        assert.match(hud._arenaWavesSection.textContent, /Ziel Reaktor: 40 %/);
        assert.match(hud._arenaWavesSection.textContent, /Reaktor zuletzt!/);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
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

test('weapon race HUD labels every local human by identity across rank changes', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => element(), getElementById: () => null };
    try {
        const firstHuman = { index: 2, isBot: false };
        const secondHuman = { index: 0, isBot: false };
        const bot = { index: 3, isBot: true };
        const entityManager = {
            players: [firstHuman, secondHuman, bot],
            humanPlayers: [firstHuman, secondHuman],
            _projectileSystem: { clearForOwner() {} },
        };
        const runtime = new WeaponRaceRuntime();
        const hud = new ArcadeScoreHUD(element());
        hud.update(runtime.start({ entityManager }));

        assert.match(hud._arenaWavesSection.textContent, /1\. Spieler 1/);
        assert.match(hud._arenaWavesSection.textContent, /2\. Spieler 3/);
        assert.match(hud._arenaWavesSection.textContent, /3\. Bot 4/);

        runtime.handleCheckpoint({ playerIndex: 3, checkpointId: 'CP03_MG' });
        hud.update(runtime.getHudState());
        assert.match(hud._arenaWavesSection.textContent, /1\. Bot 4/);
        assert.match(hud._arenaWavesSection.textContent, /2\. Spieler 1/);
        assert.match(hud._arenaWavesSection.textContent, /3\. Spieler 3/);

        runtime.start({ entityManager: {
            players: [firstHuman, bot],
            humanPlayers: [firstHuman],
            _projectileSystem: { clearForOwner() {} },
        } });
        hud.update(runtime.getHudState());
        assert.match(hud._arenaWavesSection.textContent, /1\. Spieler 3/);
        assert.match(hud._arenaWavesSection.textContent, /2\. Bot 4/);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});
