import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MENU_VISIBILITY_CONTRACT_VERSION,
    MENU_VISIBILITY_KEYS,
    MENU_VISIBILITY_REASONS,
    normalizeMenuVisibilityContext,
    resolveMenuVisibility,
} from '../src/shared/contracts/MenuVisibilityContract.js';
import { applyMenuVisibility } from '../src/ui/menu/MenuVisibilityApplier.js';

function resolve(raw) {
    return resolveMenuVisibility(normalizeMenuVisibilityContext(raw));
}

function expectEnabled(result, key) {
    assert.equal(result.visible[key], true, `${key} visible`);
    assert.equal(result.enabled[key], true, `${key} enabled`);
    assert.equal(result.reasons[key], undefined, `${key} has no reason`);
}

function expectHidden(result, key, reason) {
    assert.equal(result.visible[key], false, `${key} hidden`);
    assert.equal(result.enabled[key], false, `${key} not enabled`);
    assert.equal(result.reasons[key], reason, `${key} reason`);
}

function expectDisabled(result, key, reason) {
    assert.equal(result.visible[key], true, `${key} visible`);
    assert.equal(result.enabled[key], false, `${key} not enabled`);
    assert.equal(result.reasons[key], reason, `${key} reason`);
}

test('contract exposes a version and fixed keys', () => {
    assert.equal(typeof MENU_VISIBILITY_CONTRACT_VERSION, 'string');
    assert.ok(Object.isFrozen(MENU_VISIBILITY_KEYS));
    const result = resolve({});
    assert.deepEqual(Object.keys(result.visible).sort(), [...MENU_VISIBILITY_KEYS].sort());
    assert.deepEqual(Object.keys(result.enabled).sort(), [...MENU_VISIBILITY_KEYS].sort());
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.visible));
    assert.ok(Object.isFrozen(result.enabled) && Object.isFrozen(result.reasons));
});

test('normalizer pulls unknown values to safe defaults', () => {
    assert.deepEqual(normalizeMenuVisibilityContext(undefined), {
        sessionType: 'single',
        playerCount: 1,
        variant: 'ffa',
        lobbyRole: 'none',
        devEnvironment: false,
        platform: 'desktop',
    });
    const odd = normalizeMenuVisibilityContext({
        sessionType: 'bogus',
        playerCount: 'x',
        variant: 7,
        lobbyRole: 'king',
        devEnvironment: 'yes',
        platform: 'toaster',
    });
    assert.equal(odd.sessionType, 'single');
    assert.equal(odd.playerCount, 1);
    assert.equal(odd.variant, 'ffa');
    assert.equal(odd.lobbyRole, 'none');
    assert.equal(odd.devEnvironment, false);
    assert.equal(odd.platform, 'desktop');
});

test('normalizer clamps player count and ties it to the session type', () => {
    assert.equal(normalizeMenuVisibilityContext({ sessionType: 'single', playerCount: 4 }).playerCount, 1);
    assert.equal(normalizeMenuVisibilityContext({ sessionType: 'splitscreen', playerCount: 9 }).playerCount, 4);
    assert.equal(normalizeMenuVisibilityContext({ sessionType: 'splitscreen', playerCount: 0 }).playerCount, 2);
    assert.equal(normalizeMenuVisibilityContext({ sessionType: 'splitscreen', playerCount: '3' }).playerCount, 3);
    assert.equal(normalizeMenuVisibilityContext({ sessionType: 'multiplayer', playerCount: 2.7 }).playerCount, 2);
    assert.equal(normalizeMenuVisibilityContext({ sessionType: 'splitscreen', lobbyRole: 'host' }).lobbyRole, 'none');
    assert.equal(normalizeMenuVisibilityContext({ sessionType: 'multiplayer', lobbyRole: 'host' }).lobbyRole, 'host');
    assert.equal(normalizeMenuVisibilityContext({ variant: 'team' }).variant, 'team');
    assert.equal(normalizeMenuVisibilityContext({ devEnvironment: true }).devEnvironment, true);
});

test('three players on a shared screen disable the team variants', () => {
    const three = resolve({ sessionType: 'splitscreen', playerCount: 3 });
    for (const key of ['variantTeam', 'variantFlags', 'variantEscort']) {
        expectDisabled(three, key, MENU_VISIBILITY_REASONS.THREE_PLAYERS_NO_TEAMS);
    }
    const two = resolve({ sessionType: 'splitscreen', playerCount: 2 });
    for (const key of ['variantTeam', 'variantFlags', 'variantEscort']) expectEnabled(two, key);
    const single = resolve({ sessionType: 'single' });
    for (const key of ['variantTeam', 'variantFlags', 'variantEscort']) expectEnabled(single, key);
});

test('four players only keep the planar entry', () => {
    const four = resolve({ sessionType: 'splitscreen', playerCount: 4 });
    expectEnabled(four, 'planarEntry');
    expectHidden(four, 'arcadeJourney', MENU_VISIBILITY_REASONS.FOUR_PLAYERS_PLANAR_ONLY);
    expectHidden(four, 'freePlay', MENU_VISIBILITY_REASONS.FOUR_PLAYERS_PLANAR_ONLY);
    const three = resolve({ sessionType: 'splitscreen', playerCount: 3 });
    for (const key of ['arcadeJourney', 'freePlay']) expectEnabled(three, key);
});

test('the planar-only rule belongs to the shared screen, not to network lobbies', () => {
    const lobbyOfFour = resolve({ sessionType: 'multiplayer', playerCount: 4, lobbyRole: 'host' });
    expectEnabled(lobbyOfFour, 'arcadeJourney');
    expectEnabled(lobbyOfFour, 'freePlay');
    for (const raw of [
        { sessionType: 'single' },
        { sessionType: 'splitscreen', playerCount: 3 },
        { sessionType: 'multiplayer', playerCount: 4, lobbyRole: 'host' },
    ]) {
        expectHidden(resolve(raw), 'planarEntry', MENU_VISIBILITY_REASONS.SPLITSCREEN_FOUR_ONLY);
    }
});

test('device assignment and profile slots need two or three shared-screen players', () => {
    for (const key of ['deviceAssignment', 'profileSlots']) {
        expectEnabled(resolve({ sessionType: 'splitscreen', playerCount: 2 }), key);
        expectEnabled(resolve({ sessionType: 'splitscreen', playerCount: 3 }), key);
        expectHidden(resolve({ sessionType: 'splitscreen', playerCount: 4 }), key, MENU_VISIBILITY_REASONS.SPLITSCREEN_TWO_OR_THREE_ONLY);
        expectHidden(resolve({ sessionType: 'single' }), key, MENU_VISIBILITY_REASONS.SPLITSCREEN_TWO_OR_THREE_ONLY);
        expectHidden(resolve({ sessionType: 'multiplayer', playerCount: 2 }), key, MENU_VISIBILITY_REASONS.SPLITSCREEN_TWO_OR_THREE_ONLY);
    }
});

test('ghost duel exists only in single player', () => {
    expectEnabled(resolve({ sessionType: 'single' }), 'ghostDuel');
    expectHidden(resolve({ sessionType: 'splitscreen', playerCount: 2 }), 'ghostDuel', MENU_VISIBILITY_REASONS.SINGLE_PLAYER_ONLY);
    expectHidden(resolve({ sessionType: 'multiplayer' }), 'ghostDuel', MENU_VISIBILITY_REASONS.SINGLE_PLAYER_ONLY);
});

test('lobby rules depend on the lobby role', () => {
    const host = resolve({ sessionType: 'multiplayer', lobbyRole: 'host' });
    const guest = resolve({ sessionType: 'multiplayer', lobbyRole: 'guest' });
    const none = resolve({ sessionType: 'single' });

    expectEnabled(host, 'lobbyLocalPlayers');
    expectHidden(guest, 'lobbyLocalPlayers', MENU_VISIBILITY_REASONS.HOST_ONLY);
    expectHidden(none, 'lobbyLocalPlayers', MENU_VISIBILITY_REASONS.HOST_ONLY);

    expectEnabled(host, 'matchRulesEditable');
    expectEnabled(none, 'matchRulesEditable');
    expectDisabled(guest, 'matchRulesEditable', MENU_VISIBILITY_REASONS.HOST_ONLY);

    expectEnabled(host, 'pauseRestart');
    expectEnabled(none, 'pauseRestart');
    expectHidden(guest, 'pauseRestart', MENU_VISIBILITY_REASONS.HOST_ONLY);

    expectDisabled(host, 'lobbyArcadeTab', MENU_VISIBILITY_REASONS.COMING_SOON);
    expectDisabled(guest, 'lobbyArcadeTab', MENU_VISIBILITY_REASONS.COMING_SOON);
    expectHidden(none, 'lobbyArcadeTab', MENU_VISIBILITY_REASONS.NOT_IN_LOBBY);
});

test('custom editor maps are local only', () => {
    expectEnabled(resolve({ sessionType: 'single' }), 'customMapsSelectable');
    expectEnabled(resolve({ sessionType: 'splitscreen', playerCount: 2 }), 'customMapsSelectable');
    expectDisabled(resolve({ sessionType: 'multiplayer', lobbyRole: 'host' }), 'customMapsSelectable', MENU_VISIBILITY_REASONS.CUSTOM_MAPS_LOCAL_ONLY);
});

test('developer functions need a development environment', () => {
    for (const key of ['developerTools', 'tuningConsoleHint']) {
        expectEnabled(resolve({ devEnvironment: true }), key);
        expectHidden(resolve({ devEnvironment: false }), key, MENU_VISIBILITY_REASONS.DEV_ONLY);
    }
});

test('platform gates the mobile controls tab and the quit button', () => {
    expectEnabled(resolve({ platform: 'mobile' }), 'mobileControlsTab');
    expectHidden(resolve({ platform: 'desktop' }), 'mobileControlsTab', MENU_VISIBILITY_REASONS.MOBILE_ONLY);
    expectHidden(resolve({ platform: 'browser' }), 'mobileControlsTab', MENU_VISIBILITY_REASONS.MOBILE_ONLY);
    expectEnabled(resolve({ platform: 'desktop' }), 'quitButton');
    expectHidden(resolve({ platform: 'browser' }), 'quitButton', MENU_VISIBILITY_REASONS.DESKTOP_ONLY);
    expectHidden(resolve({ platform: 'mobile' }), 'quitButton', MENU_VISIBILITY_REASONS.DESKTOP_ONLY);
});

test('resolve normalizes raw input itself', () => {
    const result = resolveMenuVisibility({ sessionType: 'splitscreen', playerCount: 3 });
    expectDisabled(result, 'variantTeam', MENU_VISIBILITY_REASONS.THREE_PLAYERS_NO_TEAMS);
    assert.doesNotThrow(() => resolveMenuVisibility(null));
});

function createFakeElement(key, { withDisabled = false } = {}) {
    const attrs = new Map([['data-menu-visibility-key', key]]);
    const element = {
        hidden: false,
        getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
        setAttribute: (name, value) => { attrs.set(name, String(value)); },
        removeAttribute: (name) => { attrs.delete(name); },
        attrs,
    };
    if (withDisabled) element.disabled = false;
    return element;
}

function createFakeRoot(elements) {
    return { querySelectorAll: () => elements };
}

test('applier hides, disables and restores elements by key', () => {
    const team = createFakeElement('variantTeam', { withDisabled: true });
    const quit = createFakeElement('quitButton');
    const tab = createFakeElement('lobbyArcadeTab');
    const rules = createFakeElement('matchRulesEditable', { withDisabled: true });
    const unknown = createFakeElement('somethingElse');
    const root = createFakeRoot([team, quit, tab, rules, unknown]);

    const locked = resolve({ sessionType: 'splitscreen', playerCount: 3, platform: 'browser' });
    applyMenuVisibility(root, locked);
    assert.equal(team.hidden, false);
    assert.equal(team.disabled, true);
    assert.equal(team.attrs.get('aria-disabled'), 'true');
    assert.equal(team.attrs.get('data-menu-disabled-reason'), MENU_VISIBILITY_REASONS.THREE_PLAYERS_NO_TEAMS);
    assert.equal(quit.hidden, true);
    assert.equal(quit.attrs.get('aria-hidden'), 'true');
    assert.equal(quit.attrs.get('data-menu-disabled-reason'), MENU_VISIBILITY_REASONS.DESKTOP_ONLY);
    assert.equal(tab.hidden, true);
    assert.equal(rules.disabled, false);
    assert.equal(rules.attrs.has('aria-disabled'), false);
    assert.equal(unknown.hidden, false);
    assert.equal(unknown.attrs.has('aria-hidden'), false);

    applyMenuVisibility(root, resolve({ sessionType: 'single', platform: 'desktop' }));
    assert.equal(team.disabled, false);
    for (const el of [team, quit, rules]) {
        assert.equal(el.hidden, false);
        assert.equal(el.attrs.has('aria-hidden'), false);
        assert.equal(el.attrs.has('aria-disabled'), false);
        assert.equal(el.attrs.has('data-menu-disabled-reason'), false);
    }
});

test('applier ignores missing root or result', () => {
    assert.doesNotThrow(() => applyMenuVisibility(null, resolve({})));
    assert.doesNotThrow(() => applyMenuVisibility(createFakeRoot([]), null));
});
