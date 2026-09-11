export const ENDLESS_PARCOURS_RULE_VERSION = 'endless-parcours-rules.v2';

export const ENDLESS_PARCOURS_WAVE_PHASES = Object.freeze({
    INTRO: 'intro',
    ATTACK: 'attack',
    RETREAT: 'retreat',
    REST: 'rest',
    RESUPPLY: 'resupply',
    FINISHED: 'finished',
});

export const ENDLESS_PARCOURS_WAVE_TIMING = Object.freeze({
    attackSeconds: 30,
    retreatSeconds: 4,
    restSeconds: 15,
    resupplySeconds: 10,
    telegraphSeconds: 1,
    activationIntervalSeconds: 1.5,
});

const WAVE_PROFILES = Object.freeze([
    Object.freeze({ capacity: 2, difficulty: 'EASY', healthMultiplier: 1 }),
    Object.freeze({ capacity: 3, difficulty: 'EASY', healthMultiplier: 1.1 }),
    Object.freeze({ capacity: 4, difficulty: 'NORMAL', healthMultiplier: 1.2 }),
    Object.freeze({ capacity: 5, difficulty: 'NORMAL', healthMultiplier: 1.3 }),
    Object.freeze({ capacity: 6, difficulty: 'HARD', healthMultiplier: 1.4 }),
    Object.freeze({ capacity: 8, difficulty: 'HARD', healthMultiplier: 1.5 }),
    Object.freeze({ capacity: 10, difficulty: 'HARD', healthMultiplier: 1.6 }),
    Object.freeze({ capacity: 12, difficulty: 'HARD', healthMultiplier: 1.7 }),
]);

export function isEndlessEliteWave(waveNumber) {
    const wave = Math.max(0, Math.floor(Number(waveNumber) || 0));
    return wave >= 5 && (wave === 5 || (wave - 5) % 3 === 0);
}

export function resolveEndlessWaveProfile(waveNumber) {
    const wave = Math.max(1, Math.floor(Number(waveNumber) || 1));
    const authored = WAVE_PROFILES[Math.min(WAVE_PROFILES.length, wave) - 1];
    return Object.freeze({
        wave,
        capacity: authored.capacity,
        difficulty: authored.difficulty,
        healthMultiplier: wave >= 9 ? 1.8 : authored.healthMultiplier,
        damageMultiplier: Math.min(1.5, 1 + 0.05 * (wave - 1)),
        elite: isEndlessEliteWave(wave),
    });
}

export function resolveEndlessPauseAfterWave(waveNumber) {
    const wave = Math.max(1, Math.floor(Number(waveNumber) || 1));
    return wave % 2 === 1
        ? ENDLESS_PARCOURS_WAVE_PHASES.RETREAT
        : ENDLESS_PARCOURS_WAVE_PHASES.RESUPPLY;
}

export function isEndlessActivationPhase(phase) {
    return phase === ENDLESS_PARCOURS_WAVE_PHASES.ATTACK;
}

export default {
    ENDLESS_PARCOURS_RULE_VERSION,
    ENDLESS_PARCOURS_WAVE_PHASES,
    ENDLESS_PARCOURS_WAVE_TIMING,
    isEndlessActivationPhase,
    isEndlessEliteWave,
    resolveEndlessPauseAfterWave,
    resolveEndlessWaveProfile,
};
