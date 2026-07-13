import {
    AIRFRAME_BASE_BUDGETS,
    getAirframeLevelFromXp,
    getAirframeUnlockByLevel,
} from './AirframeMasteryCatalog.js';

export const AIRFRAME_MASTERY_SCHEMA_VERSION = 1;

function uniqueValues(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).map((entry) => String(entry || '').trim()).filter(Boolean))];
}

export function createAirframeMasteryState(airframeId, source = {}) {
    const normalizedAirframeId = String(airframeId || '').trim() || 'unknown_airframe';
    const xp = Math.max(0, Number(source.airframeXp) || 0);
    const level = getAirframeLevelFromXp(xp);
    const unlock = getAirframeUnlockByLevel(level);

    return {
        schemaVersion: AIRFRAME_MASTERY_SCHEMA_VERSION,
        airframeId: normalizedAirframeId,
        airframeXp: xp,
        airframeLevel: level,
        editorBudget: AIRFRAME_BASE_BUDGETS.editorBudget + unlock.editorBudgetBonus,
        massBudget: AIRFRAME_BASE_BUDGETS.massBudget,
        powerBudget: AIRFRAME_BASE_BUDGETS.powerBudget,
        heatBudget: AIRFRAME_BASE_BUDGETS.heatBudget,
        unlockedPartFamilies: uniqueValues(unlock.unlockedPartFamilies),
        passiveSocketCount: Math.max(0, Number(unlock.passiveSocketCount) || 0),
        maxOverclockTier: Math.max(0, Number(unlock.maxOverclockTier) || 0),
        cosmeticPrestige: Math.max(0, Number(source.cosmeticPrestige) || 0),
    };
}

export function awardAirframeXp(currentState, deltaXp) {
    const source = currentState && typeof currentState === 'object'
        ? currentState
        : createAirframeMasteryState('unknown_airframe');
    const gain = Math.max(0, Number(deltaXp) || 0);
    const nextXp = Math.max(0, Number(source.airframeXp) || 0) + gain;
    return createAirframeMasteryState(source.airframeId, {
        ...source,
        airframeXp: nextXp,
    });
}

export function serializeAirframeMasteryState(state) {
    const source = state && typeof state === 'object'
        ? state
        : createAirframeMasteryState('unknown_airframe');
    return {
        schemaVersion: AIRFRAME_MASTERY_SCHEMA_VERSION,
        airframeId: String(source.airframeId || '').trim() || 'unknown_airframe',
        airframeXp: Math.max(0, Number(source.airframeXp) || 0),
        cosmeticPrestige: Math.max(0, Number(source.cosmeticPrestige) || 0),
    };
}

export function deserializeAirframeMasteryState(record) {
    if (!record || typeof record !== 'object') {
        return createAirframeMasteryState('unknown_airframe');
    }
    return createAirframeMasteryState(record.airframeId, {
        airframeXp: record.airframeXp,
        cosmeticPrestige: record.cosmeticPrestige,
    });
}

export default {
    AIRFRAME_MASTERY_SCHEMA_VERSION,
    createAirframeMasteryState,
    awardAirframeXp,
    serializeAirframeMasteryState,
    deserializeAirframeMasteryState,
};
