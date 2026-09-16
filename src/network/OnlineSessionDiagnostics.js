export async function createOnlineSessionDiagnostics(adapter) {
    const iceCandidateTypes = { host: 0, srflx: 0, prflx: 0, relay: 0, unknown: 0 };
    for (const peerId of adapter._peerManager?.getAllPeerIds?.() || []) {
        const connection = adapter._peerManager.getConnection(peerId);
        if (!connection?.getStats) {
            iceCandidateTypes.unknown += 1;
            continue;
        }
        try {
            const stats = await connection.getStats();
            const entries = new Map();
            stats.forEach((entry) => entries.set(entry.id, entry));
            let pair = [...entries.values()].find((entry) => (
                entry.type === 'transport' && entry.selectedCandidatePairId
            ));
            if (pair?.selectedCandidatePairId) pair = entries.get(pair.selectedCandidatePairId);
            if (!pair || pair.type !== 'candidate-pair') {
                pair = [...entries.values()].find((entry) => (
                    entry.type === 'candidate-pair'
                    && entry.state === 'succeeded'
                    && (entry.selected === true || entry.nominated === true)
                ));
            }
            const localType = String(entries.get(pair?.localCandidateId)?.candidateType || '').trim();
            const remoteType = String(entries.get(pair?.remoteCandidateId)?.candidateType || '').trim();
            const selectedType = localType === 'relay' || remoteType === 'relay'
                ? 'relay'
                : (localType || remoteType || 'unknown');
            if (Object.hasOwn(iceCandidateTypes, selectedType)) iceCandidateTypes[selectedType] += 1;
            else iceCandidateTypes.unknown += 1;
        } catch {
            iceCandidateTypes.unknown += 1;
        }
    }
    return {
        connected: adapter.isConnected === true,
        isHost: adapter.isHost === true,
        peerCount: adapter._peerManager?.peerCount || 0,
        reconnectingPeerCount: adapter._clientDisconnectedPeers.size,
        latencyByPeer: adapter._latencyMonitor.getAllStats(),
        dataChannels: adapter._dataChannelManager.getMetrics(),
        iceCandidateTypes,
        turnInUse: iceCandidateTypes.relay > 0,
    };
}
