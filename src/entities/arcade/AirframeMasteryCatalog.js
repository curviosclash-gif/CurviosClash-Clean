export const AIRFRAME_MASTERY_LEVEL_THRESHOLDS = Object.freeze([
    0,
    120,
    300,
    560,
    920,
    1400,
    1980,
    2680,
]);

export const AIRFRAME_MASTERY_UNLOCKS = Object.freeze({
    1: Object.freeze({
        editorBudgetBonus: 0,
        unlockedPartFamilies: [],
        passiveSocketCount: 0,
        maxOverclockTier: 0,
    }),
    2: Object.freeze({
        editorBudgetBonus: 6,
        unlockedPartFamilies: ['wing'],
        passiveSocketCount: 0,
        maxOverclockTier: 1,
    }),
    3: Object.freeze({
        editorBudgetBonus: 12,
        unlockedPartFamilies: ['wing', 'utility'],
        passiveSocketCount: 1,
        maxOverclockTier: 1,
    }),
    4: Object.freeze({
        editorBudgetBonus: 20,
        unlockedPartFamilies: ['wing', 'utility', 'engine'],
        passiveSocketCount: 1,
        maxOverclockTier: 2,
    }),
    5: Object.freeze({
        editorBudgetBonus: 30,
        unlockedPartFamilies: ['wing', 'utility', 'engine', 'nose'],
        passiveSocketCount: 2,
        maxOverclockTier: 2,
    }),
    6: Object.freeze({
        editorBudgetBonus: 42,
        unlockedPartFamilies: ['wing', 'utility', 'engine', 'nose', 'stabilizer'],
        passiveSocketCount: 2,
        maxOverclockTier: 3,
    }),
    7: Object.freeze({
        editorBudgetBonus: 56,
        unlockedPartFamilies: ['wing', 'utility', 'engine', 'nose', 'stabilizer', 'signature'],
        passiveSocketCount: 3,
        maxOverclockTier: 3,
    }),
});

export const AIRFRAME_BASE_BUDGETS = Object.freeze({
    editorBudget: 100,
    massBudget: 90,
    powerBudget: 96,
    heatBudget: 88,
});

export function getAirframeLevelFromXp(xp) {
    const value = Math.max(0, Number(xp) || 0);
    let level = 1;
    for (let i = 1; i < AIRFRAME_MASTERY_LEVEL_THRESHOLDS.length; i += 1) {
        if (value >= AIRFRAME_MASTERY_LEVEL_THRESHOLDS[i]) {
            level = i + 1;
        }
    }
    return level;
}

export function getAirframeUnlockByLevel(level) {
    const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
    return AIRFRAME_MASTERY_UNLOCKS[normalizedLevel] || AIRFRAME_MASTERY_UNLOCKS[1];
}

export default {
    AIRFRAME_MASTERY_LEVEL_THRESHOLDS,
    AIRFRAME_MASTERY_UNLOCKS,
    AIRFRAME_BASE_BUDGETS,
    getAirframeLevelFromXp,
    getAirframeUnlockByLevel,
};
