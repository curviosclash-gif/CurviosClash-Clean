import { getBotValidationMatrix, resolveBotValidationScenario } from './BotValidationMatrix.js';

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
        const nextModePath = scenario.gameMode === 'HUNT' ? 'fight' : 'normal';

        if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
            game.settings.localSettings = {};
        }
        if (!game.settings.gameplay) game.settings.gameplay = {};
        if (!game.settings.hunt || typeof game.settings.hunt !== 'object') {
            game.settings.hunt = {};
        }

        game.settings.localSettings.sessionType = nextSessionType;
        game.settings.localSettings.modePath = nextModePath;
        game.settings.mode = scenario.mode === '2p' ? '2p' : '1p';
        game.settings.numBots = scenario.bots;
        game.settings.mapKey = scenario.mapKey;
        game.settings.gameMode = scenario.gameMode === 'HUNT' ? 'HUNT' : 'CLASSIC';
        game.settings.botPolicyStrategy = String(scenario.botPolicyStrategy || 'auto');
        game.settings.gameplay.planarMode = !!scenario.planarMode;
        game.settings.gameplay.portalCount = scenario.portalCount;
        game.settings.portalsEnabled = scenario.portalCount > 0;
        game.settings.hunt.respawnEnabled = scenario.gameMode === 'HUNT';
        game.settings.winsNeeded = Math.max(1, game.settings.winsNeeded);
        if (typeof game._onSettingsChanged === 'function') {
            game._onSettingsChanged();
        }
        return scenario;
    }
}
