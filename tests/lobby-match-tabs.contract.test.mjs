import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MENU_VISIBILITY_REASONS } from '../src/shared/contracts/MenuVisibilityContract.js';
import {
    resolveLobbyRole,
    resolveLobbyTabs,
    syncLobbyTabs,
} from '../src/ui/start-setup/LobbyMatchTabs.js';
import { resolveLobbyMatchFacts, syncLobbyScreen } from '../src/ui/start-setup/LobbyScreenUi.js';
import { resolveMenuCatalogText } from '../src/ui/menu/MenuTextCatalog.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the lobby role follows the joined and host flags', () => {
    assert.equal(resolveLobbyRole(false, false), 'none');
    assert.equal(resolveLobbyRole(false, true), 'none');
    assert.equal(resolveLobbyRole(true, true), 'host');
    assert.equal(resolveLobbyRole(true, false), 'guest');
});

test('fight is the open tab and arcade is shown but disabled as coming soon', () => {
    for (const role of ['host', 'guest']) {
        const { tabs, activeTab } = resolveLobbyTabs(role);
        const [fight, arcade] = tabs;
        assert.equal(activeTab, 'fight');
        assert.deepEqual([fight.id, fight.label, fight.selected, fight.enabled], ['fight', 'Kampf', true, true], role);
        assert.deepEqual([arcade.id, arcade.label, arcade.selected, arcade.visible, arcade.enabled], ['arcade', 'Arcade', false, true, false], role);
        assert.equal(arcade.reason, MENU_VISIBILITY_REASONS.COMING_SOON);
    }
    const none = resolveLobbyTabs('none');
    assert.equal(none.tabs[0].enabled, false);
    assert.equal(none.tabs[1].visible, false);
});

test('only the host edits the rules; the guest gets the read-only hint', () => {
    const host = resolveLobbyTabs('host');
    const guest = resolveLobbyTabs('guest');
    assert.deepEqual([host.rulesEditable, host.guestHint], [true, false]);
    assert.deepEqual([guest.rulesEditable, guest.guestHint], [false, true]);
    assert.equal(guest.visibility.reasons.matchRulesEditable, MENU_VISIBILITY_REASONS.HOST_ONLY);
    assert.deepEqual([resolveLobbyTabs('none').rulesEditable, resolveLobbyTabs('none').guestHint], [false, false]);
});

test('match facts name the free play variant', () => {
    const facts = (modePath, matchSummary) => Object.fromEntries(resolveLobbyMatchFacts({ mapKey: 'maze', modePath, matchSummary }));
    const base = { numBots: 3, botDifficulty: 'HARD', targetKind: 'wins', targetValue: 5 };
    assert.equal(facts('fight', base).Spielart, 'Kampf · Einzelkampf');
    assert.equal(facts('fight', { ...base, teamMode: true, teamObjective: 'HUNT' }).Spielart, 'Kampf · Team');
    assert.equal(facts('fight', { ...base, teamMode: true, teamObjective: 'FLAGS' }).Spielart, 'Kampf · Flaggen');
    assert.equal(facts('fight', { ...base, teamMode: true, teamObjective: 'ESCORT' }).Spielart, 'Kampf · Eskorte');
    assert.equal(facts('normal', base).Spielart, 'Klassisch');
    assert.equal(facts('arcade', base).Spielart, 'Arcade');
    // Older peers send no summary, so the variant stays unnamed instead of guessed.
    assert.equal(facts('fight', undefined).Spielart, 'Kampf');
    assert.equal(resolveLobbyMatchFacts(null)[0][1], 'Nicht verfügbar');
    assert.deepEqual(resolveLobbyMatchFacts(null).map(([label]) => label), ['Spielart', 'Karte', 'Bots', 'Spielziel']);
});

function fakeElement(attributes = {}, extra = {}) {
    const attrs = new Map(Object.entries(attributes));
    const classes = new Set();
    return Object.assign({
        hidden: false,
        disabled: false,
        tabIndex: 0,
        dataset: {},
        getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
        setAttribute: (name, value) => attrs.set(name, String(value)),
        removeAttribute: (name) => attrs.delete(name),
        classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) },
        querySelector: () => null,
        attrs,
    }, extra);
}

function fakeLobbyPanel() {
    const note = fakeElement();
    const fightTab = fakeElement({ role: 'tab', 'aria-selected': 'false' }, { dataset: { lobbyTab: 'fight' } });
    const arcadeTab = fakeElement(
        { role: 'tab', 'data-menu-visibility-key': 'lobbyArcadeTab' },
        { dataset: { lobbyTab: 'arcade' }, querySelector: () => note },
    );
    const editButton = fakeElement({ 'data-menu-visibility-key': 'matchRulesEditable' });
    const panel = fakeElement({}, {
        querySelectorAll: (selector) => {
            if (selector === '[data-menu-visibility-key]') return [arcadeTab, editButton];
            if (selector === '[role="tab"][data-lobby-tab]') return [fightTab, arcadeTab];
            return [];
        },
    });
    return { panel, note, fightTab, arcadeTab, editButton };
}

test('the tab strip marks fight selected and disables arcade with a visible note', () => {
    const { panel, note, fightTab, arcadeTab } = fakeLobbyPanel();
    syncLobbyTabs(panel, resolveLobbyTabs('host'));
    assert.equal(fightTab.getAttribute('aria-selected'), 'true');
    assert.equal(arcadeTab.getAttribute('aria-selected'), 'false');
    assert.equal(arcadeTab.disabled, true);
    assert.equal(arcadeTab.getAttribute('aria-disabled'), 'true');
    assert.equal(arcadeTab.getAttribute('data-menu-disabled-reason'), 'coming_soon');
    assert.equal(note.hidden, false, 'the "kommt bald" text is shown, not just a colour');
    assert.doesNotThrow(() => syncLobbyTabs({}, resolveLobbyTabs('host')));
});

test('the lobby screen locks the rules button and shows the hint for guests only', () => {
    for (const [state, expected] of [
        [{ joined: true, isHost: true, metadata: null }, { disabled: false, hint: false, role: 'host' }],
        [{ joined: true, isHost: false, metadata: null }, { disabled: true, hint: true, role: 'guest' }],
        [{ joined: false, metadata: null }, { disabled: false, hint: false, role: 'none' }],
    ]) {
        const { panel, editButton } = fakeLobbyPanel();
        const hint = fakeElement();
        const ui = { multiplayerPanel: panel, lobbyEditMatchButton: editButton, lobbyHostSettingsHint: hint };
        syncLobbyScreen(ui, state, true);
        assert.equal(editButton.disabled, expected.disabled, expected.role);
        assert.equal(hint.classList.contains('hidden'), !expected.hint, expected.role);
        assert.equal(panel.dataset.lobbyRole, expected.role);
        assert.equal(editButton.classList.contains('hidden'), !(expected.role !== 'none'), expected.role);
    }
});

test('the lobby markup carries the tab strip, the read-only hint and the visibility keys', () => {
    const lobby = html.slice(html.indexOf('id="multiplayer-inline-stub"'), html.indexOf('class="lobby-action-bar"'));
    assert.match(lobby, /role="tablist"[^>]*aria-label="Spielart der Lobby"/);
    assert.match(lobby, /id="lobby-tab-fight"[^>]*role="tab"[^>]*aria-selected="true"[^>]*>\s*Kampf/);
    assert.match(lobby, /id="lobby-tab-arcade"[^>]*role="tab"[^>]*data-menu-visibility-key="lobbyArcadeTab"[^>]*disabled/);
    assert.match(lobby, /class="lobby-tab-note">kommt bald</);
    assert.match(lobby, /id="lobby-tabpanel-fight"[^>]*role="tabpanel"[^>]*aria-labelledby="lobby-tab-fight"/);
    assert.match(lobby, /id="btn-lobby-edit-match"[^>]*data-menu-visibility-key="matchRulesEditable"[^>]*>Regeln ändern</);
    assert.match(lobby, /id="lobby-host-settings-hint"[^>]*>Nur der Gastgeber ändert die Regeln\./);
    assert.doesNotMatch(lobby, /Match ändern|Lokale Spieler am Host|Der Host legt/);
});

test('create and join are two large cards that keep their ids and bindings', () => {
    const lobby = html.slice(html.indexOf('id="multiplayer-connection-controls"'), html.indexOf('id="multiplayer-session-controls"'));
    const card = (intent) => lobby.match(new RegExp(`<button[^>]*data-connection-intent-target="${intent}"[\\s\\S]*?</button>`))?.[0] || '';
    const host = card('host');
    const join = card('join');
    assert.match(host, /class="[^"]*mp-intent-card/);
    assert.match(host, /data-requires-cap="host"/);
    assert.match(host, /aria-pressed="false"/);
    assert.match(host, /class="mp-intent-title">Spiel erstellen</);
    assert.match(host, /class="mp-intent-copy">[^<]*Gastgeber[^<]*lokale/i);
    assert.match(join, /aria-pressed="true"/);
    assert.match(join, /class="mp-intent-title">Spiel beitreten</);
    assert.match(join, /class="mp-intent-copy">[^<]*Code[^<]*offene Lobby/);
    for (const id of ['btn-multiplayer-host', 'btn-multiplayer-join', 'multiplayer-host-local-player-count', 'multiplayer-lobby-code']) {
        assert.ok(lobby.includes(`id="${id}"`), id);
    }
});

test('visible lobby texts say Gastgeber and Beitreten', () => {
    assert.equal(resolveMenuCatalogText('menu.multiplayer.inline.host.label', ''), 'Gastgeber');
    assert.equal(resolveMenuCatalogText('menu.multiplayer.inline.join.label', ''), 'Beitreten');
    assert.equal(resolveMenuCatalogText('menu.level3.multiplayer.host_address.label', ''), 'Adresse des Gastgebers');
});
