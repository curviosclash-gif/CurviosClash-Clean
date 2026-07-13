// ============================================
// LANSignalingClient.js - HTTP helpers for the embedded LAN signaling server
// ============================================

import { createLogger } from '../shared/logging/Logger.js';

const logger = createLogger('LANSignalingClient');

export const JOIN_OFFER_MAX_WAIT_MS = 12_000;
export const JOIN_OFFER_INITIAL_BACKOFF_MS = 200;
export const JOIN_OFFER_MAX_BACKOFF_MS = 1_600;
export const ICE_POLL_MAX_RETRIES = 20;
export const ICE_QUIET_WINDOW_POLLS = 3;
export const ICE_POLL_DELAY_MS = 200;

export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the signaling server until the host offer for this player arrives.
 * The GET consumes the offer server-side, so the token must belong to the player.
 */
export async function waitForHostOffer({ signalingUrl, playerId, token, now = () => Date.now() }) {
    let offerPollDelayMs = JOIN_OFFER_INITIAL_BACKOFF_MS;
    const offerPollingStartedAt = Number(now()) || 0;
    const offerParams = new URLSearchParams({ playerId, token: String(token || '') });
    while ((Number(now()) || 0) - offerPollingStartedAt < JOIN_OFFER_MAX_WAIT_MS) {
        try {
            const offerRes = await fetch(`${signalingUrl}/signaling/offer?${offerParams.toString()}`);
            if (offerRes?.ok === false) {
                throw new Error(`Offer poll failed (${offerRes.status || 'unknown'})`);
            }
            const data = await offerRes.json();
            if (data.offer) {
                return data.offer;
            }
        } catch (err) {
            logger.debug('Offer poll failed:', err);
        }
        await delay(offerPollDelayMs);
        offerPollDelayMs = Math.min(JOIN_OFFER_MAX_BACKOFF_MS, offerPollDelayMs * 2);
    }
    throw new Error('Timed out waiting for host offer');
}

export async function sendIceCandidate({ signalingUrl, sourcePlayerId, token, targetPlayerId, candidate }) {
    if (!signalingUrl) return;
    try {
        await fetch(`${signalingUrl}/signaling/ice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId: sourcePlayerId,
                token: String(token || ''),
                targetPlayerId,
                candidate,
            }),
        });
    } catch (err) {
        logger.debug('ICE send failed (may still connect via other candidates):', err);
    }
}

/**
 * Continue polling after the first batch to support Trickle-ICE: stop only after
 * `quietWindowPolls` consecutive empty polls once at least one candidate has been
 * received, or after `maxRetries` total iterations.
 */
export async function pollIceCandidates({
    signalingUrl,
    playerId,
    token,
    fromPeerId = '',
    addCandidate,
    maxRetries = ICE_POLL_MAX_RETRIES,
    quietWindowPolls = ICE_QUIET_WINDOW_POLLS,
    pollDelayMs = ICE_POLL_DELAY_MS,
}) {
    const params = new URLSearchParams({ playerId, token: String(token || '') });
    if (fromPeerId) {
        params.set('fromPlayerId', fromPeerId);
    }
    const pollUrl = `${signalingUrl}/signaling/ice?${params.toString()}`;

    let hasReceivedAny = false;
    let quietCount = 0;
    for (let i = 0; i < maxRetries; i += 1) {
        try {
            const res = await fetch(pollUrl);
            const data = await res.json();
            if (Array.isArray(data.candidates) && data.candidates.length > 0) {
                for (const candidate of data.candidates) {
                    await addCandidate(candidate);
                }
                hasReceivedAny = true;
                quietCount = 0;
            } else if (hasReceivedAny) {
                quietCount += 1;
                if (quietCount >= quietWindowPolls) return;
            }
        } catch (err) {
            logger.debug('ICE candidate poll failed:', err);
        }
        await delay(pollDelayMs);
    }
}

/**
 * Resolves once the reliable 'state' channel towards `peerId` is open, rejects
 * after `timeoutMs`. Signaling success alone is not a working P2P connection.
 */
export function waitForStateChannelOpen({ dataChannelManager, peerId, timeoutMs }) {
    const existingChannel = dataChannelManager.getChannel(peerId, 'state');
    if (existingChannel?.readyState === 'open') {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const onOpen = ({ peerId: openPeerId, channel }) => {
            if (settled || openPeerId !== peerId || channel !== 'state') return;
            settled = true;
            clearTimeout(timer);
            dataChannelManager.off('channelOpen', onOpen);
            resolve();
        };
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            dataChannelManager.off('channelOpen', onOpen);
            reject(new Error('LAN P2P connection failed: data channel did not open'));
        }, timeoutMs);
        dataChannelManager.on('channelOpen', onOpen);
    });
}
