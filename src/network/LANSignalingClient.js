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

export const SIGNALING_REQUEST_TIMEOUT_MS = 5_000;

/** Waits `ms`; rejects early with the abort reason once `signal` aborts. */
export function delay(ms, signal = null) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/** fetch() with a deadline, so an unreachable LAN host cannot stall a handshake loop. */
export function fetchSignaling(url, init = {}, timeoutMs = SIGNALING_REQUEST_TIMEOUT_MS) {
    if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
        return fetch(url, init);
    }
    const deadline = AbortSignal.timeout(timeoutMs);
    if (!init.signal) {
        return fetch(url, { ...init, signal: deadline });
    }
    // A caller's cancellation signal must not drop the deadline.
    if (typeof AbortSignal.any !== 'function') {
        return fetch(url, init);
    }
    return fetch(url, { ...init, signal: AbortSignal.any([init.signal, deadline]) });
}

/**
 * Polls the signaling server until the host offer for this player arrives.
 * The GET consumes the offer server-side, so the token must belong to the player.
 * An aborted `signal` stops the poll, so a superseded handshake cannot take the
 * offer meant for its successor.
 */
export async function waitForHostOffer({ signalingUrl, playerId, token, now = () => Date.now(), signal = null }) {
    let offerPollDelayMs = JOIN_OFFER_INITIAL_BACKOFF_MS;
    const offerPollingStartedAt = Number(now()) || 0;
    const offerParams = new URLSearchParams({ playerId, token: String(token || '') });
    while ((Number(now()) || 0) - offerPollingStartedAt < JOIN_OFFER_MAX_WAIT_MS) {
        signal?.throwIfAborted();
        try {
            const offerRes = await fetchSignaling(`${signalingUrl}/signaling/offer?${offerParams.toString()}`, { signal });
            if (offerRes?.ok === false) {
                throw new Error(`Offer poll failed (${offerRes.status || 'unknown'})`);
            }
            const data = await offerRes.json();
            if (data.offer) {
                return data.offer;
            }
        } catch (err) {
            signal?.throwIfAborted();
            logger.debug('Offer poll failed:', err);
        }
        await delay(offerPollDelayMs, signal);
        offerPollDelayMs = Math.min(JOIN_OFFER_MAX_BACKOFF_MS, offerPollDelayMs * 2);
    }
    throw new Error('Timed out waiting for host offer');
}

export async function sendIceCandidate({ signalingUrl, sourcePlayerId, token, targetPlayerId, candidate, signal = null }) {
    if (!signalingUrl || signal?.aborted) return;
    try {
        await fetchSignaling(`${signalingUrl}/signaling/ice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId: sourcePlayerId,
                token: String(token || ''),
                targetPlayerId,
                candidate,
            }),
            signal,
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
    requestTimeoutMs = SIGNALING_REQUEST_TIMEOUT_MS,
    signal = null,
}) {
    const params = new URLSearchParams({ playerId, token: String(token || '') });
    if (fromPeerId) {
        params.set('fromPlayerId', fromPeerId);
    }
    const pollUrl = `${signalingUrl}/signaling/ice?${params.toString()}`;

    let hasReceivedAny = false;
    let quietCount = 0;
    for (let i = 0; i < maxRetries; i += 1) {
        // The GET drains the candidate queue: a superseded poll must not steal them.
        signal?.throwIfAborted();
        try {
            const res = await fetchSignaling(pollUrl, { signal }, requestTimeoutMs);
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
            signal?.throwIfAborted();
            logger.debug('ICE candidate poll failed:', err);
        }
        await delay(pollDelayMs, signal);
    }
}

/**
 * Resolves once the reliable 'state' channel towards `peerId` is open, rejects
 * after `timeoutMs`. Signaling success alone is not a working P2P connection.
 */
export function waitForStateChannelOpen({
    dataChannelManager,
    peerId,
    timeoutMs,
    signal = null,
    errorMessage = 'P2P connection failed: data channel did not open',
}) {
    const existingChannel = dataChannelManager.getChannel(peerId, 'state');
    if (existingChannel?.readyState === 'open') {
        return Promise.resolve();
    }
    const channelOpen = new Promise((resolve, reject) => {
        let settled = false;
        const settle = (finish) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            dataChannelManager.off('channelOpen', onOpen);
            signal?.removeEventListener('abort', onAbort);
            finish();
        };
        const onOpen = ({ peerId: openPeerId, channel }) => {
            if (openPeerId !== peerId || channel !== 'state') return;
            settle(resolve);
        };
        const onAbort = () => settle(() => reject(signal.reason));
        const timer = setTimeout(() => settle(() => reject(new Error(errorMessage))), timeoutMs);
        dataChannelManager.on('channelOpen', onOpen);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
    });
    // Callers create this before the answer and ICE steps and await it last. If one of those
    // steps throws first, the later timeout must not surface as an unhandled rejection.
    channelOpen.catch(() => {});
    return channelOpen;
}
