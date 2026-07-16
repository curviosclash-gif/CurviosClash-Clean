// OnlineSessionSignalingRouter: routes signaling messages for OnlineSessionAdapter.
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    createSignalingEnvelope,
} from '../shared/contracts/SignalingSessionContract.js';
import {
    createServerSignalingError,
    createInvalidSignalingPayloadError,
    toErrorPayload,
} from './OnlineSignalingSupport.js';

function markConnected(adapter, msg, { hostPeerIdFallback = null } = {}) {
    adapter._lobbyCode = msg.lobbyCode || msg?.sessionState?.lobbyCode || adapter._lobbyCode;
    adapter.localPlayerId = msg.playerId || adapter.localPlayerId;
    adapter._sessionToken = String(msg.sessionToken || adapter._sessionToken || '').trim();
    adapter._hostPeerId = msg.hostPeerId
        || msg?.sessionState?.hostPeerId
        || hostPeerIdFallback
        || adapter._hostPeerId;
    adapter.isConnected = true;
    adapter._latencyMonitor.start();
}

async function offerToPeer(adapter, peerId) {
    const normalizedPeerId = String(peerId || '').trim();
    if (!normalizedPeerId || normalizedPeerId === adapter.localPlayerId) return;
    if (adapter._disconnectedPeers.has(normalizedPeerId)) {
        adapter._resolvePeerReconnect(normalizedPeerId);
    }
    const offer = await adapter._peerManager.createOffer(normalizedPeerId);
    adapter._sendSignaling(createSignalingEnvelope(
        SIGNALING_COMMAND_TYPES.OFFER,
        { targetPeerId: normalizedPeerId, offer }
    ));
}

export async function routeOnlineSessionSignalingMessage(adapter, msg, { connectResolve = null, connectReject = null } = {}) {
    const messageType = typeof msg?.type === 'string' ? msg.type.trim() : '';
    if (!messageType) {
        const payloadError = createInvalidSignalingPayloadError({
            signalingUrl: adapter._signalingUrl,
            reason: 'missing_type',
        });
        adapter._emit('error', toErrorPayload(payloadError));
        if (connectReject) {
            connectReject(payloadError);
        }
        return;
    }
    switch (messageType) {
    case SIGNALING_EVENT_TYPES.LOBBY_CREATED:
        markConnected(adapter, msg, { hostPeerIdFallback: msg.playerId });
        adapter._emit('connected', { playerId: adapter.localPlayerId, lobbyCode: adapter._lobbyCode });
        if (connectResolve) connectResolve();
        break;

    case SIGNALING_EVENT_TYPES.LOBBY_JOINED:
        markConnected(adapter, msg);
        adapter._emit('connected', { playerId: adapter.localPlayerId, lobbyCode: adapter._lobbyCode });
        if (connectResolve) connectResolve();
        break;

    case SIGNALING_EVENT_TYPES.TRANSPORT_ATTACHED:
        markConnected(adapter, msg);
        adapter._emit('connected', { playerId: adapter.localPlayerId, lobbyCode: adapter._lobbyCode });
        if (connectResolve) connectResolve();
        if (adapter.isHost && Array.isArray(msg.attachedPeerIds)) {
            // Clients that attached before the host: offer to each of them now.
            for (const attachedPeerId of msg.attachedPeerIds) {
                await offerToPeer(adapter, attachedPeerId);
            }
        }
        break;

    case SIGNALING_EVENT_TYPES.PLAYER_TRANSPORT_ATTACHED: {
        const attachedPeerId = String(msg.peerId || '').trim();
        if (!attachedPeerId || attachedPeerId === adapter.localPlayerId) break;
        if (msg.hostPeerId) {
            adapter._hostPeerId = msg.hostPeerId;
        }
        if (adapter.isHost) {
            await offerToPeer(adapter, attachedPeerId);
        }
        break;
    }

    case SIGNALING_EVENT_TYPES.CONNECTION_RESUMED:
        markConnected(adapter, msg);
        adapter._emit('connectionResumed', {
            playerId: adapter.localPlayerId,
            lobbyCode: adapter._lobbyCode,
        });
        if (connectResolve) connectResolve();
        break;

    case SIGNALING_EVENT_TYPES.PLAYER_JOINED:
        adapter._emit('playerJoined', { peerId: msg.peerId, name: msg.name });
        if (adapter.isHost) {
            await offerToPeer(adapter, msg.peerId);
        }
        break;

    case SIGNALING_EVENT_TYPES.PLAYER_RECONNECTED:
        adapter._emit('playerReconnected', { peerId: msg.peerId });
        if (adapter.isHost && msg.peerId) {
            await offerToPeer(adapter, msg.peerId);
        }
        break;

    case SIGNALING_COMMAND_TYPES.OFFER:
        if (!adapter.isHost) {
            adapter._hostPeerId = msg.fromPeerId;
            const answer = await adapter._peerManager.handleOffer(msg.fromPeerId, msg.offer);
            adapter._sendSignaling(createSignalingEnvelope(
                SIGNALING_COMMAND_TYPES.ANSWER,
                { targetPeerId: msg.fromPeerId, answer }
            ));
            // Client-side RTT measurement towards the host.
            adapter._latencyMonitor.addPeer(msg.fromPeerId);
        }
        break;

    case SIGNALING_COMMAND_TYPES.ANSWER:
        await adapter._peerManager.handleAnswer(msg.fromPeerId, msg.answer);
        adapter._latencyMonitor.addPeer(msg.fromPeerId);
        adapter._emit('playerConnected', { peerId: msg.fromPeerId });
        break;

    case SIGNALING_COMMAND_TYPES.ICE:
        await adapter._peerManager.addIceCandidate(msg.fromPeerId, msg.candidate);
        break;

    case SIGNALING_EVENT_TYPES.PLAYER_LEFT:
        adapter._registerPeerDisconnect(msg.peerId, 'signaling-left');
        break;

    case SIGNALING_EVENT_TYPES.ERROR: {
        const err = createServerSignalingError(msg.message);
        adapter._emit('error', toErrorPayload(err));
        if (connectReject) connectReject(err);
        break;
    }

    default:
        break;
    }
}
