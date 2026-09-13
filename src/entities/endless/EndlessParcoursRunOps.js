import * as THREE from 'three';
import { ENDLESS_PARCOURS_MODULE_LENGTH } from '../../shared/contracts/EndlessParcoursContract.js';
import {
    ENDLESS_PARCOURS_CHECKPOINT,
    ENDLESS_PARCOURS_SHAKEOFF_SCORE,
    ENDLESS_PARCOURS_STREAK,
    resolveEndlessStreakBonus,
    resolveEndlessStreakMultiplier,
} from '../../shared/contracts/EndlessParcoursStageContract.js';
import {
    registerEndlessObjectiveShakeoff,
    registerEndlessPlayerDamage,
} from './EndlessParcoursObjectiveOps.js';

/**
 * Tor-Nummer, die bei dieser Strecke bereits durchfahren ist. -1 heisst: noch
 * keines. Die Tore stehen in festem Abstand, deshalb reicht Rechnen statt Suchen.
 *
 * @param {unknown} progressZ
 * @param {unknown} localCheckpointZ
 * @returns {number}
 */
export function resolveEndlessCheckpointIndex(progressZ, localCheckpointZ = 116) {
    const z = Number(progressZ) || 0;
    const offset = Number(localCheckpointZ) || 116;
    return Math.floor((z - offset) / ENDLESS_PARCOURS_MODULE_LENGTH);
}

/**
 * Verlaengert die Serie und schreibt den Serienzuschlag fest. Zurueck kommt der
 * Multiplikator, mit dem das Ereignis gezaehlt wurde - das HUD zeigt ihn an.
 *
 * @param {any} runtime
 * @param {string} kind
 * @param {number} baseScore
 * @returns {number}
 */
export function registerEndlessStreakEvent(runtime, kind, baseScore) {
    if (!runtime) return 1;
    const withinWindow = runtime.streakExpiresAtSeconds > runtime.elapsedCombatSeconds;
    runtime.streak = withinWindow ? runtime.streak + 1 : 1;
    runtime.streakExpiresAtSeconds = runtime.elapsedCombatSeconds + ENDLESS_PARCOURS_STREAK.windowSeconds;
    runtime.bestStreak = Math.max(runtime.bestStreak, runtime.streak);
    const bonus = resolveEndlessStreakBonus(baseScore, runtime.streak);
    runtime.bonusScore += bonus;
    runtime.lastStreakKind = String(kind || '');
    return resolveEndlessStreakMultiplier(runtime.streak);
}

/**
 * Ein Treffer beendet die Serie. Das ist die Gegenleistung fuer den Zuschlag:
 * wer die Serie halten will, darf nicht getroffen werden.
 *
 * @param {any} runtime
 */
export function breakEndlessStreak(runtime) {
    if (!runtime || runtime.streak <= 0) return;
    runtime.streak = 0;
    runtime.streakExpiresAtSeconds = 0;
    runtime.entityManager?._notifyPlayerFeedback?.(
        runtime.entityManager?.humanPlayers?.[0] || null,
        'Serie verloren'
    );
}

/**
 * Laesst die Serie verfallen, sobald das Fenster abgelaufen ist.
 *
 * @param {any} runtime
 */
export function updateEndlessStreak(runtime) {
    if (!runtime || runtime.streak <= 0) return;
    if (runtime.streakExpiresAtSeconds > runtime.elapsedCombatSeconds) return;
    runtime.streak = 0;
    runtime.streakExpiresAtSeconds = 0;
}

/**
 * Torabschluss: Punkte, Klang, Lichtblitz, kurze Atempause und ein
 * Rettungsfenster. Genau das machte das Tor vorher nicht - es war nur Deko.
 *
 * @param {any} runtime
 * @param {number} progressZ
 */
export function handleEndlessCheckpointCrossing(runtime, progressZ) {
    if (!runtime) return false;
    const targetIndex = resolveEndlessCheckpointIndex(progressZ);
    if (targetIndex < 0 || targetIndex <= runtime.lastCheckpointIndex) return false;
    for (let index = runtime.lastCheckpointIndex + 1; index <= targetIndex; index += 1) {
        runtime.lastCheckpointIndex = index;
        runtime.checkpointsPassed += 1;
        runtime.lastCheckpointAtSeconds = runtime.elapsedCombatSeconds;
        runtime.respiteUntilSeconds = runtime.elapsedCombatSeconds + ENDLESS_PARCOURS_CHECKPOINT.respiteSeconds;
        runtime.reviveArmedUntilSeconds = runtime.elapsedCombatSeconds
            + ENDLESS_PARCOURS_CHECKPOINT.reviveWindowSeconds;
        runtime.gateFlashRemaining = ENDLESS_PARCOURS_CHECKPOINT.flashSeconds;
        runtime.bonusScore += ENDLESS_PARCOURS_CHECKPOINT.bonusScore;
        const multiplier = registerEndlessStreakEvent(runtime, 'checkpoint', ENDLESS_PARCOURS_STREAK.checkpointBaseScore);
        const anchor = resolveEndlessCheckpointAnchor(runtime, index);
        if (anchor) runtime.lastCheckpointAnchor = anchor;
        runtime.collectRunXp?.('checkpoint', 1);
        runtime.onCheckpointPassed?.(index);
        runtime.audio?.play?.('PARCOURS_CP');
        runtime.entityManager?._notifyPlayerFeedback?.(
            runtime.entityManager?.humanPlayers?.[0] || null,
            `Tor ${index + 1} - Serie x${multiplier.toFixed(1)}`
        );
    }
    return true;
}

function resolveEndlessCheckpointAnchor(runtime, index) {
    const instance = runtime.activeModules?.get?.(index);
    if (!instance?.gateCenter) return null;
    return {
        x: instance.gateCenter.x,
        y: instance.gateCenter.y,
        z: instance.module.checkpointZ,
    };
}

/**
 * Rettung nach dem Tor: Wer kurz nach einer Torpassage stirbt, wird einmal am
 * Tor wieder eingesetzt statt den Lauf zu verlieren. Pro Tor genau einmal.
 *
 * @param {any} runtime
 * @param {any} player
 * @returns {boolean} true = gerettet, der Lauf geht weiter
 */
export function tryEndlessRevive(runtime, player) {
    if (!runtime || !player || player.isBot) return false;
    if (runtime.lastCheckpointIndex < 0) return false;
    if (runtime.reviveUsedAtCheckpointIndex === runtime.lastCheckpointIndex) return false;
    if (runtime.reviveArmedUntilSeconds <= runtime.elapsedCombatSeconds) return false;
    const anchor = runtime.lastCheckpointAnchor;
    if (!anchor) return false;
    const position = new THREE.Vector3(
        anchor.x,
        anchor.y,
        anchor.z - ENDLESS_PARCOURS_CHECKPOINT.reviveBackOffMeters
    );
    const direction = new THREE.Vector3(0, 0, 1);
    const spawned = runtime.entityManager?._spawnOps?.spawnPlayerAt?.(player, position, direction);
    if (spawned === false) return false;
    if (player.alive !== true) return false;
    runtime.reviveUsedAtCheckpointIndex = runtime.lastCheckpointIndex;
    runtime.reviveCount += 1;
    runtime.respiteUntilSeconds = runtime.elapsedCombatSeconds + ENDLESS_PARCOURS_CHECKPOINT.respiteSeconds;
    registerEndlessPlayerDamage(runtime);
    breakEndlessStreak(runtime);
    runtime.audio?.play?.('PARCOURS_FINISH');
    runtime.entityManager?._notifyPlayerFeedback?.(player, 'Am Tor gerettet');
    return true;
}

/**
 * Ein Verfolger, dessen Baustein hinter dem Spieler entladen wird, gilt als
 * abgeschuettelt. Vorher verschwand er still - jetzt ist es ein Erfolg.
 *
 * @param {any} runtime
 * @param {number} count
 */
export function registerEndlessShakeoff(runtime, count = 1) {
    const shaken = Math.max(0, Math.floor(Number(count) || 0));
    if (!runtime || shaken <= 0) return;
    runtime.shakeoffs += shaken;
    runtime.bonusScore += ENDLESS_PARCOURS_SHAKEOFF_SCORE * shaken;
    registerEndlessObjectiveShakeoff(runtime, shaken);
    runtime.audio?.play?.('FIGHT_ASSIST');
    runtime.entityManager?._notifyPlayerFeedback?.(
        runtime.entityManager?.humanPlayers?.[0] || null,
        shaken > 1 ? `${shaken} Verfolger abgeschuettelt` : 'Verfolger abgeschuettelt'
    );
}
