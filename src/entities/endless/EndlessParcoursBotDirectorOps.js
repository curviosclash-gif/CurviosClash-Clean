import {
    deriveEndlessSeed,
    sampleEndlessSeed,
} from '../../shared/contracts/EndlessParcoursContract.js';
import {
    ENDLESS_PARCOURS_ELITE,
    ENDLESS_PARCOURS_TELEGRAPH_SECONDS,
} from '../../shared/contracts/EndlessParcoursStageContract.js';

const ROLE_TABLES = Object.freeze({
    1: Object.freeze(['pursuer', 'pursuer', 'pursuer', 'guard']),
    2: Object.freeze(['pursuer', 'flanker', 'guard', 'pursuer']),
    3: Object.freeze(['pursuer', 'flanker', 'guard', 'interceptor']),
    4: Object.freeze(['interceptor', 'interceptor', 'pursuer', 'flanker', 'guard']),
});

/** Ein Anker vor dem Spieler wird nur ab diesem Abstand zur Sperre - naeher waere unfair. */
const AHEAD_MIN_DISTANCE = 46;

/**
 * Sucht einen Einstiegspunkt. `wantsAhead` erlaubt eine Sperre vor dem Spieler,
 * `wantsElite` verlangt die Anfuehrer-Buehne. Ohne beides bleibt es beim
 * klassischen Einstieg im Rueckraum.
 *
 * @param {any} runtime
 * @param {any} slotState
 * @param {{ wantsAhead?: boolean, wantsElite?: boolean }} [options]
 */
export function findSafeEndlessSpawnAnchor(runtime, slotState, options = {}) {
    const human = runtime.entityManager?.humanPlayers?.[0] || null;
    let hasSelection = false;
    let selectedRank = 0xffffffff;
    const domain = `bot-slot:${slotState.slot}:life:${slotState.activationGeneration + 1}`;
    const wantsElite = options.wantsElite === true;
    const wantsAhead = wantsElite || options.wantsAhead === true;
    for (const instance of runtime.activeModules.values()) {
        const module = instance.module;
        for (let index = 0; index < module.botAnchors.length; index += 1) {
            const local = module.botAnchors[index];
            if (wantsElite && local.elite !== true) continue;
            if (!wantsElite && local.elite === true) continue;
            if (!wantsAhead && local.ahead === true) continue;
            runtime._tmpSpawnPosition.set(local.x, local.y, module.originZ + local.z);
            const candidate = runtime._candidateSpawnAnchor;
            candidate.id = local.id;
            candidate.x = runtime._tmpSpawnPosition.x;
            candidate.y = runtime._tmpSpawnPosition.y;
            candidate.z = runtime._tmpSpawnPosition.z;
            candidate.ahead = local.ahead === true;
            if (!runtime._isSpawnAnchorSafe(candidate, human)) continue;
            const rank = deriveEndlessSeed(runtime.baseSeed, `${domain}:${candidate.id}`);
            if (rank >= selectedRank) continue;
            selectedRank = rank;
            hasSelection = true;
            runtime._selectedSpawnAnchor.id = candidate.id;
            runtime._selectedSpawnAnchor.x = candidate.x;
            runtime._selectedSpawnAnchor.y = candidate.y;
            runtime._selectedSpawnAnchor.z = candidate.z;
            runtime._selectedSpawnAnchor.ahead = candidate.ahead;
        }
    }
    return hasSelection ? runtime._selectedSpawnAnchor : null;
}

/**
 * Ein Anker vor dem Spieler ist nur ab AHEAD_MIN_DISTANCE erlaubt; alles andere
 * muss weiterhin hinter der Blickrichtung liegen.
 *
 * @param {any} runtime
 * @param {{ ahead?: boolean }} anchor
 * @param {any} human
 * @param {number} forwardDot
 * @param {number} distance
 * @returns {boolean}
 */
export function isEndlessAnchorDirectionAllowed(runtime, anchor, human, forwardDot, distance) {
    void runtime;
    void human;
    if (anchor?.ahead === true) return distance >= AHEAD_MIN_DISTANCE;
    return forwardDot <= 0.05;
}

/**
 * @param {any} runtime
 * @param {any} slotState
 * @param {{ elite?: boolean }} [options]
 */
export function resolveEndlessBotRole(runtime, slotState, options = {}) {
    if (options.elite === true) return 'elite';
    const wave = Math.max(1, Math.floor(Number(runtime.waveNumber) || 1));
    const roles = wave <= 2
        ? ['pursuer']
        : (wave <= 4 ? ['pursuer', 'flanker'] : ROLE_TABLES[4]);
    const directorSeed = deriveEndlessSeed(runtime.baseSeed, `bot-director:${wave}`);
    const slotSeed = deriveEndlessSeed(directorSeed, `bot-slot:${slotState.slot}:${slotState.life + 1}`);
    return roles[Math.floor(sampleEndlessSeed(slotSeed) * roles.length) % roles.length];
}

export function resolveEndlessBotRocketType(waveNumber, role) {
    const wave = Math.max(1, Math.floor(Number(waveNumber) || 1));
    const normalizedRole = String(role || '').trim().toLowerCase();
    if (wave >= 5 && ['flanker', 'interceptor', 'guard'].includes(normalizedRole)) return 'ROCKET_MEDIUM';
    if (wave >= 3 && normalizedRole === 'flanker') return 'ROCKET_WEAK';
    return '';
}

/**
 * Aus welcher Richtung ein Jaeger kommt - fuer die Randwarnung im HUD.
 *
 * @param {any} human
 * @param {{ x: number, z: number }} anchor
 * @returns {'left' | 'right' | 'ahead' | 'behind'}
 */
export function resolveEndlessSpawnSide(human, anchor) {
    const playerZ = Number(human?.position?.z) || 0;
    const playerX = Number(human?.position?.x) || 0;
    const deltaZ = (Number(anchor?.z) || 0) - playerZ;
    const deltaX = (Number(anchor?.x) || 0) - playerX;
    if (Math.abs(deltaZ) > Math.abs(deltaX)) return deltaZ >= 0 ? 'ahead' : 'behind';
    return deltaX >= 0 ? 'right' : 'left';
}

/**
 * Kuendigt einen Jaeger an, bevor er erscheint. Vorher poppten Verfolger ohne
 * jede Vorwarnung im Rueckraum auf.
 *
 * @param {any} runtime
 * @param {any} slotState
 * @param {{ elite?: boolean }} [options]
 */
export function telegraphEndlessSpawn(runtime, slotState, options = {}) {
    const elite = options.elite === true;
    const anchor = findSafeEndlessSpawnAnchor(runtime, slotState, {
        wantsElite: elite,
        wantsAhead: shouldUseAheadAnchor(runtime, slotState),
    });
    if (!anchor) return false;
    slotState.plannedAnchor = { id: anchor.id, x: anchor.x, y: anchor.y, z: anchor.z, ahead: anchor.ahead === true };
    slotState.plannedElite = elite;
    slotState.telegraphedAt = runtime.elapsedCombatSeconds;
    const human = runtime.entityManager?.humanPlayers?.[0] || null;
    runtime.spawnWarning = {
        side: resolveEndlessSpawnSide(human, anchor),
        remaining: ENDLESS_PARCOURS_TELEGRAPH_SECONDS,
        elite,
    };
    runtime.audio?.play?.(elite ? 'FIGHT_LEAD' : 'PARCOURS_BRANCH');
    if (elite) {
        runtime.entityManager?._notifyPlayerFeedback?.(human, 'Anfuehrer im Anflug');
    }
    return true;
}

/**
 * Jede dritte Verstaerkung kommt als Sperre von vorn, damit der Rueckraum nicht
 * die einzige Bedrohungsrichtung bleibt.
 *
 * @param {any} runtime
 * @param {any} slotState
 * @returns {boolean}
 */
export function shouldUseAheadAnchor(runtime, slotState) {
    const wave = Math.max(1, Math.floor(Number(runtime.waveNumber) || 1));
    if (wave < 5) return false;
    const seed = deriveEndlessSeed(
        runtime.baseSeed,
        `ahead:${slotState.slot}:${slotState.activationGeneration + 1}:${wave}`
    );
    return sampleEndlessSeed(seed) < 0.34;
}

/**
 * Macht einen frisch eingesetzten Bot zum Anfuehrer: mehr Lebenspunkte und eine
 * eigene Rolle. Die Punkte dafuer verrechnet die Runtime beim Abschuss.
 *
 * @param {any} player
 */
export function promoteEndlessElite(player) {
    if (!player) return false;
    const baseMaxHp = Math.max(1, Number(player.maxHp) || 100);
    player.maxHp = Math.round(baseMaxHp * ENDLESS_PARCOURS_ELITE.healthMultiplier);
    player.hp = player.maxHp;
    player.isEndlessElite = true;
    return true;
}

/**
 * @param {any} player
 */
export function clearEndlessElite(player) {
    if (!player) return;
    player.isEndlessElite = false;
}
