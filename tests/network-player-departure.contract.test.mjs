import assert from 'node:assert/strict';
import test from 'node:test';

import {
    attachNetworkPlayerDepartureHandler,
    detachNetworkPlayerDepartureHandler,
} from '../src/core/runtime/NetworkPlayerDepartureOps.js';
import { RespawnSystem } from '../src/hunt/RespawnSystem.js';

function createSession({ isHost = true } = {}) {
    const listeners = new Map();
    return {
        isHost,
        on(name, handler) { listeners.set(name, handler); },
        off(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); },
        emit(name, payload) { listeners.get(name)?.(payload); },
        has: (name) => listeners.has(name),
    };
}

function createPlayer(index, { isBot = false } = {}) {
    return {
        index,
        isBot,
        alive: true,
        entitySlotActive: true,
        visible: true,
        trailCleared: false,
        view: { setVisible(visible) { this.owner.visible = visible; } },
        trail: { clear() { this.owner.trailCleared = true; } },
        kill() { this.alive = false; },
    };
}

function createFacade({ state = 'PLAYING', isHost = true } = {}) {
    const players = [createPlayer(0), createPlayer(1), createPlayer(2, { isBot: true })];
    for (const player of players) {
        player.view.owner = player;
        player.trail.owner = player;
    }
    const feed = [];
    const toasts = [];
    const facade = {
        session: createSession({ isHost }),
        game: {
            state,
            runtimeConfig: {
                session: {
                    networkEnabled: true,
                    networkPlayerSlots: [
                        { peerId: 'host', playerIndex: 0, isHost: true },
                        { peerId: 'peer-b', playerIndex: 1, name: 'Blitz' },
                    ],
                },
            },
            entityManager: {
                players,
                onHuntFeedEvent: (message) => feed.push(message),
            },
            _showStatusToast: (message) => toasts.push(message),
        },
    };
    return { facade, players, feed, toasts };
}

test('a guest who leaves the match is taken out of it on the host', () => {
    const { facade, players, feed } = createFacade();
    attachNetworkPlayerDepartureHandler(facade);
    facade.session.emit('playerDisconnected', { peerId: 'peer-b', reason: 'graceful-leave' });
    const guest = players[1];
    assert.equal(guest.entitySlotActive, false, 'the slot no longer takes part');
    assert.equal(guest.alive, false, 'the ship stops flying');
    assert.equal(guest.visible, false);
    assert.equal(guest.trailCleared, true);
    assert.deepEqual(feed, ['Blitz hat das Match verlassen']);
    assert.equal(players[0].alive, true, 'the host keeps playing');
    assert.equal(players[2].alive, true, 'bots keep playing');
});

test('a guest removed after the reconnect window is taken out as well', () => {
    const { facade, players } = createFacade();
    attachNetworkPlayerDepartureHandler(facade);
    facade.session.emit('playerRemoved', { peerId: 'peer-b' });
    assert.equal(players[1].entitySlotActive, false);
    assert.equal(players[1].alive, false);
});

test('a short connection drop keeps the guest in the match', () => {
    const { facade, players, feed } = createFacade();
    attachNetworkPlayerDepartureHandler(facade);
    facade.session.emit('playerDisconnected', { peerId: 'peer-b', reason: 'channel-close', canReconnect: true });
    assert.equal(players[1].entitySlotActive, true);
    assert.equal(players[1].alive, true);
    assert.deepEqual(feed, []);
});

test('departures outside a running match and unknown peers change nothing', () => {
    const inMenu = createFacade({ state: 'MENU' });
    attachNetworkPlayerDepartureHandler(inMenu.facade);
    inMenu.facade.session.emit('playerDisconnected', { peerId: 'peer-b', reason: 'graceful-leave' });
    assert.equal(inMenu.players[1].alive, true);

    const unknown = createFacade();
    attachNetworkPlayerDepartureHandler(unknown.facade);
    unknown.facade.session.emit('playerRemoved', { peerId: 'peer-x' });
    assert.ok(unknown.players.every((player) => player.alive));
});

test('only the host listens, and detaching removes the listeners', () => {
    const guest = createFacade({ isHost: false });
    assert.equal(attachNetworkPlayerDepartureHandler(guest.facade), null);
    assert.equal(guest.facade.session.has('playerDisconnected'), false);

    const host = createFacade();
    const handlers = attachNetworkPlayerDepartureHandler(host.facade);
    assert.equal(host.facade.session.has('playerRemoved'), true);
    detachNetworkPlayerDepartureHandler(host.facade.session, handlers);
    assert.equal(host.facade.session.has('playerDisconnected'), false);
    assert.equal(host.facade.session.has('playerRemoved'), false);
});

test('a pending respawn never revives a slot that left the match', () => {
    const respawn = new RespawnSystem({
        callbacks: { getStrategy: () => ({ isRespawnEnabled: () => true }) },
    });
    const player = { index: 1, alive: false, entitySlotActive: true, position: null };
    assert.equal(respawn.onPlayerDied(player), true);
    player.entitySlotActive = false;
    respawn.update(10);
    assert.equal(player.alive, false);
    assert.equal(respawn.isRespawnPending(player), false);
});
