import assert from 'node:assert/strict';
import test from 'node:test';

import { routeOnlineLobbyMessage } from '../src/network/OnlineMatchLobbyMessageRouter.js';
import { SIGNALING_EVENT_TYPES } from '../src/shared/contracts/SignalingSessionContract.js';

function createFakeLobby() {
    return {
        _signalingUrl: 'wss://lobby.invalid/socket',
        _playerId: '',
        _sessionToken: '',
        _lastHandledMatchCommandId: '',
        sessionState: { revision: 0, members: [], lobbyCode: '' },
        emitted: [],
        rejectedAckErrors: [],
        _lobbyRuntime: { nowMs: () => 1_700_000_000_000 },
        _resolveMatchingMutationAcks() {},
        _rejectAllPendingMutationAcks(error) {
            this.rejectedAckErrors.push(error);
        },
        _applySessionState(state) {
            this.sessionState = state;
        },
        _emit(event, payload) {
            this.emitted.push({ event, payload });
        },
    };
}

/**
 * Mirrors OnlineMatchLobby._makeConnectAttempt(): connectReject() itself guards
 * on connectState.rejected, so a caller that pre-sets the flag silences the
 * rejection and leaves the connect promise pending until the 30 s timeout.
 */
function createConnectHarness() {
    const connectState = { settled: false, rejected: false };
    const rejections = [];
    const resolutions = [];
    const settle = (fn, arg) => {
        if (connectState.settled) return;
        connectState.settled = true;
        fn(arg);
    };
    return {
        connectState,
        rejections,
        resolutions,
        connectResolve: () => settle(() => resolutions.push(true)),
        connectReject: (error) => {
            if (connectState.rejected) return;
            connectState.rejected = true;
            settle((err) => rejections.push(err), error);
        },
    };
}

test('a server error while joining rejects the connect attempt immediately', () => {
    const lobby = createFakeLobby();
    const harness = createConnectHarness();

    routeOnlineLobbyMessage(lobby, {
        type: SIGNALING_EVENT_TYPES.ERROR,
        code: 'lobby_not_found',
        message: 'Lobby nicht gefunden.',
    }, harness);

    assert.equal(harness.rejections.length, 1, 'the join promise must reject right away');
    assert.equal(harness.rejections[0].code, 'lobby_not_found');
    assert.equal(harness.connectState.settled, true);
    assert.equal(lobby.rejectedAckErrors.length, 1);
    assert.equal(lobby.emitted.filter((entry) => entry.event === 'error').length, 1);
});

test('a repeated server error does not reject the connect attempt twice', () => {
    const lobby = createFakeLobby();
    const harness = createConnectHarness();
    const errorMessage = {
        type: SIGNALING_EVENT_TYPES.ERROR,
        code: 'lobby_full',
        message: 'Lobby ist voll.',
    };

    routeOnlineLobbyMessage(lobby, errorMessage, harness);
    routeOnlineLobbyMessage(lobby, errorMessage, harness);

    assert.equal(harness.rejections.length, 1);
    assert.equal(harness.rejections[0].code, 'lobby_full');
});

test('a server error after a successful join leaves the settled connect attempt alone', () => {
    const lobby = createFakeLobby();
    const harness = createConnectHarness();

    routeOnlineLobbyMessage(lobby, {
        type: SIGNALING_EVENT_TYPES.LOBBY_JOINED,
        playerId: 'peer-1',
        sessionToken: 'token-1',
        lobbyCode: 'ABCD',
    }, harness);
    assert.equal(harness.resolutions.length, 1);

    routeOnlineLobbyMessage(lobby, {
        type: SIGNALING_EVENT_TYPES.ERROR,
        code: 'match_start_rejected',
        message: 'Start abgelehnt.',
    }, harness);

    assert.equal(harness.rejections.length, 0);
    assert.equal(lobby.emitted.filter((entry) => entry.event === 'error').length, 1);
});
