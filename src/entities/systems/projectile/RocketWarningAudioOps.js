/**
 * The audible half of the inbound rocket warning.
 *
 * The HUD band (`src/ui/HuntHudRocketWarning.js`) shows the same threat, but `entities`
 * must not import from `ui`, so the two thresholds below are repeated here on purpose.
 * They have to stay in step with the HUD values.
 */
export const ROCKET_WARNING_NEAR_DISTANCE = 40;
export const ROCKET_WARNING_NEAR_SECONDS = 1.5;

/** Repeat distance of the beep while the rocket is still far away. */
export const ROCKET_WARNING_FAR_INTERVAL_MS = 900;
/** Repeat distance once the rocket is about to hit. */
export const ROCKET_WARNING_NEAR_INTERVAL_MS = 450;

const FAR_INTENSITY = 0.55;
const NEAR_INTENSITY = 1;

/**
 * Per player index: whether the warning was already sounding last tick, and the
 * simulation time the next beep is due. Both are plain arrays that only ever grow to
 * the number of players, so a running match allocates nothing per frame.
 */
export function createRocketWarningAudioState() {
    return { activeFlags: [], nextPlayAtMs: [] };
}

/**
 * How many players sit at this machine. `localHumanCount` only exists on a network
 * session; a local split screen carries its humans in `numHumans`, and a network client
 * always controls exactly one slot.
 * @param {{localHumanCount?: unknown, networkEnabled?: unknown, numHumans?: unknown}|null|undefined} session
 * @returns {number}
 */
export function resolveLocalHumanCount(session) {
    const explicit = Math.trunc(Number(session?.localHumanCount) || 0);
    if (explicit > 0) return explicit;
    if (session?.networkEnabled === true) return 1;
    return Math.max(1, Math.trunc(Number(session?.numHumans) || 1));
}

function ensureSlots(state, count) {
    while (state.activeFlags.length < count) {
        state.activeFlags.push(false);
        state.nextPlayAtMs.push(0);
    }
}

function clearSlot(state, index) {
    state.activeFlags[index] = false;
    state.nextPlayAtMs[index] = 0;
}

function isImmediateThreat(threat) {
    const distance = Number(threat.nearestDistance) || 0;
    if (distance > 0 && distance <= ROCKET_WARNING_NEAR_DISTANCE) return true;
    const seconds = Number(threat.timeToImpactSeconds) || 0;
    return seconds > 0 && seconds <= ROCKET_WARNING_NEAR_SECONDS;
}

function findLocalPlayer(players, index) {
    for (let i = 0; i < players.length; i += 1) {
        const player = players[i];
        if (player && Number(player.index) === index) return player;
    }
    return null;
}

/**
 * Plays the warning tone for every locally controlled human that a rocket is chasing.
 *
 * Rising edge (no threat -> threat) sounds at once, after that the beep repeats on the
 * simulation clock, faster when the rocket is close. Bots, remote players, dead players
 * and an ended round never make a sound, and at most one tone leaves per tick even when
 * both split screen players are hunted.
 *
 * @param {{activeFlags: boolean[], nextPlayAtMs: number[]}|null} state
 * @param {Array<any>|null} players
 * @param {((index: number) => any)|null} getThreat
 * @param {{play?: (type: string, options?: any) => void}|null} audio
 * @param {number} simulationNowMs monotonic simulation time, never the wall clock
 * @param {{localPlayerIndex?: number, localHumanCount?: number, roundEnded?: boolean}} [options]
 * @returns {number} how many tones were played this tick (0 or 1)
 */
export function updateRocketWarningAudio(state, players, getThreat, audio, simulationNowMs, options = {}) {
    if (!state || !Array.isArray(players) || players.length === 0) return 0;

    const first = Math.max(0, Math.trunc(Number(options.localPlayerIndex) || 0));
    const localCount = Math.max(1, Math.trunc(Number(options.localHumanCount) || 1));
    const last = first + localCount;
    ensureSlots(state, Math.max(players.length, last));

    if (options.roundEnded === true) {
        for (let i = 0; i < state.activeFlags.length; i += 1) clearSlot(state, i);
        return 0;
    }

    const nowMs = Number(simulationNowMs) || 0;
    let played = 0;
    for (let index = first; index < last; index += 1) {
        const player = findLocalPlayer(players, index);
        const threat = typeof getThreat === 'function' ? getThreat(index) : null;
        const threatened = Boolean(player) && player.isBot !== true && player.alive !== false
            && threat?.active === true;
        if (!threatened) {
            clearSlot(state, index);
            continue;
        }

        const due = state.activeFlags[index] !== true || nowMs >= state.nextPlayAtMs[index];
        state.activeFlags[index] = true;
        if (!due) continue;

        const near = isImmediateThreat(threat);
        state.nextPlayAtMs[index] = nowMs
            + (near ? ROCKET_WARNING_NEAR_INTERVAL_MS : ROCKET_WARNING_FAR_INTERVAL_MS);
        if (played > 0 || typeof audio?.play !== 'function') continue;
        audio.play('ROCKET_WARNING', { intensity: near ? NEAR_INTENSITY : FAR_INTENSITY });
        played += 1;
    }
    return played;
}
