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

/**
 * @param {{automationSignal?: string, humanCount?: number, inputSamples?: number,
 *          activeInputSamples?: number} | null} [source]
 * @returns {{source: string, automationSignal: string, inputSamples: number,
 *           activeInputSamples: number, inputShare: number}}
 */
export function classifyRoundControl(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    const automationSignal = toSignal(value.automationSignal);
    const inputSamples = toCount(value.inputSamples);
    const activeInputSamples = Math.min(inputSamples, toCount(value.activeInputSamples));
    const inputShare = toShare(inputSamples, activeInputSamples);
    const humanCount = toCount(value.humanCount);

    let controlSource = ROUND_CONTROL_SOURCES.HUMAN;
    if (automationSignal) {
        controlSource = ROUND_CONTROL_SOURCES.AUTOMATION;
    } else if (humanCount <= 0) {
        // Kein menschlicher Platz heisst kopfloser Lauf, nicht "Mensch war still".
        controlSource = ROUND_CONTROL_SOURCES.AUTOMATION;
    } else if (inputSamples < ROUND_CONTROL_MIN_SAMPLES) {
        controlSource = ROUND_CONTROL_SOURCES.UNKNOWN;
    } else if (inputShare <= ROUND_CONTROL_IDLE_SHARE) {
        controlSource = ROUND_CONTROL_SOURCES.IDLE;
    }

    return {
        source: controlSource,
        automationSignal,
        inputSamples,
        activeInputSamples,
        inputShare,
    };
}

/**
 * Nimmt bewusst beliebige Rohdaten an: aeltere Historieneintraege kennen den
 * Block noch nicht und muessen als "unbekannt" durchlaufen, statt als Mensch.
 *
 * @param {any} source
 * @returns {{source: string, automationSignal: string, inputSamples: number,
 *           activeInputSamples: number, inputShare: number}}
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
    };
}

/**
 * @param {any} entry Historieneintrag oder Rundenpayload
 * @returns {string} eine der ROUND_CONTROL_SOURCES
 */
export function resolveRoundControlSource(entry) {
    return normalizeRoundControl(entry && typeof entry === 'object' ? entry.control : null).source;
}
