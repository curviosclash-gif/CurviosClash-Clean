// ============================================
// telemetry-report-lib.mjs - pure part of `npm run telemetry:report`
// ============================================
//
// Rechnet aus den gespeicherten Rundendaten einen lesbaren Bericht. Der
// Bericht trennt immer "alle Runden" von "nur echtes Spiel": Testserien und
// unbediente Fenster verschieben sonst jede Quote, ohne dass man es sieht.

import path from 'node:path';

import { resolveRoundControlSource } from '../src/shared/contracts/RoundControlContract.js';
import { normalizeTelemetryHistoryEntry } from '../src/state/telemetry/TelemetryHistoryEntry.js';
import { computeTelemetryHistorySummary } from '../src/state/telemetry/TelemetryHistorySummary.js';

const MIN_ROUNDS_PER_MAP = 1;
// Ab hier ist das 95-%-Intervall einer Siegquote hoechstens etwa +-20 Punkte breit;
// darunter verraet die Quote eher den Zufall als die Bot-Staerke.
const MIN_ROUNDS_FOR_RATE = 20;
const WILSON_Z = 1.96;

/**
 * @param {{appData: string, port: number}} options
 * @returns {string} LevelDB-Ordner der Rundenhistorie fuer diesen Port
 */
export function resolveTelemetryStoreDir({ appData, port }) {
    return path.join(
        appData,
        'curviosclash-app',
        'session-main',
        'IndexedDB',
        `http_127.0.0.1_${port}.indexeddb.leveldb`
    );
}

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Wilson-Intervall statt "Quote +- Fehler": es bleibt auch bei 0 oder allen
 * Siegen und bei wenigen Runden innerhalb von 0 bis 100 Prozent.
 * @returns {[number, number]} untere und obere Grenze in ganzen Prozent
 */
export function wilsonInterval(successes, trials) {
    if (!(trials > 0)) return [0, 100];
    const rate = successes / trials;
    const z2 = WILSON_Z * WILSON_Z;
    const denominator = 1 + z2 / trials;
    const center = (rate + z2 / (2 * trials)) / denominator;
    const half = (WILSON_Z * Math.sqrt(rate * (1 - rate) / trials + z2 / (4 * trials * trials))) / denominator;
    return [Math.round(100 * Math.max(0, center - half)), Math.round(100 * Math.min(1, center + half))];
}

function summarizeWinRate(rows) {
    const wins = rows.filter((row) => row.winnerType === 'human').length;
    return {
        humanWinRate: rows.length > 0 ? Math.round(100 * wins / rows.length) : 0,
        humanWinInterval: wilsonInterval(wins, rows.length),
    };
}

function formatWinRate({ humanWinRate, humanWinInterval }) {
    return `${humanWinRate} % (${humanWinInterval[0]}–${humanWinInterval[1]})`;
}

// Eine Siegquote ueber alle Bot-Stufen und Besetzungen mischt leichte und schwere
// Gegner. Erst je Zelle aus Modus, Stufe und Besetzung sagt sie etwas ueber Balance.
function summarizeBalance(rows) {
    const cells = new Map();
    for (const row of rows) {
        const key = [row.mode, row.botDifficulty, row.humanCount, row.botCount].join('|');
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(row);
    }
    return [...cells.values()]
        .map((cellRows) => ({
            mode: cellRows[0].mode,
            botDifficulty: cellRows[0].botDifficulty,
            humanCount: cellRows[0].humanCount,
            botCount: cellRows[0].botCount,
            rounds: cellRows.length,
            ...summarizeWinRate(cellRows),
            enough: cellRows.length >= MIN_ROUNDS_FOR_RATE,
        }))
        .sort((left, right) => right.rounds - left.rounds
            || left.mode.localeCompare(right.mode)
            || left.botDifficulty.localeCompare(right.botDifficulty));
}

function formatLineup(humanCount, botCount) {
    return `${humanCount} ${humanCount === 1 ? 'Mensch' : 'Menschen'} gegen ${botCount} ${botCount === 1 ? 'Bot' : 'Bots'}`;
}

function balanceTable(cells) {
    if (cells.length === 0) return ['_Keine Runden._'];
    return [
        '| Modus | Bot-Stufe | Besetzung | Runden | Mensch siegt (95-%-Bereich) | belastbar |',
        '| --- | --- | --- | ---: | ---: | --- |',
        ...cells.map((cell) => `| ${cell.mode} | ${cell.botDifficulty} | ${formatLineup(cell.humanCount, cell.botCount)} | ${cell.rounds} | ${formatWinRate(cell)} | ${cell.enough ? 'ja' : 'zu wenig Runden'} |`),
    ];
}

// Aeltere Runden kennen die Zahl der Bildausschnitte nicht; der Sitzungstyp verraet
// dann den geteilten Bildschirm, der mehrere Ausschnitte zeichnet.
function isSplitRound(row) {
    if (row.performance.viewportCount > 0) return row.performance.viewportCount > 1;
    return row.sessionType === 'splitscreen' && row.humanCount > 1;
}

function averageFps(rows) {
    const measured = rows.filter((row) => row.performance.frameAvgMs > 0);
    if (measured.length === 0) return null;
    const frameMs = measured.reduce((sum, row) => sum + row.performance.frameAvgMs, 0) / measured.length;
    return Math.round(1000 / frameMs);
}

function summarizeMaps(rows) {
    const byMap = new Map();
    for (const row of rows) {
        if (!byMap.has(row.mapKey)) byMap.set(row.mapKey, []);
        byMap.get(row.mapKey).push(row);
    }
    return [...byMap.entries()]
        .filter(([, mapRows]) => mapRows.length >= MIN_ROUNDS_PER_MAP)
        .map(([mapKey, mapRows]) => {
            const minutes = mapRows.reduce((sum, row) => sum + row.duration, 0) / 60;
            const perMinute = (field) => (minutes > 0 ? round1(mapRows.reduce((sum, row) => sum + row[field], 0) / minutes) : 0);
            return {
                mapKey,
                rounds: mapRows.length,
                minutes: round1(minutes),
                ...summarizeWinRate(mapRows),
                spawnDeathsPerMinute: perMinute('spawnDeaths'),
                stuckPerMinute: perMinute('stuckEvents'),
                fpsSingle: averageFps(mapRows.filter((row) => !isSplitRound(row))),
                fpsSplit: averageFps(mapRows.filter(isSplitRound)),
            };
        })
        .sort((left, right) => right.rounds - left.rounds || left.mapKey.localeCompare(right.mapKey));
}

function summarizeModes(rows) {
    const modes = [...new Set(rows.map((row) => row.mode))].sort();
    return modes.map((mode) => {
        const modeRows = rows.filter((row) => row.mode === mode);
        return {
            mode,
            rounds: modeRows.length,
            ...summarizeWinRate(modeRows),
            medianDurationSeconds: round1(median(modeRows.map((row) => row.duration))),
        };
    });
}

function summarizeSet(rows) {
    const summary = computeTelemetryHistorySummary(rows);
    return {
        rounds: rows.length,
        minutes: round1(rows.reduce((sum, row) => sum + row.duration, 0) / 60),
        first: rows[0]?.at || '',
        last: rows[rows.length - 1]?.at || '',
        humanWinRate: Math.round(100 * summary.humanWinRate),
        emptyItemActionsPerRound: round1(rows.reduce((sum, row) => sum + row.emptyItemActions, 0) / (rows.length || 1)),
        modes: summarizeModes(rows),
        maps: summarizeMaps(rows),
        balance: summarizeBalance(rows),
    };
}

function mapTable(maps) {
    if (maps.length === 0) return ['_Keine Runden._'];
    return [
        '| Karte | Runden | Minuten | Mensch siegt | Spawn-Tode/min | Festfahrer/min | FPS allein | FPS geteilt |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...maps.map((map) => `| ${map.mapKey} | ${map.rounds} | ${map.minutes} | ${formatWinRate(map)} | ${map.spawnDeathsPerMinute} | ${map.stuckPerMinute} | ${map.fpsSingle ?? '–'} | ${map.fpsSplit ?? '–'} |`),
    ];
}

function modeTable(modes) {
    if (modes.length === 0) return ['_Keine Runden._'];
    return [
        '| Modus | Runden | Mensch siegt | Median-Dauer |',
        '| --- | ---: | ---: | ---: |',
        ...modes.map((mode) => `| ${mode.mode} | ${mode.rounds} | ${formatWinRate(mode)} | ${mode.medianDurationSeconds} s |`),
    ];
}

/**
 * @param {Array<Record<string, any>>} rawRows Eintraege aus der IndexedDB
 * @param {{source?: string}} [options]
 * @returns {{data: Record<string, any>, markdown: string}}
 */
export function buildTelemetryReport(rawRows, { source = '' } = {}) {
    const rows = (Array.isArray(rawRows) ? rawRows : [])
        .map(normalizeTelemetryHistoryEntry)
        .sort((left, right) => left.at.localeCompare(right.at));
    const controlSourceCounts = { human: 0, idle: 0, automation: 0, unknown: 0 };
    rows.forEach((row) => { controlSourceCounts[resolveRoundControlSource(row)] += 1; });
    const realRows = rows.filter((row) => resolveRoundControlSource(row) === 'human');
    const data = {
        source,
        total: summarizeSet(rows),
        realPlay: summarizeSet(realRows),
        controlSourceCounts,
    };

    const lines = [
        '# CurviosClash Rundenprotokoll',
        '',
        `Quelle: ${source || 'unbekannt'} · ${data.total.rounds} Runden · ${data.total.minutes} Minuten Rundenzeit`,
        data.total.rounds > 0 ? `Zeitraum: ${data.total.first.slice(0, 16)} bis ${data.total.last.slice(0, 16)} (UTC)` : 'Zeitraum: –',
        '',
        '## Wer hat gesteuert?',
        '',
        `Mensch ${controlSourceCounts.human} · untätig ${controlSourceCounts.idle} · automatisch ${controlSourceCounts.automation} · unbekannt ${controlSourceCounts.unknown}`,
        '',
        '„Unbekannt“ sind vor allem Runden vor dem 28.09.2026 - damals wurde die Steuerung noch nicht erfasst.',
        '',
        '## Nur echtes Spiel',
        '',
        `${data.realPlay.rounds} Runden, ${data.realPlay.minutes} Minuten, Mensch siegt in ${data.realPlay.humanWinRate} %.`,
        '',
        ...modeTable(data.realPlay.modes),
        '',
        ...mapTable(data.realPlay.maps),
        '',
        '### Siegquote nach Bot-Stufe und Besetzung',
        '',
        `Eine Quote gilt erst ab ${MIN_ROUNDS_FOR_RATE} Runden je Zeile als belastbar. In Klammern steht der Bereich, in dem die wahre Quote mit 95 % Sicherheit liegt.`,
        '',
        ...balanceTable(data.realPlay.balance),
        '',
        '## Alle Runden (inklusive Tests und unbedienter Fenster)',
        '',
        `Leere Tastendrücke je Runde: ${data.total.emptyItemActionsPerRound}`,
        '',
        ...modeTable(data.total.modes),
        '',
        ...mapTable(data.total.maps),
        '',
    ];
    return { data, markdown: lines.join('\n') };
}
