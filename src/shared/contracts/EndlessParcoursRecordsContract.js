import {
    ENDLESS_PARCOURS_MILESTONES,
    resolveEndlessMilestones,
} from './EndlessParcoursContract.js';

/**
 * Datenform der Endlos-Rekorde. Sie liegt hier und nicht in der Zustandsschicht,
 * weil beide Seiten sie brauchen: die Runtime schreibt sie, das Menue liest sie.
 * Der Speicherschluessel bleibt bei v1, damit vorhandene Rekorde erhalten bleiben.
 */
export const ENDLESS_PARCOURS_RECORDS_STORAGE_KEY = 'curviosclash.endless-parcours-records.v1';
export const ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION = 'endless-parcours-records.v3';
export const ENDLESS_PARCOURS_RECORDS_LEGACY_SCHEMA_VERSION = 'endless-parcours-records.v1';
export const ENDLESS_PARCOURS_RECORDS_V2_SCHEMA_VERSION = 'endless-parcours-records.v2';
export const ENDLESS_PARCOURS_TOP_RUNS = 5;

const MILESTONE_IDS = new Set(ENDLESS_PARCOURS_MILESTONES.map((entry) => String(entry.id)));
const MILESTONE_LABEL_BY_ID = new Map(
    ENDLESS_PARCOURS_MILESTONES.map((entry) => [String(entry.id), String(entry.label)])
);

export function resolveEndlessCosmeticUnlocks(summary = null) {
    const source = summary && typeof summary === 'object' ? summary : {};
    const unlocks = [];
    if (number(source.distanceMeters) >= 1000) unlocks.push('accent-copper', 'title-ausbrecher');
    if (number(source.distanceMeters) >= 2500) unlocks.push('accent-turquoise', 'title-schluchtenlaeufer');
    if (integer(source.eliteKills) >= 1) unlocks.push('accent-violet', 'title-jaegerbrecher');
    return unlocks;
}

function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function integer(value, fallback = 0) {
    return Math.floor(number(value, fallback));
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeMetrics(value = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        score: integer(source.score),
        distanceMeters: number(source.distanceMeters),
        survivalSeconds: number(source.survivalSeconds),
        completedModules: integer(source.completedModules),
        botKills: integer(source.botKills),
        eliteKills: integer(source.eliteKills),
        bestStreak: integer(source.bestStreak),
        checkpointsPassed: integer(source.checkpointsPassed),
        shakeoffs: integer(source.shakeoffs),
        revives: integer(source.revives),
        bonusScore: integer(source.bonusScore),
        seed: integer(source.seed),
        date: text(source.date),
        runId: text(source.runId),
        ruleVersion: text(source.ruleVersion) || 'endless-parcours-rules.v1',
    };
}

function normalizeMilestoneIds(value) {
    if (!Array.isArray(value)) return [];
    const unique = [];
    for (const entry of value) {
        const id = text(entry);
        if (!MILESTONE_IDS.has(id) || unique.includes(id)) continue;
        unique.push(id);
    }
    return unique;
}

function sortByScoreDesc(left, right) {
    if (right.score !== left.score) return right.score - left.score;
    return right.distanceMeters - left.distanceMeters;
}

function normalizeTopRuns(value, best) {
    const entries = Array.isArray(value) ? value.map(normalizeMetrics) : [];
    const usable = entries.filter((entry) => entry.score > 0);
    if (usable.length === 0 && best.score > 0) usable.push({ ...best });
    return usable.sort(sortByScoreDesc).slice(0, ENDLESS_PARCOURS_TOP_RUNS);
}

/**
 * Nimmt sowohl das aktuelle Format als auch die erste Fassung an. Ein alter
 * Rekord bleibt dadurch erhalten, statt beim Aufraeumen verloren zu gehen.
 *
 * @param {unknown} [value]
 */
export function normalizeEndlessParcoursRecords(value = null) {
    const candidate = /** @type {Record<string, unknown>} */ (
        value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    );
    const version = text(candidate.schemaVersion);
    const isKnown = version === ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION
        || version === ENDLESS_PARCOURS_RECORDS_V2_SCHEMA_VERSION
        || version === ENDLESS_PARCOURS_RECORDS_LEGACY_SCHEMA_VERSION;
    const source = isKnown ? candidate : {};
    const best = normalizeMetrics(source.best);
    const last = normalizeMetrics(source.last);
    const top = normalizeTopRuns(source.top, best);
    const farthest = [best, last, ...top]
        .map(normalizeMetrics)
        .sort((left, right) => right.distanceMeters - left.distanceMeters)[0] || normalizeMetrics();
    const bestByRuleVersion = {};
    const rawBestByVersion = source.bestByRuleVersion && typeof source.bestByRuleVersion === 'object'
        ? source.bestByRuleVersion : {};
    for (const [ruleVersion, entry] of Object.entries(rawBestByVersion)) {
        const key = text(ruleVersion);
        if (key) bestByRuleVersion[key] = normalizeMetrics(entry);
    }
    if (best.score > 0 && !bestByRuleVersion[best.ruleVersion]) bestByRuleVersion[best.ruleVersion] = { ...best };
    const topByRuleVersion = {};
    const rawTopByVersion = source.topByRuleVersion && typeof source.topByRuleVersion === 'object'
        ? source.topByRuleVersion : {};
    for (const [ruleVersion, entries] of Object.entries(rawTopByVersion)) {
        const key = text(ruleVersion);
        if (key) topByRuleVersion[key] = normalizeTopRuns(entries, bestByRuleVersion[key] || normalizeMetrics());
    }
    for (const entry of top) {
        if (!topByRuleVersion[entry.ruleVersion]) topByRuleVersion[entry.ruleVersion] = [];
        if (!topByRuleVersion[entry.ruleVersion].some((candidate) => candidate.date === entry.date && candidate.score === entry.score)) {
            topByRuleVersion[entry.ruleVersion].push({ ...entry });
            topByRuleVersion[entry.ruleVersion].sort(sortByScoreDesc);
            topByRuleVersion[entry.ruleVersion].length = Math.min(topByRuleVersion[entry.ruleVersion].length, ENDLESS_PARCOURS_TOP_RUNS);
        }
    }
    return {
        schemaVersion: ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION,
        best,
        bestDistance: normalizeMetrics(/** @type {any} */ (source.bestDistance)?.distanceMeters != null
            ? source.bestDistance : farthest),
        last,
        top,
        bestByRuleVersion,
        topByRuleVersion,
        processedSettlementIds: Array.isArray(source.processedSettlementIds)
            ? [...new Set(source.processedSettlementIds.map(text).filter(Boolean))].slice(-64)
            : [],
        cosmetics: [...new Set([
            ...(Array.isArray(source.cosmetics) ? source.cosmetics.map(text).filter(Boolean) : []),
            ...resolveEndlessCosmeticUnlocks(best),
            ...resolveEndlessCosmeticUnlocks(farthest),
        ])],
        milestones: version === ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION || version === ENDLESS_PARCOURS_RECORDS_V2_SCHEMA_VERSION
            ? normalizeMilestoneIds(source.milestones)
            : resolveEndlessMilestones(best),
    };
}

/**
 * Schreibt einen beendeten Lauf fest: Bestwert, letzter Lauf, Top-Liste und die
 * dauerhaft freigeschalteten Meilensteine.
 *
 * @param {unknown} records
 * @param {Record<string, unknown> | null} summary
 * @param {string} [date]
 */
export function updateEndlessParcoursRecords(records, summary, date = '') {
    const current = normalizeEndlessParcoursRecords(records);
    const last = normalizeMetrics({ ...summary, date });
    const versionBest = normalizeMetrics(current.bestByRuleVersion[last.ruleVersion]);
    const isNewRecord = last.score > versionBest.score;
    const top = last.score > 0
        ? [...current.top, { ...last }].sort(sortByScoreDesc).slice(0, ENDLESS_PARCOURS_TOP_RUNS)
        : current.top.slice();
    const reached = resolveEndlessMilestones(last);
    const newMilestones = reached.filter((id) => !current.milestones.includes(id));
    const reachedCosmetics = resolveEndlessCosmeticUnlocks(last);
    const newCosmetics = reachedCosmetics.filter((id) => !current.cosmetics.includes(id));
    const versionTop = last.score > 0
        ? [...(current.topByRuleVersion[last.ruleVersion] || []), { ...last }]
            .sort(sortByScoreDesc).slice(0, ENDLESS_PARCOURS_TOP_RUNS)
        : (current.topByRuleVersion[last.ruleVersion] || []).slice();
    const isNewDistance = last.distanceMeters > current.bestDistance.distanceMeters;
    return {
        records: {
            schemaVersion: ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION,
            best: last.score > current.best.score ? { ...last } : { ...current.best },
            bestDistance: isNewDistance ? { ...last } : { ...current.bestDistance },
            last,
            top,
            bestByRuleVersion: {
                ...current.bestByRuleVersion,
                [last.ruleVersion]: isNewRecord ? { ...last } : { ...versionBest },
            },
            topByRuleVersion: { ...current.topByRuleVersion, [last.ruleVersion]: versionTop },
            processedSettlementIds: current.processedSettlementIds.slice(),
            cosmetics: [...current.cosmetics, ...newCosmetics],
            milestones: [...current.milestones, ...newMilestones],
        },
        isNewRecord,
        newMilestones,
        newCosmetics,
    };
}

/**
 * @param {unknown} id
 * @returns {string}
 */
export function resolveEndlessMilestoneLabel(id) {
    return MILESTONE_LABEL_BY_ID.get(text(id)) || '';
}

/**
 * Eine Zeile fuer das Arcade-Menue: Bestwert, weiteste Strecke, Top-Liste und
 * Meilenstein-Stand. Ohne diese Zusammenfassung waere der Fortschritt zwar
 * gespeichert, aber unsichtbar.
 *
 * @param {unknown} records
 * @returns {string}
 */
export function summarizeEndlessRecordsLine(records) {
    const normalized = normalizeEndlessParcoursRecords(records);
    if (normalized.best.score <= 0 && normalized.top.length === 0) {
        return 'Endlosjagd: noch kein Lauf gewertet';
    }
    const topScores = normalized.top.map((entry) => Math.round(entry.score)).join(' / ');
    return `Endlosjagd: Bestwert ${Math.round(normalized.best.score)} Punkte`
        + ` | weiteste Strecke ${Math.round(normalized.bestDistance.distanceMeters)} m`
        + ` | Top ${normalized.top.length}: ${topScores || '-'}`
        + ` | Meilensteine ${normalized.milestones.length}/${ENDLESS_PARCOURS_MILESTONES.length}`;
}
