export async function cleanupCancelledHostCreation({ signalingUrl, leaveRoute, hostToken, timeoutMs, fetchImpl = globalThis.fetch, logger }) {
    if (!hostToken) return;
    try {
        const response = await fetchImpl(`${signalingUrl}${leaveRoute}`, {
            signal: AbortSignal.timeout(timeoutMs),
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: 'host', hostToken }),
        });
        if (response?.ok === false) logger?.warn?.('Cancelled lobby creation cleanup failed:', response.status || 'unknown');
    } catch (error) {
        logger?.warn?.('Cancelled lobby creation cleanup failed:', error);
    }
}

export function createHostCancelledError() {
    const error = /** @type {Error & { code: string }} */ (new Error('Lobby creation was cancelled.'));
    error.code = 'host_cancelled';
    return error;
}
