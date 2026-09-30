// ============================================
// RoundControlContract.js - who actually steered a recorded round
// ============================================
//
// Ohne diesen Vertrag zaehlt jede Runde mit einem nicht als Bot markierten
// Spielerplatz als menschliche Runde - auch dann, wenn das Fenster nur offen
// stand oder ein Testwerkzeug die Tasten geschickt hat. Beide Faelle sehen in
// den Rundendaten gleich aus und verzerren Siegquoten und Balancewerte.
//
// Die Klassifikation stuetzt sich auf zwei Quellen: eine Automatisierungs-
// kennung, die nur die startende Seite setzen kann (Testbruecke, WebDriver,
// kopfloser Kernel), und den Anteil der Ticks mit echter Eingabe. Eingaben
// eines Automatisierungswerkzeugs sind von Hand getippten nicht zu
// unterscheiden, deshalb schlaegt die Kennung den Eingabeanteil.

export const ROUND_CONTROL_SOURCES = Object.freeze({
    HUMAN: 'human',
    IDLE: 'idle',
    AUTOMATION: 'automation',
    UNKNOWN: 'unknown',
});

const ROUND_CONTROL_SOURCE_VALUES = Object.freeze(Object.values(ROUND_CONTROL_SOURCES));

// Unter dieser Zahl an Abfragen ist der Anteil Rauschen: eine Runde, die nach
// einer Sekunde endet, sagt ueber Untaetigkeit nichts aus.
export const ROUND_CONTROL_MIN_SAMPLES = 60;

// Ein Mensch haelt selbst beim Geradeausfliegen mehr als jeden fuenfzigsten
// Tick eine Taste. Darunter liegt praktisch nur ein unbedientes Fenster.
export const ROUND_CONTROL_IDLE_SHARE = 0.02;

function toCount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function toSignal(value) {
    return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';
}

function toShare(inputSamples, activeInputSamples) {
    if (inputSamples <= 0) return 0;
    return Math.min(1, activeInputSamples / inputSamples);
}

// Jeder Platz wird fuer sich bewertet: im geteilten Bildschirm verdeckte die
// Summe sonst einen Piloten, der gar nicht am Controller sass.
function countSeats(players) {
    let activeHumanCount = 0;
    let idleHumanCount = 0;
    for (const player of Array.isArray(players) ? players : []) {
        const samples = toCount(player?.samples);
        if (samples < ROUND_CONTROL_MIN_SAMPLES) continue;
        const share = toShare(samples, Math.min(samples, toCount(player?.activeSamples)));
        if (share <= ROUND_CONTROL_IDLE_SHARE) idleHumanCount += 1;
        else activeHumanCount += 1;
    }
    return { activeHumanCount, idleHumanCount };
}

/**
 * @param {{automationSignal?: string, humanCount?: number, inputSamples?: number,
 *          activeInputSamples?: number,
 *          players?: Array<{index?: number, samples?: number, activeSamples?: number}>} | null} [source]
 * @returns {{source: string, automationSignal: string, inputSamples: number,
 *           activeInputSamples: number, inputShare: number,
 *           activeHumanCount: number, idleHumanCount: number}}
 */
export function classifyRoundControl(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    const automationSignal = toSignal(value.automationSignal);
    const inputSamples = toCount(value.inputSamples);
    const activeInputSamples = Math.min(inputSamples, toCount(value.activeInputSamples));
    const inputShare = toShare(inputSamples, activeInputSamples);
    const humanCount = toCount(value.humanCount);
    const hasSeats = Array.isArray(value.players) && value.players.length > 0;
    const seats = hasSeats
        ? countSeats(value.players)
        : countSeats([{ samples: inputSamples, activeSamples: activeInputSamples }]);
    const ratedSeats = seats.activeHumanCount + seats.idleHumanCount;

    let controlSource = ROUND_CONTROL_SOURCES.HUMAN;
    if (automationSignal) {
        controlSource = ROUND_CONTROL_SOURCES.AUTOMATION;
    } else if (humanCount <= 0) {
        // Kein menschlicher Platz heisst kopfloser Lauf, nicht "Mensch war still".
        controlSource = ROUND_CONTROL_SOURCES.AUTOMATION;
    } else if (ratedSeats === 0) {
        controlSource = ROUND_CONTROL_SOURCES.UNKNOWN;
    } else if (seats.activeHumanCount === 0) {
        controlSource = ROUND_CONTROL_SOURCES.IDLE;
    }

    return {
        source: controlSource,
        automationSignal,
        inputSamples,
        activeInputSamples,
        inputShare,
        activeHumanCount: seats.activeHumanCount,
        idleHumanCount: seats.idleHumanCount,
    };
}

/**
 * Nimmt bewusst beliebige Rohdaten an: aeltere Historieneintraege kennen den
 * Block noch nicht und muessen als "unbekannt" durchlaufen, statt als Mensch.
 *
 * @param {any} source
 * @returns {{source: string, automationSignal: string, inputSamples: number,
 *           activeInputSamples: number, inputShare: number,
 *           activeHumanCount: number, idleHumanCount: number}}
 */
export function normalizeRoundControl(source) {
    const value = source && typeof source === 'object' ? source : {};
    const rawSource = toSignal(value.source);
    const inputSamples = toCount(value.inputSamples);
    const activeInputSamples = Math.min(inputSamples, toCount(value.activeInputSamples));
    return {
        source: ROUND_CONTROL_SOURCE_VALUES.includes(rawSource) ? rawSource : ROUND_CONTROL_SOURCES.UNKNOWN,
        automationSignal: toSignal(value.automationSignal),
        inputSamples,
        activeInputSamples,
        inputShare: toShare(inputSamples, activeInputSamples),
        activeHumanCount: toCount(value.activeHumanCount),
        idleHumanCount: toCount(value.idleHumanCount),
    };
}

/**
 * @param {any} entry Historieneintrag oder Rundenpayload
 * @returns {string} eine der ROUND_CONTROL_SOURCES
 */
export function resolveRoundControlSource(entry) {
    return normalizeRoundControl(entry && typeof entry === 'object' ? entry.control : null).source;
}
