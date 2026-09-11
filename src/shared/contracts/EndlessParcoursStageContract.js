/**
 * Regie-Werte der Endlosjagd: Torbelohnung, Serie, Bedrohungsbild, Telegrafie,
 * Anfuehrer-Wellen und Sturzwarnung. Der Kernvertrag
 * (EndlessParcoursContract) haelt die Fortschritts- und Punkteformel; hier
 * liegen ausschliesslich die Werte, mit denen Runtime und HUD denselben Lauf
 * gleich deuten.
 */

export const ENDLESS_PARCOURS_TELEGRAPH_SECONDS = 1;

export const ENDLESS_PARCOURS_CHECKPOINT = Object.freeze({
    bonusScore: 400,
    // Kurz gehalten: Tore kommen alle 120 m, eine lange Pause wuerde die
    // Eskalation ueber die Haelfte der Laufzeit aussetzen.
    respiteSeconds: 1.2,
    reviveWindowSeconds: 10,
    reviveBackOffMeters: 14,
    flashSeconds: 0.9,
});

export const ENDLESS_PARCOURS_STREAK = Object.freeze({
    windowSeconds: 6,
    step: 0.5,
    maxMultiplier: 5,
    killBaseScore: 250,
    checkpointBaseScore: ENDLESS_PARCOURS_CHECKPOINT.bonusScore,
    pickupBaseScore: 60,
});

export const ENDLESS_PARCOURS_SHAKEOFF_SCORE = 120;

export const ENDLESS_PARCOURS_ELITE = Object.freeze({
    healthMultiplier: 2.4,
    killScore: 900,
});

export const ENDLESS_PARCOURS_VOID_WARNING = Object.freeze({
    marginMeters: 90,
    lethalMarginMeters: 270,
});

const STAGE_PALETTES = Object.freeze([
    Object.freeze({
        tier: 0,
        label: 'INTRO',
        floor: 0x152a3d,
        wall: 0x245a82,
        wallEmissive: 0x0a2d4a,
        wallEmissiveIntensity: 0.4,
        obstacle: 0x8f3348,
        gate: 0x5de2ff,
        gateEmissive: 0x16738d,
    }),
    Object.freeze({
        tier: 1,
        label: 'EASY',
        floor: 0x183047,
        wall: 0x246d8f,
        wallEmissive: 0x0c3550,
        wallEmissiveIntensity: 0.5,
        obstacle: 0xb13a56,
        gate: 0x63e8ff,
        gateEmissive: 0x1a7f98,
    }),
    Object.freeze({
        tier: 2,
        label: 'NORMAL',
        floor: 0x14343c,
        wall: 0x1f8288,
        wallEmissive: 0x0a4448,
        wallEmissiveIntensity: 0.62,
        obstacle: 0xc4453f,
        gate: 0x74f2d6,
        gateEmissive: 0x1d8f76,
    }),
    Object.freeze({
        tier: 3,
        label: 'HARD',
        floor: 0x2d2416,
        wall: 0x8a5320,
        wallEmissive: 0x4a2708,
        wallEmissiveIntensity: 0.78,
        obstacle: 0xd05a24,
        gate: 0xffc46b,
        gateEmissive: 0x9c5a10,
    }),
    Object.freeze({
        tier: 4,
        label: 'ONSLAUGHT',
        floor: 0x33161c,
        wall: 0x912432,
        wallEmissive: 0x520811,
        wallEmissiveIntensity: 0.95,
        obstacle: 0xe23c3c,
        gate: 0xff8a7a,
        gateEmissive: 0xa32218,
    }),
]);

/**
 * @param {unknown} tier
 * @returns {typeof STAGE_PALETTES[number]}
 */
export function resolveEndlessStagePalette(tier) {
    const index = Math.max(0, Math.min(STAGE_PALETTES.length - 1, Math.floor(Number(tier) || 0)));
    return STAGE_PALETTES[index];
}

/**
 * Die Serie waechst in halben Schritten und ist bei x5 gedeckelt. Ein Treffer
 * setzt sie auf 0 zurueck, ein Ereignis innerhalb des Fensters verlaengert sie.
 *
 * @param {unknown} streak
 * @returns {number}
 */
export function resolveEndlessStreakMultiplier(streak) {
    const safeStreak = Math.max(0, Math.floor(Number(streak) || 0));
    if (safeStreak <= 1) return 1;
    return Math.min(
        ENDLESS_PARCOURS_STREAK.maxMultiplier,
        1 + (safeStreak - 1) * ENDLESS_PARCOURS_STREAK.step
    );
}

/**
 * Zusatzpunkte, die eine laufende Serie ueber den Grundwert hinaus einbringt.
 *
 * @param {unknown} baseScore
 * @param {unknown} streak
 * @returns {number}
 */
export function resolveEndlessStreakBonus(baseScore, streak) {
    const base = Math.max(0, Number(baseScore) || 0);
    return Math.floor(base * (resolveEndlessStreakMultiplier(streak) - 1));
}

/**
 * @param {unknown} elapsedCombatSeconds
 * @returns {number} laufende Nummer der Anfuehrer-Welle, 0 = noch keine
 */
export function resolveEndlessEliteWaveIndex(elapsedCombatSeconds) {
    const wave = Math.max(0, Math.floor(Number(elapsedCombatSeconds) || 0));
    if (wave < 5) return 0;
    return Math.floor((wave - 5) / 3) + 1;
}

/**
 * @param {unknown} elapsedCombatSeconds
 * @param {unknown} lastSpawnedWaveIndex
 * @returns {boolean}
 */
export function shouldSpawnEndlessElite(elapsedCombatSeconds, lastSpawnedWaveIndex) {
    const eliteWaveIndex = resolveEndlessEliteWaveIndex(elapsedCombatSeconds);
    if (eliteWaveIndex <= 0) return false;
    return eliteWaveIndex > Math.max(0, Math.floor(Number(lastSpawnedWaveIndex) || 0));
}

/**
 * Das Tempo steigt feiner als vorher (2 % pro Modul statt 5 % pro vier Module)
 * und reicht weiter, damit spaete Laeufe spuerbar schneller werden.
 *
 * @param {unknown} completedModules
 * @returns {number}
 */
export function resolveEndlessSpeedMultiplier(completedModules) {
    const completed = Math.max(0, Math.floor(Number(completedModules) || 0));
    return 1 + Math.min(0.6, completed * 0.02);
}

/**
 * Sturzwarnung: wie weit der Spieler noch zurueckfallen darf, bevor der Lauf
 * endet. Negative Werte bedeuten, dass die toedliche Grenze schon erreicht ist.
 *
 * @param {unknown} progressZ
 * @param {unknown} maxProgressMeters
 * @returns {{ remainingMeters: number, warning: boolean }}
 */
export function resolveEndlessVoidWarning(progressZ, maxProgressMeters) {
    const progress = Number(progressZ) || 0;
    const best = Math.max(0, Number(maxProgressMeters) || 0);
    const lethalZ = best - ENDLESS_PARCOURS_VOID_WARNING.lethalMarginMeters;
    const remainingMeters = progress - lethalZ;
    return {
        remainingMeters,
        warning: remainingMeters <= ENDLESS_PARCOURS_VOID_WARNING.marginMeters,
    };
}

export default {
    ENDLESS_PARCOURS_CHECKPOINT,
    ENDLESS_PARCOURS_ELITE,
    ENDLESS_PARCOURS_SHAKEOFF_SCORE,
    ENDLESS_PARCOURS_STREAK,
    ENDLESS_PARCOURS_TELEGRAPH_SECONDS,
    ENDLESS_PARCOURS_VOID_WARNING,
    resolveEndlessEliteWaveIndex,
    resolveEndlessSpeedMultiplier,
    resolveEndlessStagePalette,
    resolveEndlessStreakBonus,
    resolveEndlessStreakMultiplier,
    resolveEndlessVoidWarning,
    shouldSpawnEndlessElite,
};
