import assert from 'node:assert/strict';
import test from 'node:test';

import {
    OPEN_LOBBY_STATES,
    deriveOpenLobbyState,
    filterOpenLobbyRows,
    mergeOpenLobbyRoster,
} from '../src/ui/menu/multiplayer/OpenLobbyRoster.js';
import { startOpenLobbyAutoRefresh } from '../src/ui/menu/multiplayer/OpenLobbyAutoRefresh.js';
import { listDiscoveredNetworkLobbies } from '../src/application/session-runtime/NetworkLobbyExperienceSupport.js';
import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

const lobby = (lobbyCode, extra = {}) => ({
    lobbyCode, hostName: 'Kapitän', modePath: 'fight', mapKey: 'mega_maze', memberCount: 1, maxPlayers: 10, ...extra,
});

test('each lobby row says whether it is open, full, already running or unreachable', () => {
    assert.equal(deriveOpenLobbyState({ memberCount: 2, maxPlayers: 10 }), OPEN_LOBBY_STATES.OPEN);
    assert.equal(deriveOpenLobbyState({ memberCount: 10, maxPlayers: 10 }), OPEN_LOBBY_STATES.FULL);
    assert.equal(deriveOpenLobbyState({ memberCount: 2, maxPlayers: 10, inMatch: true }), OPEN_LOBBY_STATES.RUNNING);
    assert.equal(deriveOpenLobbyState({ memberCount: 2, inMatch: true, missedRefreshes: 1 }), OPEN_LOBBY_STATES.UNREACHABLE);
});

test('rows show plain German labels instead of raw keys', (t) => {
    registerMapCatalogConfigSource({ MAPS: { mega_maze: { name: 'Mega-Labyrinth', size: [80, 30, 80] } } });
    t.after(() => registerMapCatalogConfigSource(null));
    const [row] = mergeOpenLobbyRoster([], [lobby('AAAA1111')]);
    assert.equal(row.modeLabel, 'Kampf');
    assert.equal(row.mapLabel, 'Mega-Labyrinth');
    assert.equal(row.hostName, 'Kapitän');
});

test('a lobby missing once turns grey, missing twice it disappears, and it returns when seen again', () => {
    let rows = mergeOpenLobbyRoster([], [lobby('AAAA1111'), lobby('BBBB2222')]);
    rows = mergeOpenLobbyRoster(rows, [lobby('BBBB2222')]);
    assert.deepEqual(rows.map((row) => [row.lobbyCode, row.state]), [
        ['AAAA1111', OPEN_LOBBY_STATES.UNREACHABLE],
        ['BBBB2222', OPEN_LOBBY_STATES.OPEN],
    ]);
    const back = mergeOpenLobbyRoster(rows, [lobby('AAAA1111'), lobby('BBBB2222')]);
    assert.equal(back[0].state, OPEN_LOBBY_STATES.OPEN);
    rows = mergeOpenLobbyRoster(rows, [lobby('BBBB2222'), lobby('CCCC3333')]);
    assert.deepEqual(rows.map((row) => row.lobbyCode), ['BBBB2222', 'CCCC3333']);
});

test('the search filters by host name, code, map and play style', () => {
    const rows = mergeOpenLobbyRoster([], [
        lobby('AAAA1111', { hostName: 'Blitz', modePath: 'normal', mapKey: 'standard' }),
        lobby('BBBB2222', { hostName: 'Nova' }),
    ]);
    assert.deepEqual(filterOpenLobbyRows(rows, 'blitz').map((row) => row.lobbyCode), ['AAAA1111']);
    assert.deepEqual(filterOpenLobbyRows(rows, 'bbbb').map((row) => row.lobbyCode), ['BBBB2222']);
    assert.deepEqual(filterOpenLobbyRows(rows, 'kampf').map((row) => row.lobbyCode), ['BBBB2222']);
    assert.equal(filterOpenLobbyRows(rows, '  ').length, 2);
});

test('the list refreshes itself at once when it appears and then every five seconds', () => {
    let tick = null;
    let refreshes = 0;
    const controls = { classList: { contains: () => false }, dataset: { canBrowse: 'true' }, ownerDocument: {}, getClientRects: () => [1] };
    const ui = { multiplayerOpenLobbiesControls: controls, multiplayerConnectionControls: { dataset: { connectionIntent: 'join' } } };
    const stop = startOpenLobbyAutoRefresh({ ui, refresh: () => { refreshes += 1; }, setIntervalFn: (fn) => { tick = fn; return 1; }, clearIntervalFn: () => {} });
    for (let second = 0; second < 11; second += 1) tick();
    assert.equal(refreshes, 3, 'at 0 s, 5 s and 10 s');
    controls.dataset.canBrowse = 'false';
    tick(); tick();
    assert.equal(refreshes, 3, 'no search while inside a lobby');
    controls.dataset.canBrowse = 'true';
    ui.multiplayerConnectionControls.dataset.connectionIntent = 'host';
    tick();
    assert.equal(refreshes, 3, 'no search on the host tab');
    ui.multiplayerConnectionControls.dataset.connectionIntent = 'join';
    tick();
    assert.equal(refreshes, 4, 'coming back searches at once');
    stop();
});

test('a lobby search listens for the whole window so a second host is not missed', async () => {
    let notify = null;
    const first = { ip: '10.0.0.2', port: 9090, lobbyCode: 'AAAA1111', playerCount: 1, lastSeen: 5 };
    const second = { ip: '10.0.0.3', port: 9090, lobbyCode: 'BBBB2222', playerCount: 2, inMatch: true, lastSeen: 6 };
    const lobbies = await listDiscoveredNetworkLobbies({
        transport: 'lan',
        scanTimeoutMs: 60,
        discoveryPort: {
            isAvailable: () => true,
            subscribe: (callback) => { notify = callback; return () => {}; },
            start: () => {
                setTimeout(() => notify([first]), 5);
                setTimeout(() => notify([first, second]), 30);
            },
            getHosts: () => [],
            stop: () => {},
        },
    });
    assert.deepEqual(lobbies.map((entry) => [entry.lobbyCode, entry.inMatch, entry.lastSeen]), [
        ['AAAA1111', false, 5],
        ['BBBB2222', true, 6],
    ]);
});
