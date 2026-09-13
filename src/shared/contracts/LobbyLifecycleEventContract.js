import { MATCH_LIFECYCLE_CONTRACT_VERSION } from './MatchLifecycleContract.js';
import { normalizeString } from './ContractNormalizeUtils.js';

export const LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION = MATCH_LIFECYCLE_CONTRACT_VERSION;

export function buildLobbyLifecycleEventPayload(eventType, payload = null) {
    const sourcePayload = payload && typeof payload === 'object' ? payload : {};
    return {
        contractVersion: LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION,
        eventType: normalizeString(eventType, 'unknown'),
        ...sourcePayload,
    };
}
