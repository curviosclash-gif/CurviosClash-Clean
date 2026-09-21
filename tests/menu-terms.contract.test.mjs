import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { MENU_TEXT_CATALOG } from '../src/ui/menu/MenuTextCatalog.js';
import { findFixedMenuPresetSeedById } from '../src/ui/menu/MenuDefaultsEditorConfig.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const visibleHtmlText = html.replace(/<script[\s\S]*?<\/script>/gu, '').replace(/<[^>]+>/gu, ' ');

test('"Preset" is called "Vorlage" wherever the player reads it', () => {
    assert.doesNotMatch(visibleHtmlText, /\bPresets?\b/u);
    Object.entries(MENU_TEXT_CATALOG).forEach(([id, text]) => assert.doesNotMatch(text, /\bPresets?\b/u, id));
});

test('the built-in presets carry German names while their ids stay', () => {
    const names = ['endlosjagd', 'arcade', 'competitive', 'chaos', 'fight-standard', 'normal-standard']
        .map((id) => findFixedMenuPresetSeedById(id)?.name);
    assert.deepEqual(names, ['Endlosjagd', 'Arcade Standard', 'Wettkampf', 'Chaos', 'Kampf Standard', 'Klassisch Standard']);
});

test('the options window is "Einstellungen" and the diagnosis area is "Expertenbereich"', () => {
    assert.equal(MENU_TEXT_CATALOG['menu.level4.title'], 'Einstellungen');
    assert.equal(MENU_TEXT_CATALOG['menu.level3.open_level4.label'], 'Einstellungen');
    assert.equal(MENU_TEXT_CATALOG['menu.context.level4.title'], 'Einstellungen');
    assert.equal(MENU_TEXT_CATALOG['menu.expert.locked.title'], 'Expertenbereich');
    const allText = `${visibleHtmlText} ${Object.values(MENU_TEXT_CATALOG).join(' ')}`;
    assert.doesNotMatch(allText, /Erweiterte[nr]? (Optionen|Bereich)/u);
});

test('the profile page separates players from saved settings and explains both', () => {
    const section = /<section id="level4-section-tools"[\s\S]*?<\/section>/u.exec(html)?.[0] || '';
    const headings = Array.from(section.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>\s*<p class="menu-hint[^"]*"[^>]*>([^<]+)<\/p>/gu),
        (match) => [match[1].replace(/<[^>]+>/gu, '').replace(/\s+/gu, ' ').trim().replace(/ i$/u, ''), match[2].trim()]);
    assert.deepEqual(headings.map(([title]) => title), ['Spieler', 'Gespeicherte Einstellungen']);
    headings.forEach(([, sentence]) => assert.ok(sentence.length > 30, 'each area has an explaining sentence'));
    assert.doesNotMatch(section.replace(/<[^>]+>/gu, ' '), /\bProfil/u, 'no "Profil" wording left on the page');
});

test('saved-settings messages no longer speak of a "Profil"', () => {
    for (const file of ['ui/ProfileUiController.js', 'ui/ProfileUiStateOps.js', 'ui/ProfileControlStateOps.js', 'ui/ProfileTransferOps.js', 'core/ProfileManager.js']) {
        const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
        const messages = Array.from(source.matchAll(/(?:message|error|text|return|Toast\()\s*[:(]?\s*[`'"]([^`'"]*)[`'"]/gu), (match) => match[1]);
        messages.forEach((message) => assert.doesNotMatch(message, /\bProfil(?!e?-?Import)/u, `${file}: ${message}`));
    }
});

test('menu surfaces use one German name for each shared concept', () => {
    const expected = {
        'menu.multiplayer.title': 'Mehrspieler',
        'menu.level4.map.planar_mode.label': 'Ebenenflug',
        'menu.level4.tabs.advanced_map.label': 'Karten-Details',
        'menu.level4.tools.vehicle_editor.label': 'Fahrzeug-Werkstatt öffnen',
        'menu.level4.gameplay.item_amount.label': 'Gegenstände:',
        'menu.level1.splitscreen.label': 'Geteilter Bildschirm',
    };
    for (const [id, label] of Object.entries(expected)) assert.equal(MENU_TEXT_CATALOG[id], label, id);
    const menuText = `${visibleHtmlText} ${Object.values(MENU_TEXT_CATALOG).join(' ')}`;
    assert.doesNotMatch(menuText, /Map-Details|Planar Modus|Multiplayer-Lobby|Vehicle-Editor öffnen|Item-Menge|\bSplitscreen\b/u);
});
