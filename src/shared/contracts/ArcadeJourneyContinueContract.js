import { getArcadeJourneyStage, resolveArcadeJourneyAccess } from './ArcadeJourneyContract.js';
import { readArcadeLastRunRecord } from './ArcadeMenuPersistenceContract.js';

/** Reads only the Journey continuation fields from an already decoded last-run record. */
export function readArcadeJourneyContinueRecord(raw) {
    const result = readArcadeLastRunRecord(raw);
    if (!result.record) return { record: null, status: result.reason };
    const { profileId, journeyStageId } = result.record;
    if (!journeyStageId) return { record: null, status: 'no_journey' };
    if (!profileId || !getArcadeJourneyStage(journeyStageId)) {
        return { record: null, status: 'invalid_journey' };
    }
    return { record: { profileId, stageId: journeyStageId }, status: 'ok' };
}

/** Resolves a continuation for the currently selected profile and current Journey access. */
export function resolveArcadeJourneyContinue(raw, {
    profileId = '', progress = null, progressAvailable = true, playerCount = 1, legacyAccess = false,
} = {}) {
    const parsed = readArcadeJourneyContinueRecord(raw);
    if (!parsed.record) return { stageId: '', profileId: '', status: parsed.status };
    const activeProfileId = String(profileId || '').trim();
    if (!activeProfileId || parsed.record.profileId !== activeProfileId) {
        return { stageId: '', profileId: parsed.record.profileId, status: 'profile_mismatch' };
    }
    if (progressAvailable !== true) {
        return { stageId: parsed.record.stageId, profileId: activeProfileId, status: 'unavailable' };
    }
    const access = resolveArcadeJourneyAccess(parsed.record.stageId, progress, { playerCount, legacyAccess });
    if (!access.unlocked) {
        return { stageId: parsed.record.stageId, profileId: activeProfileId, status: 'locked', reason: access.reason };
    }
    return { stageId: parsed.record.stageId, profileId: activeProfileId, status: 'ready' };
}
