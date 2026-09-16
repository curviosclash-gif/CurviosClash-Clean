import { getBotValidationMatrix, resolveBotValidationScenario } from './BotValidationMatrix.js';
import { writeHangarMapSelection } from '../../../../../src/ui/hangar/HangarSelectionWritebackContract.js';
import { buildArcadeSectorPlan, resolveArcadeSectorRuntimeProfile } from '../../../../../src/entities/directors/ArcadeEncounterCatalog.js';

function normalizeLabel(label) {
    return String(label || 'BASELINE').trim().toUpperCase() || 'BASELINE';
}

function computeDelta(current, baseline) {
    return {
        botWinRate: (current?.botWinRate || 0) - (baseline?.botWinRate || 0),
        averageBotSurvival: (current?.averageBotSurvival || 0) - (baseline?.averageBotSurvival || 0),
        selfCollisionsPerRound: (current?.selfCollisionsPerRound || 0) - (baseline?.selfCollisionsPerRound || 0),
        stuckEventsPerMinute: (current?.stuckEventsPerMinute || 0) - (baseline?.stuckEventsPerMinute || 0),
        bounceWallPerRound: (current?.bounceWallPerRound || 0) - (baseline?.bounceWallPerRound || 0),
        bounceTrailPerRound: (current?.bounceTrailPerRound || 0) - (baseline?.bounceTrailPerRound || 0),
        itemUsePerRound: (current?.itemUsePerRound || 0) - (baseline?.itemUsePerRound || 0),
    };
}

function uniqueNormalized(values, normalizer) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
        const normalized = normalizer(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function normalizePolicyType(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeGameMode(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeModePath(value) {
    return String(value || '').trim().toLowerCase();
}

function expectedModePath(gameMode) {
    if (gameMode === 'HUNT') return 'fight';
    if (gameMode === 'ARCADE') return 'arcade';
    return 'normal';
}

function expectedRuntimeGameMode(gameMode) {
    return gameMode;
}

function expectedBotCountForSample(scenario, sample, fallbackCount) {
    if (scenario.expectedRuntimeBotCountFromArcadeSeed !== true) return fallbackCount;
    const seed = Number(sample.arcadeSeed);
    if (sample.arcadeEnabled !== true || sample.arcadeSeed == null || !Number.isInteger(seed) || seed < 0) return 0;
    const firstSector = buildArcadeSectorPlan({
        seed,
        difficulty: scenario.botDifficulty,
    }).sequence?.[0];
    return resolveArcadeSectorRuntimeProfile(firstSector, {
        fallbackBotCount: scenario.bots,
        fallbackDifficulty: scenario.botDifficulty,
    }).botCount;
}

export function buildBotValidationRuntimeVerification(scenario = {}, runtimeSamples = []) {
    const samples = Array.isArray(runtimeSamples) ? runtimeSamples.filter(Boolean) : [];
    const expectedPolicyType = normalizePolicyType(scenario.expectedPolicyType);
    const expectedRuntimeBotCount = Math.max(0, Math.trunc(Number(scenario.expectedRuntimeBotCount) || 0));
    const expectedGameMode = normalizeGameMode(scenario.gameMode) || 'CLASSIC';
    const requiredModePath = expectedModePath(expectedGameMode);
    const requiredRuntimeGameMode = expectedRuntimeGameMode(expectedGameMode);
    const runtimePolicyTypes = uniqueNormalized(samples.map((sample) => sample.runtimePolicyType), normalizePolicyType);
    const entityPolicyTypes = uniqueNormalized(samples.map((sample) => sample.entityPolicyType), normalizePolicyType);
    const botPolicyTypes = uniqueNormalized(
        samples.flatMap((sample) => Array.isArray(sample.botPolicyTypes) ? sample.botPolicyTypes : []),
        normalizePolicyType
    );
    const missingBotPolicySamples = samples.filter((sample) => {
        const botCount = Math.max(0, Math.trunc(Number(sample.botCount) || 0));
        const policyCount = Array.isArray(sample.botPolicyTypes)
            ? sample.botPolicyTypes.filter((type) => !!normalizePolicyType(type)).length
            : 0;
        return botCount <= 0 || policyCount !== botCount;
    }).length;
    let missingBots = 0;
    let additionalBots = 0;
    let policylessBots = 0;
    let botCountMismatchSamples = 0;
    let botlessSamples = 0;
    const expectedBotCounts = [];
    for (const sample of samples) {
        const botCount = Math.max(0, Math.trunc(Number(sample.botCount) || 0));
        const expectedBotCount = expectedBotCountForSample(scenario, sample, expectedRuntimeBotCount);
        expectedBotCounts.push(expectedBotCount);
        const policyCount = Array.isArray(sample.botPolicyTypes)
            ? sample.botPolicyTypes.filter((type) => !!normalizePolicyType(type)).length
            : 0;
        missingBots += Math.max(0, expectedBotCount - botCount);
        additionalBots += Math.max(0, botCount - expectedBotCount);
        policylessBots += Math.max(0, botCount - policyCount);
        if (botCount !== expectedBotCount || expectedBotCount <= 0) botCountMismatchSamples += 1;
        if (botCount === 0) botlessSamples += 1;
    }
    const botCountMatches = samples.length > 0
        && expectedBotCounts.every((count) => count > 0)
        && botCountMismatchSamples === 0
        && botlessSamples === 0;
    const policyMatches = samples.length > 0
        && !!expectedPolicyType
        && runtimePolicyTypes.length === 1
        && runtimePolicyTypes[0] === expectedPolicyType
        && entityPolicyTypes.length === 1
        && entityPolicyTypes[0] === expectedPolicyType
        && botPolicyTypes.length === 1
        && botPolicyTypes[0] === expectedPolicyType
        && missingBotPolicySamples === 0;
    const decisionSnapshots = samples.flatMap((sample) => (
        Array.isArray(sample.botDecisions) ? sample.botDecisions.map((entry) => entry?.snapshot).filter(Boolean) : []
    ));
    const heuristicProfiles = uniqueNormalized(decisionSnapshots.map((snapshot) => snapshot.profile), normalizePolicyType);
    const difficultyNames = uniqueNormalized(decisionSnapshots.map((snapshot) => snapshot.difficulty), normalizePolicyType);
    const expectedHeuristicProfile = normalizePolicyType(scenario.heuristicProfile || 'balanced');
    const expectedDifficulty = normalizePolicyType(scenario.botDifficulty || 'NORMAL');
    const heuristicConfigMatches = expectedPolicyType !== 'heuristic' || (
        decisionSnapshots.length > 0
        && heuristicProfiles.length === 1
        && heuristicProfiles[0] === expectedHeuristicProfile
        && difficultyNames.length === 1
        && difficultyNames[0] === expectedDifficulty
    );

    const runtimeGameModes = uniqueNormalized(samples.map((sample) => sample.runtimeGameMode), normalizeGameMode);
    const entityGameModes = uniqueNormalized(samples.map((sample) => sample.entityGameMode), normalizeGameMode);
    const semanticGameModes = uniqueNormalized(samples.map((sample) => sample.semanticGameMode), normalizeGameMode);
    const modePaths = uniqueNormalized(samples.map((sample) => sample.modePath), normalizeModePath);
    const arcadeEnabledValues = [...new Set(samples.map((sample) => sample.arcadeEnabled === true))];
    const arcadeSeeds = uniqueNormalized(
        samples.map((sample) => sample.arcadeEnabled === true
            && sample.arcadeSeed != null
            && Number.isFinite(Number(sample.arcadeSeed))
            ? String(Math.trunc(Number(sample.arcadeSeed)))
            : ''),
        (value) => String(value || '')
    ).map((value) => Number(value));
    const expectsArcade = expectedGameMode === 'ARCADE';
    const modeMatches = samples.length > 0
        && runtimeGameModes.length === 1
        && runtimeGameModes[0] === requiredRuntimeGameMode
        && entityGameModes.length === 1
        && entityGameModes[0] === requiredRuntimeGameMode
        && semanticGameModes.length === 1
        && semanticGameModes[0] === expectedGameMode
        && modePaths.length === 1
        && modePaths[0] === requiredModePath
        && arcadeEnabledValues.length === 1
        && arcadeEnabledValues[0] === expectsArcade;

    return {
        sampleCount: samples.length,
        botCount: {
            ok: botCountMatches,
            expectedRuntimeBotCount,
            expectedBySample: expectedBotCounts,
            mismatchSamples: botCountMismatchSamples,
            missingBots,
            additionalBots,
            policylessBots,
            botlessSamples,
        },
        policy: {
            ok: policyMatches && heuristicConfigMatches,
            expectedPolicyType,
            runtimePolicyTypes,
            entityPolicyTypes,
            botPolicyTypes,
            missingBotPolicySamples,
            heuristicConfigMatches,
            expectedHeuristicProfile,
            expectedDifficulty,
            heuristicProfiles,
            difficultyNames,
        },
        mode: {
            ok: modeMatches,
            expectedGameMode,
            expectedRuntimeGameMode: requiredRuntimeGameMode,
            expectedModePath: requiredModePath,
            runtimeGameModes,
            entityGameModes,
            semanticGameModes,
            modePaths,
            arcadeEnabledValues,
            arcadeSeeds,
        },
    };
}

export class BotValidationService {
    constructor({ getRecorder = null, getMatrix = null } = {}) {
        this.getRecorder = typeof getRecorder === 'function' ? getRecorder : (() => null);
        this.getMatrix = typeof getMatrix === 'function' ? getMatrix : (() => getBotValidationMatrix());
        this._baselines = new Map();
    }

    _readAggregateMetrics() {
        const recorder = this.getRecorder();
        if (!recorder || typeof recorder.getAggregateMetrics !== 'function') return null;
        return recorder.getAggregateMetrics();
    }

    getValidationMatrix() {
        return this.getMatrix();
    }

    resolveScenario(idOrIndex = 0) {
        return resolveBotValidationScenario(idOrIndex, this.getValidationMatrix());
    }

    captureBaseline(label = 'BASELINE') {
        const normalized = normalizeLabel(label);
        const aggregate = this._readAggregateMetrics();
        if (!aggregate) return null;
        this._baselines.set(normalized, aggregate);
        return { label: normalized, ...aggregate };
    }

    compareWithBaseline(label = 'BASELINE') {
        const normalized = normalizeLabel(label);
        if (!this._baselines.has(normalized)) return null;
        const baseline = this._baselines.get(normalized);
        const current = this._readAggregateMetrics();
        if (!current) return null;
        return {
            label: normalized,
            baseline,
            current,
            delta: computeDelta(current, baseline),
        };
    }

    buildValidationReport(label = 'BASELINE') {
        const normalized = normalizeLabel(label);
        return {
            label: normalized,
            aggregate: this._readAggregateMetrics(),
            comparison: this.compareWithBaseline(normalized),
            matrix: this.getValidationMatrix(),
        };
    }

    buildTestProtocol() {
        const matrix = this.getValidationMatrix();
        return {
            steps: [
                '1) GAME_INSTANCE.debugApi.applyBotValidationScenario(0), Match starten und auf expectedPolicyType pruefen.',
                '2) GAME_INSTANCE.debugApi.captureBotBaseline("BASELINE") ausfuehren.',
                '3) Weitere Szenarien aus der Matrix durchspielen und Runtime-Policy-Type je Szenario abgleichen.',
                '4) GAME_INSTANCE.debugApi.printBotValidationReport("BASELINE") fuer KPI-Vergleich ausfuehren.',
            ],
            matrix,
        };
    }

    applyScenario(game, idOrIndex = 0) {
        const scenario = this.resolveScenario(idOrIndex);
        if (!scenario || !game?.settings) return null;

        const nextSessionType = scenario.mode === '2p' ? 'splitscreen' : 'single';
        const nextModePath = expectedModePath(scenario.gameMode);

        if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
            game.settings.localSettings = {};
        }
        if (!game.settings.gameplay) game.settings.gameplay = {};
        if (!game.settings.hunt || typeof game.settings.hunt !== 'object') {
            game.settings.hunt = {};
        }
        if (!game.settings.arcade || typeof game.settings.arcade !== 'object') {
            game.settings.arcade = {};
        }

        game.settings.localSettings.sessionType = nextSessionType;
        game.settings.localSettings.modePath = nextModePath;
        game.settings.mode = scenario.mode === '2p' ? '2p' : '1p';
        game.settings.numBots = scenario.bots;
        game.settings.mapKey = scenario.mapKey;
        game.settings.gameMode = expectedRuntimeGameMode(scenario.gameMode);
        if (nextModePath === 'arcade' || nextModePath === 'fight') {
            writeHangarMapSelection(
                game.settings,
                scenario.mapKey,
                scenario.mapKey,
                { modePath: nextModePath }
            );
        }
        game.settings.botPolicyStrategy = String(scenario.botPolicyStrategy || 'auto');
        game.settings.botDifficulty = scenario.botDifficulty || 'NORMAL';
        game.settings.botHeuristicProfile = scenario.heuristicProfile || 'balanced';
        game.settings.arcade.seed = scenario.seedBase;
        game.settings.gameplay.planarMode = !!scenario.planarMode;
        game.settings.gameplay.portalCount = scenario.portalCount;
        game.settings.portalsEnabled = scenario.portalCount > 0;
        game.settings.hunt.respawnEnabled = scenario.respawnEnabled === true;
        game.settings.hunt.deathmatchKillLimit = scenario.deathmatchKillLimit;
        if (scenario.gameMode === 'HUNT') {
            game.settings.gameplay.fightPlayerHp = scenario.fightPlayerHp;
            game.settings.gameplay.fightMgDamage = scenario.fightMgDamage;
            game.settings.gameplay.mgTrailAimRadius = scenario.mgTrailAimRadius;
        }
        game.settings.winsNeeded = Math.max(1, game.settings.winsNeeded);
        if (typeof game._onSettingsChanged === 'function') {
            game._onSettingsChanged();
        }
        return scenario;
    }
}
