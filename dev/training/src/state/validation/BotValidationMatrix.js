import { getTrainingBenchmarkBotValidationMatrix } from '../training/TrainingBenchmarkContract.js';
import { BOT_VALIDATION_TARGETS } from './BotValidationOutcomeSemantics.js';

function cloneScenario(entry) {
    const requestedMode = String(entry.gameMode || '').trim().toUpperCase();
    const normalizedMode = requestedMode === 'HUNT' || requestedMode === 'ARCADE' ? requestedMode : 'CLASSIC';
    const rawStrategy = String(entry.botPolicyStrategy || '').trim().toLowerCase();
    const strategy = rawStrategy || 'auto';
    return {
        id: String(entry.id || ''),
        mode: entry.mode === '2p' ? '2p' : '1p',
        bots: Math.max(0, Math.trunc(Number(entry.bots) || 0)),
        mapKey: String(entry.mapKey || 'standard'),
        gameMode: normalizedMode,
        botPolicyStrategy: strategy,
        planarMode: !!entry.planarMode,
        portalCount: Math.max(0, Math.trunc(Number(entry.portalCount) || 0)),
        respawnEnabled: normalizedMode === 'HUNT' && entry.respawnEnabled !== false,
        deathmatchKillLimit: Math.max(1, Math.trunc(Number(entry.deathmatchKillLimit) || 1)),
        validationTarget: Object.values(BOT_VALIDATION_TARGETS).includes(entry.validationTarget)
            ? entry.validationTarget
            : BOT_VALIDATION_TARGETS.ROUND,
        observationSeconds: Math.max(1, Number(entry.observationSeconds) || 40),
        fightPlayerHp: Math.max(80, Math.min(250, Number(entry.fightPlayerHp) || 100)),
        fightMgDamage: Math.max(4, Math.min(20, Number(entry.fightMgDamage) || 7.75)),
        mgTrailAimRadius: Math.max(0.2, Math.min(6, Number(entry.mgTrailAimRadius) || 0.78)),
        rounds: Math.max(1, Math.trunc(Number(entry.rounds) || 1)),
        expectedPolicyType: String(entry.expectedPolicyType || '').trim().toLowerCase(),
        botDifficulty: ['EASY', 'NORMAL', 'HARD'].includes(String(entry.botDifficulty || '').trim().toUpperCase())
            ? String(entry.botDifficulty).trim().toUpperCase()
            : 'NORMAL',
        heuristicProfile: ['defensive', 'balanced', 'aggressive'].includes(String(entry.heuristicProfile || '').trim().toLowerCase())
            ? String(entry.heuristicProfile).trim().toLowerCase()
            : 'balanced',
        seedBase: Number.isFinite(Number(entry.seedBase))
            ? Math.max(0, Math.trunc(Number(entry.seedBase)))
            : 1337,
    };
}

function normalizeScenarioIds(ids) {
    const source = Array.isArray(ids) ? ids : String(ids || '').split(',');
    const normalized = [];
    const seen = new Set();
    for (const value of source) {
        const id = String(value || '').trim().toUpperCase();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        normalized.push(id);
    }
    return normalized;
}

function normalizePolicyFilter(policy) {
    const normalized = String(policy || '').trim().toLowerCase();
    return normalized === '*' || normalized === 'all' ? '' : normalized;
}

export function getBotValidationMatrix() {
    const heuristicScenarios = [
        {
            id: 'H-CLASSIC',
            mode: '1p',
            bots: 2,
            mapKey: 'standard',
            gameMode: 'CLASSIC',
            botPolicyStrategy: 'heuristic',
            planarMode: false,
            portalCount: 0,
            rounds: 4,
            expectedPolicyType: 'heuristic',
            botDifficulty: 'NORMAL',
            heuristicProfile: 'balanced',
        },
        {
            id: 'H-FIGHT',
            mode: '1p',
            bots: 2,
            mapKey: 'standard',
            gameMode: 'HUNT',
            botPolicyStrategy: 'heuristic',
            planarMode: false,
            portalCount: 4,
            respawnEnabled: true,
            deathmatchKillLimit: 1,
            validationTarget: BOT_VALIDATION_TARGETS.DUEL,
            fightPlayerHp: 80,
            fightMgDamage: 20,
            mgTrailAimRadius: 0.2,
            rounds: 4,
            expectedPolicyType: 'heuristic',
            botDifficulty: 'NORMAL',
            heuristicProfile: 'aggressive',
        },
        {
            id: 'H-FIGHT-DUEL',
            mode: '1p',
            bots: 2,
            mapKey: 'standard',
            gameMode: 'HUNT',
            botPolicyStrategy: 'heuristic',
            planarMode: false,
            portalCount: 4,
            respawnEnabled: true,
            deathmatchKillLimit: 1,
            validationTarget: BOT_VALIDATION_TARGETS.DUEL,
            fightPlayerHp: 80,
            fightMgDamage: 20,
            mgTrailAimRadius: 0.2,
            rounds: 4,
            expectedPolicyType: 'heuristic',
            botDifficulty: 'NORMAL',
            heuristicProfile: 'aggressive',
        },
        {
            id: 'H-FIGHT-SURVIVAL',
            mode: '1p',
            bots: 2,
            mapKey: 'standard',
            gameMode: 'HUNT',
            botPolicyStrategy: 'heuristic',
            planarMode: false,
            portalCount: 4,
            respawnEnabled: true,
            deathmatchKillLimit: 100,
            validationTarget: BOT_VALIDATION_TARGETS.SURVIVAL,
            observationSeconds: 40,
            fightPlayerHp: 80,
            fightMgDamage: 20,
            mgTrailAimRadius: 0.2,
            rounds: 4,
            expectedPolicyType: 'heuristic',
            botDifficulty: 'NORMAL',
            heuristicProfile: 'aggressive',
        },
        {
            id: 'H-ARCADE',
            mode: '1p',
            bots: 1,
            mapKey: 'arcade-default',
            gameMode: 'ARCADE',
            botPolicyStrategy: 'heuristic',
            planarMode: false,
            portalCount: 0,
            rounds: 4,
            expectedPolicyType: 'heuristic',
            botDifficulty: 'NORMAL',
            heuristicProfile: 'balanced',
        },
        {
            id: 'H-CLASSIC-2D-EASY',
            mode: '1p',
            bots: 2,
            mapKey: 'complex',
            gameMode: 'CLASSIC',
            botPolicyStrategy: 'heuristic',
            planarMode: true,
            portalCount: 0,
            rounds: 4,
            expectedPolicyType: 'heuristic',
            botDifficulty: 'EASY',
            heuristicProfile: 'defensive',
        },
        {
            id: 'H-CLASSIC-3D-HARD',
            mode: '1p',
            bots: 3,
            mapKey: 'vertical_maze',
            gameMode: 'CLASSIC',
            botPolicyStrategy: 'heuristic',
            planarMode: false,
            portalCount: 0,
            rounds: 4,
            expectedPolicyType: 'heuristic',
            botDifficulty: 'HARD',
            heuristicProfile: 'aggressive',
        },
        {
            id: 'H-FIGHT-2D-HARD',
            mode: '1p',
            bots: 3,
            mapKey: 'crossfire',
            gameMode: 'HUNT',
            botPolicyStrategy: 'heuristic',
            planarMode: true,
            portalCount: 2,
            respawnEnabled: true,
            deathmatchKillLimit: 1,
            fightPlayerHp: 80,
            fightMgDamage: 20,
            mgTrailAimRadius: 0.2,
            rounds: 4,
            expectedPolicyType: 'heuristic',
            botDifficulty: 'HARD',
            heuristicProfile: 'aggressive',
        },
        {
            id: 'H-ARCADE-VERTICAL',
            mode: '1p',
            bots: 1,
            mapKey: 'vertical_maze',
            gameMode: 'ARCADE',
            botPolicyStrategy: 'heuristic',
            planarMode: false,
            portalCount: 0,
            rounds: 4,
            expectedPolicyType: 'heuristic',
            botDifficulty: 'HARD',
            heuristicProfile: 'balanced',
        },
    ];
    return [
        ...getTrainingBenchmarkBotValidationMatrix(),
        ...heuristicScenarios,
    ].map((entry) => cloneScenario(entry));
}

export function selectBotValidationScenarios(matrix = null, options = {}) {
    const source = (Array.isArray(matrix) ? matrix : getBotValidationMatrix()).map((entry) => cloneScenario(entry));
    const requestedIds = normalizeScenarioIds(options?.ids);
    const policyFilter = normalizePolicyFilter(options?.policy);

    let selected = source;
    if (requestedIds.length > 0) {
        const byId = new Map(source.map((entry) => [String(entry.id || '').toUpperCase(), entry]));
        const missingIds = requestedIds.filter((id) => !byId.has(id));
        if (missingIds.length > 0) {
            throw new Error(`Unknown bot-validation scenario id(s): ${missingIds.join(', ')}`);
        }
        selected = requestedIds.map((id) => byId.get(id));
    }

    if (policyFilter) {
        selected = selected.filter((entry) => (
            entry.botPolicyStrategy === policyFilter
            || entry.expectedPolicyType === policyFilter
        ));
    }

    const numericLimit = Number(options?.limit);
    if (Number.isFinite(numericLimit) && numericLimit > 0) {
        selected = selected.slice(0, Math.trunc(numericLimit));
    }
    return selected.map((entry) => cloneScenario(entry));
}

export function resolveBotValidationScenario(idOrIndex = 0, matrix = null) {
    const source = Array.isArray(matrix) ? matrix : getBotValidationMatrix();
    if (source.length === 0) return null;

    if (typeof idOrIndex === 'number' && Number.isFinite(idOrIndex)) {
        const idx = Math.max(0, Math.min(source.length - 1, Math.trunc(idOrIndex)));
        return cloneScenario(source[idx]);
    }

    const id = String(idOrIndex || '').trim();
    const byId = source.find((entry) => String(entry.id || '').toUpperCase() === id.toUpperCase());
    return cloneScenario(byId || source[0]);
}
