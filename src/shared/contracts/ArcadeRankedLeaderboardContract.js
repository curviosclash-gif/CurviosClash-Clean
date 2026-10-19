import { resolveEndlessRecordScope } from './EndlessParcoursSeedContract.js';
import { resolveArcadeLevelRange } from './ArcadeHangarRulesContract.js';
import { DEFAULT_PORTAL_CHAIN_ID, normalizePortalChainId } from './PortalChainContract.js';
import { CURRENT_ARCADE_SCORE_MODEL, GAUNTLET_FREE_RULE_VERSION } from './ArcadeRunSettingsContract.js';
import { resolveHuntParcoursLeaderboardKey } from './HuntParcoursMedalRecordContract.js';
import { ENDLESS_PARCOURS_RULE_VERSION } from './EndlessParcoursWaveContract.js';
import { ARENA_WAVES_RULE_VERSION } from './ArenaWavesContract.js';

export const HUNT_PARCOURS_SCORE_MODEL = 'hunt-score.v1';

export const ARCADE_RANKED_STORAGE_KEY = 'cuviosclash.arcade-ranked-leaderboard.v1';
export const ARCADE_RANKED_VERSION = 'arcade-ranked-leaderboard.v1';
const RUNS = new Set(['gauntlet', 'endless_parcours', 'arena_waves', 'five_portals', 'hunt_parcours']);
const SCORE_RUNS = new Set(['gauntlet', 'endless_parcours', 'arena_waves']);

function scoreModelFromBoardKey(key) {
    const [runType, model] = String(key).split(':');
    if (runType === 'hunt_parcours' && /^hunt-score\.v\d+$/.test(model || '')) return model;
    return SCORE_RUNS.has(runType) && /^arcade-score\.v\d+$/.test(model || '') ? model : '';
}

export function resolveArcadeRankKey(context) {
    if (!context?.ranked || !RUNS.has(context.runType)) return '';
    const range = resolveArcadeLevelRange(context.vehicleLevel);
    if (context.runType === 'hunt_parcours') {
        const huntKey = resolveHuntParcoursLeaderboardKey({ variantId: context.huntParcoursVariantId, rivalTierGroup: context.rivalTierGroup });
        const humans = context.huntParcoursVariantId === 'fox_hunt' ? `humans-${Math.max(1, Math.min(3, Math.floor(Number(context.huntParcoursHumanCount) || 1)))}:` : '';
        return huntKey && context.scoreModel === HUNT_PARCOURS_SCORE_MODEL
            ? `hunt_parcours:${HUNT_PARCOURS_SCORE_MODEL}:${huntKey.slice('hunt_parcours:'.length)}:${humans}${context.tierId}:${range.min}-${range.max}` : '';
    }
    // Every portal chain rides five_portals; the default chain keeps the key its saved times use.
    const chainId = context.runType === 'five_portals' ? normalizePortalChainId(context.portalChainId) : DEFAULT_PORTAL_CHAIN_ID;
    const chain = chainId === DEFAULT_PORTAL_CHAIN_ID ? '' : `${chainId}:`;
    const scoreModel = SCORE_RUNS.has(context.runType) ? context.scoreModel : '';
    if (SCORE_RUNS.has(context.runType) && scoreModel !== CURRENT_ARCADE_SCORE_MODEL) return '';
    const endless = context.runType === 'endless_parcours';
    if (endless && context.endlessRuleVersion !== ENDLESS_PARCOURS_RULE_VERSION) return '';
    const endlessScope = endless ? resolveEndlessRecordScope({ vehicleId: context.vehicleId,
        ruleVersion: context.endlessRuleVersion, seedMode: context.endlessSeedMode, seed: context.endlessSeed }) : '';
    if (endless && !endlessScope) return '';
    const modelScope = endless ? `${encodeURIComponent(endlessScope)}:` : '';
    const arenaWaves = context.runType === 'arena_waves';
    if (arenaWaves && context.arenaWavesRuleVersion !== ARENA_WAVES_RULE_VERSION) return '';
    if (context.runType === 'gauntlet' && context.gauntletRuleVersion
        && context.gauntletRuleVersion !== GAUNTLET_FREE_RULE_VERSION) return '';
    const rules = endless ? `${context.endlessRuleVersion}:` : arenaWaves ? `${context.arenaWavesRuleVersion}:`
        : context.gauntletRuleVersion ? `${context.gauntletRuleVersion}:` : '';
    return `${context.runType}:${scoreModel ? `${scoreModel}:` : ''}${rules}${modelScope}${chain}${context.tierId}:${range.min}-${range.max}`;
}

export function resolveArcadeParcoursRankKey(routeId, context) {
    const route = String(routeId || '').trim();
    // Custom score settings change points, not course times: such runs still race on the level board.
    // Companions (help in flight), the Daily and unscaled runs keep the shared route board.
    if (!context?.strengthScaled || context.companions) return route;
    const range = resolveArcadeLevelRange(context.vehicleLevel);
    return `${route}:level:${range.min}-${range.max}`;
}

export function normalizeArcadeRankedLeaderboard(value) {
    const input = value?.schemaVersion === ARCADE_RANKED_VERSION ? value : {};
    const boards = Object.create(null);
    for (const [key, rows] of Object.entries(input.boards || {})) {
        if (!Array.isArray(rows)) continue;
        const scoreModel = scoreModelFromBoardKey(key);
        const [runType, , ruleVersion] = key.split(':');
        const endlessRule = runType === 'endless_parcours' && typeof ruleVersion === 'string'
            && ruleVersion.startsWith('endless-parcours-rules.')
            ? ruleVersion : '';
        const arenaRule = runType === 'arena_waves' && typeof ruleVersion === 'string'
            && ruleVersion.startsWith('arena-waves-rules.') ? ruleVersion : '';
        const gauntletRule = runType === 'gauntlet' && typeof ruleVersion === 'string'
            && ruleVersion.startsWith('gauntlet-free-rules.') ? ruleVersion : '';
        boards[key] = rows.filter((row) => row && typeof row.runId === 'string' && row.runId
            && Number.isFinite(row.score) && row.score >= 0 && Number.isFinite(row.vehicleLevel) && row.vehicleLevel >= 1)
            .filter((row) => !scoreModel || row.scoreModel === scoreModel)
            .filter((row) => !endlessRule || row.endlessRuleVersion === endlessRule)
            .filter((row) => !endlessRule || !key.split(':')[3]?.startsWith('%5B')
                || encodeURIComponent(resolveEndlessRecordScope({ ...row, ruleVersion: row.endlessRuleVersion })) === key.split(':')[3])
            .filter((row) => !arenaRule || row.arenaWavesRuleVersion === arenaRule)
            .filter((row) => !gauntletRule || row.gauntletRuleVersion === gauntletRule)
            .slice(0, 10).map((row) => ({ ...row }));
    }
    return { schemaVersion: ARCADE_RANKED_VERSION, boards };
}

export function insertArcadeRankedResult(leaderboard, context, result, nowMs = Date.now()) {
    const current = normalizeArcadeRankedLeaderboard(leaderboard);
    const key = resolveArcadeRankKey(context);
    if (!key || !context.runId || result?.aborted === true) return { leaderboard: current, rank: null, key };
    const score = Number(context.runType === 'five_portals' ? result?.totalMs : result?.score?.total ?? result?.score ?? result?.total);
    if (!Number.isFinite(score) || score < 0 || (context.runType === 'five_portals' && !(result?.succeeded === true && score > 0))) {
        return { leaderboard: current, rank: null, key };
    }
    const entry = { runId: context.runId, vehicleId: context.vehicleId, vehicleLevel: context.vehicleLevel,
        tierId: context.tierId, score, completedWaves: Number(result?.lastCompletedWave) || 0,
        completedSectors: Number(result?.completedSectors) || 0, date: new Date(nowMs).toISOString(),
        ...(SCORE_RUNS.has(context.runType) || context.runType === 'hunt_parcours' ? { scoreModel: context.scoreModel } : {}),
        ...(context.runType === 'endless_parcours' ? { endlessRuleVersion: context.endlessRuleVersion,
            seedMode: context.endlessSeedMode, seed: context.endlessSeed } : {}),
        ...(context.runType === 'arena_waves' ? { arenaWavesRuleVersion: context.arenaWavesRuleVersion } : {}),
        ...(context.gauntletRuleVersion ? { gauntletRuleVersion: context.gauntletRuleVersion } : {}) };
    const rows = (current.boards[key] || []).filter((row) => row.runId !== entry.runId);
    rows.push(entry);
    const direction = context.runType === 'five_portals' ? 1 : -1;
    rows.sort((a, b) => direction * (a.score - b.score) || a.date.localeCompare(b.date));
    const kept = rows.slice(0, 10);
    const position = kept.findIndex((row) => row.runId === entry.runId);
    return { leaderboard: { ...current, boards: { ...current.boards, [key]: kept } }, key, rank: position < 0 ? null : position + 1 };
}
