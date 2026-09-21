import { parseGameplayActionResultLog } from '../../shared/contracts/GameplayActionResultContract.js';
import {
    cloneRoundMetricsSummary,
    createAggregateSummary,
    createItemUseModeCounts,
} from './RoundMetricsSummaryOps.js';

const ITEM_USE_MODES = Object.freeze(['use', 'shoot', 'mg', 'other']);
const GAMEPLAY_RESULT_EVENTS = Object.freeze(['ITEM_USE', 'ITEM_PICKUP', 'ITEM_SPAWN', 'ITEM_HIT', 'PORTAL_USE', 'GATE_TRIGGER']);
const FAILED_ITEM_ACTION_CODE_PREFIXES = Object.freeze(['item.use.', 'item.shoot.', 'mg.shoot.']);

function normalizeItemUseMode(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return ITEM_USE_MODES.includes(normalized) ? normalized : 'other';
}

function normalizeItemUseType(value) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return normalized || 'UNKNOWN';
}

function parseItemUseEventData(value) {
    const parsed = parseGameplayActionResultLog(value);
    return {
        mode: normalizeItemUseMode(parsed.mode),
        type: normalizeItemUseType(parsed.type),
        code: typeof parsed.code === 'string' && parsed.code ? parsed.code : 'unknown',
        ok: parsed.ok === true,
    };
}

function createCodeCounts() {
    return {};
}

function mergeMetricCounts(target, source) {
    for (const [key, value] of Object.entries(source || {})) target[key] = (target[key] || 0) + Math.max(0, Number(value) || 0);
}

function normalizeActionCode(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized || 'unknown';
}

function isFailedItemActionCode(code) {
    if (!code || code === 'unknown') return false;
    if (!FAILED_ITEM_ACTION_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) return false;
    return !code.endsWith('.success');
}

function resolveDamageSplit(damageResult = {}) {
    const applied = Math.max(0, Number(damageResult?.applied) || 0);
    const absorbedByShield = Math.max(0, Number(damageResult?.absorbedByShield) || 0);
    const hpApplied = Math.max(0, Number(damageResult?.hpApplied) || (applied - absorbedByShield));
    return { hpApplied, absorbedByShield };
}

function isRocketType(value) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return normalized.startsWith('ROCKET_');
}

function createRoundSummary() {
    return {
        roundId: 0,
        duration: 0,
        winnerIndex: -1,
        winnerIsBot: false,
        reason: '',
        botCount: 0,
        humanCount: 0,
        botSurvivalAverage: 0,
        botSurvivalSeconds: [],
        botDeathSurvivalSeconds: [],
        botDeathCauseCounts: {},
        selfCollisions: 0,
        stuckEvents: 0,
        bounceWallEvents: 0,
        bounceTrailEvents: 0,
        itemUseEvents: 0,
        itemUseModeCounts: createItemUseModeCounts(),
        itemUseTypeCounts: {},
        itemSpawnTypeCounts: {},
        itemPickupTypeCounts: {},
        itemPickupRejectedTypeCounts: {},
        itemHitTypeCounts: {},
        itemDamageByType: {},
        actionResultCodeCounts: {},
        failedItemActions: 0,
        failedItemActionModeCounts: createItemUseModeCounts(),
        failedItemActionCodeCounts: {},
        mgHits: 0,
        rocketHits: 0,
        shieldAbsorb: 0,
        hpDamage: 0,
        turretEventCounts: {},
        stuckPerMinute: 0,
        parcoursCompleted: false,
        parcoursRouteId: '',
        parcoursCompletionTimeMs: 0,
        parcoursCheckpointCount: 0,
    };
}

export class RoundMetricsStore {
    constructor({ maxRounds = 120, maxTrackedPlayers = 16, timeProvider = null } = {}) {
        this.maxRounds = Math.max(1, Number(maxRounds) || 120);
        this.maxTrackedPlayers = Math.max(1, Number(maxTrackedPlayers) || 16);
        this.timeProvider = typeof timeProvider === 'function' ? timeProvider : (() => 0);

        this.roundSummaries = new Array(this.maxRounds);
        for (let i = 0; i < this.maxRounds; i++) {
            this.roundSummaries[i] = createRoundSummary();
        }
        this.roundSummaryIndex = 0;
        this.roundSummaryCount = 0;
        this._roundIdCounter = 0;

        this.playerSpawnTime = new Float32Array(this.maxTrackedPlayers);
        this.playerDeathTime = new Float32Array(this.maxTrackedPlayers);
        this.playerIsBot = new Uint8Array(this.maxTrackedPlayers);
        this.playerSeen = new Uint8Array(this.maxTrackedPlayers);
        this.playerDeathCause = new Array(this.maxTrackedPlayers).fill('');

        this._aggregate = createAggregateSummary();
        this._lastRoundSummary = null;
        this._resetRoundState();
    }

    _elapsedSeconds() {
        return this.timeProvider();
    }

    _resetRoundState() {
        this._roundSelfCollisions = 0;
        this._roundStuckEvents = 0;
        this._roundBounceWallEvents = 0;
        this._roundBounceTrailEvents = 0;
        this._roundItemUseEvents = 0;
        this._roundItemUseModeCounts = createItemUseModeCounts();
        this._roundItemUseTypeCounts = {};
        this._roundItemSpawnTypeCounts = {};
        this._roundItemPickupTypeCounts = {};
        this._roundItemPickupRejectedTypeCounts = {};
        this._roundItemHitTypeCounts = {};
        this._roundItemDamageByType = {};
        this._roundActionResultCodeCounts = createCodeCounts();
        this._roundFailedItemActions = 0;
        this._roundFailedItemActionModeCounts = createItemUseModeCounts();
        this._roundFailedItemActionCodeCounts = createCodeCounts();
        this._roundMgHits = 0;
        this._roundRocketHits = 0;
        this._roundShieldAbsorb = 0;
        this._roundHpDamage = 0;
        this._roundTurretEventCounts = {};
        this._roundBotDeathSurvivalSeconds = [];
        this._roundBotDeathCauseCounts = {};
        for (let i = 0; i < this.maxTrackedPlayers; i++) {
            this.playerSpawnTime[i] = -1;
            this.playerDeathTime[i] = -1;
            this.playerIsBot[i] = 0;
            this.playerSeen[i] = 0;
            this.playerDeathCause[i] = '';
        }
    }

    _trackPlayer(player, resetForSpawn = false) {
        if (!player || player.index < 0 || player.index >= this.maxTrackedPlayers) return;
        const idx = player.index;
        this.playerSeen[idx] = 1;
        this.playerIsBot[idx] = player.isBot ? 1 : 0;
        if (resetForSpawn) {
            this.playerSpawnTime[idx] = this._elapsedSeconds();
        } else if (this.playerSpawnTime[idx] < 0) {
            this.playerSpawnTime[idx] = this._elapsedSeconds();
        }
        if (resetForSpawn) {
            this.playerDeathTime[idx] = -1;
            this.playerDeathCause[idx] = '';
        }
    }

    startMatch() {
        this._aggregate = createAggregateSummary();
    }

    startRound(players = []) {
        this._resetRoundState();
        this._lastRoundSummary = null;
        if (Array.isArray(players)) {
            for (let i = 0; i < players.length; i++) {
                this._trackPlayer(players[i], true);
            }
        }
    }

    registerEventType(type, data = '') {
        const isItemUseEvent = type === 'ITEM_USE';
        let parsedItemUse = null;
        if (type === 'STUCK') this._roundStuckEvents++;
        if (type === 'BOUNCE_WALL') this._roundBounceWallEvents++;
        if (type === 'BOUNCE_TRAIL') this._roundBounceTrailEvents++;
        if (typeof type === 'string' && type.startsWith('TURRET_')) {
            this._roundTurretEventCounts[type] = (this._roundTurretEventCounts[type] || 0) + 1;
        }
        if (GAMEPLAY_RESULT_EVENTS.includes(type)) {
            parsedItemUse = parseItemUseEventData(data);
            const codeKey = normalizeActionCode(parsedItemUse.code);
            this._roundActionResultCodeCounts[codeKey] = (this._roundActionResultCodeCounts[codeKey] || 0) + 1;
        }
        if (isItemUseEvent) {
            this._roundItemUseEvents++;
            const itemUse = parsedItemUse || parseItemUseEventData(data);
            const modeKey = normalizeItemUseMode(itemUse.mode);
            this._roundItemUseModeCounts[modeKey] += 1;
            const typeKey = normalizeItemUseType(itemUse.type);
            this._roundItemUseTypeCounts[typeKey] = (this._roundItemUseTypeCounts[typeKey] || 0) + 1;
            const codeKey = normalizeActionCode(itemUse.code);
            if (isFailedItemActionCode(codeKey)) {
                this._roundFailedItemActions += 1;
                this._roundFailedItemActionModeCounts[modeKey] += 1;
                this._roundFailedItemActionCodeCounts[codeKey] = (this._roundFailedItemActionCodeCounts[codeKey] || 0) + 1;
            }
        }
        if (type === 'ITEM_SPAWN' && parsedItemUse?.ok) {
            const typeKey = normalizeItemUseType(parsedItemUse.type);
            this._roundItemSpawnTypeCounts[typeKey] = (this._roundItemSpawnTypeCounts[typeKey] || 0) + 1;
        }
        if (type === 'ITEM_PICKUP') {
            const typeKey = normalizeItemUseType(parsedItemUse?.type);
            const target = parsedItemUse?.ok
                ? this._roundItemPickupTypeCounts
                : this._roundItemPickupRejectedTypeCounts;
            target[typeKey] = (target[typeKey] || 0) + 1;
        }
        if (type === 'ITEM_HIT' && parsedItemUse?.ok) {
            const typeKey = normalizeItemUseType(parsedItemUse.type);
            this._roundItemHitTypeCounts[typeKey] = (this._roundItemHitTypeCounts[typeKey] || 0) + 1;
        }
    }

    registerDamageEvent(event = null) {
        if (!event || typeof event !== 'object') return;
        const damageSplit = resolveDamageSplit(event?.damageResult);
        const totalDamage = damageSplit.hpApplied + damageSplit.absorbedByShield;
        if (totalDamage <= 0) return;

        this._roundHpDamage += damageSplit.hpApplied;
        this._roundShieldAbsorb += damageSplit.absorbedByShield;

        const cause = typeof event?.cause === 'string' ? event.cause.trim().toUpperCase() : '';
        const projectileType = typeof event?.projectileType === 'string' ? event.projectileType.trim().toUpperCase() : '';
        if (cause === 'MG_BULLET') {
            this._roundMgHits += 1;
        }
        if (isRocketType(cause) || isRocketType(projectileType)) {
            this._roundRocketHits += 1;
        }
        const damageType = normalizeItemUseType(projectileType || cause);
        this._roundItemDamageByType[damageType] = (this._roundItemDamageByType[damageType] || 0) + totalDamage;
    }

    markPlayerSpawn(player) {
        this._trackPlayer(player, true);
    }

    markPlayerDeath(player, cause = '') {
        if (!player || player.index < 0 || player.index >= this.maxTrackedPlayers) return;
        const idx = player.index;
        if (this.playerSpawnTime[idx] < 0) {
            this.playerSpawnTime[idx] = 0;
        }
        if (this.playerDeathTime[idx] < 0) {
            this.playerDeathTime[idx] = this._elapsedSeconds();
            this.playerDeathCause[idx] = normalizeItemUseType(cause);
            if (player.isBot) {
                const spawnTime = this.playerSpawnTime[idx] >= 0 ? this.playerSpawnTime[idx] : 0;
                this._roundBotDeathSurvivalSeconds.push(Math.max(0, this.playerDeathTime[idx] - spawnTime));
                const deathCause = this.playerDeathCause[idx];
                this._roundBotDeathCauseCounts[deathCause] = (this._roundBotDeathCauseCounts[deathCause] || 0) + 1;
            }
        }
        if (normalizeItemUseType(cause) === 'TRAIL_SELF') {
            this._roundSelfCollisions++;
        }
    }

    finalizeRound(winner, players = [], options = {}) {
        const sourceOptions = options && typeof options === 'object' ? options : {};
        const reason = typeof sourceOptions.reason === 'string' ? sourceOptions.reason.trim() : '';
        const parcours = sourceOptions.parcours && typeof sourceOptions.parcours === 'object'
            ? sourceOptions.parcours
            : null;
        const parcoursRouteId = typeof parcours?.routeId === 'string' ? parcours.routeId : '';
        const parcoursCompletionTimeMs = Math.max(0, Number(parcours?.completionTimeMs) || 0);
        const parcoursCheckpointCount = Math.max(0, Math.trunc(Number(parcours?.checkpointCount) || 0));
        const parcoursCompleted = reason === 'PARCOURS_COMPLETE'
            || parcoursCompletionTimeMs > 0
            || (typeof parcours?.completedAtMs === 'number' && Number.isFinite(parcours.completedAtMs));

        const roundDuration = Math.max(0, this._elapsedSeconds());
        let botCount = 0;
        let humanCount = 0;
        let botSurvivalSum = 0;
        const botSurvivalSeconds = [];
        const botDeathCauseCounts = { ...this._roundBotDeathCauseCounts };

        if (Array.isArray(players)) {
            for (let i = 0; i < players.length; i++) {
                const p = players[i];
                if (!p || p.index < 0 || p.index >= this.maxTrackedPlayers) continue;
                this._trackPlayer(p, false);
                const idx = p.index;
                if (this.playerDeathTime[idx] < 0) {
                    this.playerDeathTime[idx] = roundDuration;
                }
                const spawnTime = this.playerSpawnTime[idx] >= 0 ? this.playerSpawnTime[idx] : 0;
                const survival = Math.max(0, this.playerDeathTime[idx] - spawnTime);
                if (p.isBot) {
                    botCount++;
                    botSurvivalSum += survival;
                    botSurvivalSeconds.push(survival);
                } else {
                    humanCount++;
                }
            }
        }

        const round = this.roundSummaries[this.roundSummaryIndex];
        this._roundIdCounter++;
        round.roundId = this._roundIdCounter;
        round.duration = roundDuration;
        round.winnerIndex = winner ? winner.index : -1;
        round.winnerIsBot = !!winner?.isBot;
        round.reason = reason || (winner ? 'ELIMINATION' : '');
        round.botCount = botCount;
        round.humanCount = humanCount;
        round.botSurvivalAverage = botCount > 0 ? botSurvivalSum / botCount : 0;
        round.botSurvivalSeconds = botSurvivalSeconds;
        round.botDeathSurvivalSeconds = [...this._roundBotDeathSurvivalSeconds];
        round.botDeathCauseCounts = botDeathCauseCounts;
        round.selfCollisions = this._roundSelfCollisions;
        round.stuckEvents = this._roundStuckEvents;
        round.bounceWallEvents = this._roundBounceWallEvents;
        round.bounceTrailEvents = this._roundBounceTrailEvents;
        round.itemUseEvents = this._roundItemUseEvents;
        round.itemUseModeCounts = { ...this._roundItemUseModeCounts };
        round.itemUseTypeCounts = { ...this._roundItemUseTypeCounts };
        round.itemSpawnTypeCounts = { ...this._roundItemSpawnTypeCounts };
        round.itemPickupTypeCounts = { ...this._roundItemPickupTypeCounts };
        round.itemPickupRejectedTypeCounts = { ...this._roundItemPickupRejectedTypeCounts };
        round.itemHitTypeCounts = { ...this._roundItemHitTypeCounts };
        round.itemDamageByType = { ...this._roundItemDamageByType };
        round.actionResultCodeCounts = { ...this._roundActionResultCodeCounts };
        round.failedItemActions = this._roundFailedItemActions;
        round.failedItemActionModeCounts = { ...this._roundFailedItemActionModeCounts };
        round.failedItemActionCodeCounts = { ...this._roundFailedItemActionCodeCounts };
        round.mgHits = this._roundMgHits;
        round.rocketHits = this._roundRocketHits;
        round.shieldAbsorb = this._roundShieldAbsorb;
        round.hpDamage = this._roundHpDamage;
        round.turretEventCounts = { ...this._roundTurretEventCounts };
        round.stuckPerMinute = roundDuration > 0 ? this._roundStuckEvents / (roundDuration / 60) : 0;
        round.parcoursCompleted = parcoursCompleted;
        round.parcoursRouteId = parcoursRouteId;
        round.parcoursCompletionTimeMs = parcoursCompletionTimeMs;
        round.parcoursCheckpointCount = parcoursCheckpointCount;

        this.roundSummaryIndex = (this.roundSummaryIndex + 1) % this.maxRounds;
        if (this.roundSummaryCount < this.maxRounds) this.roundSummaryCount++;

        this._aggregate.rounds += 1;
        this._aggregate.totalDuration += roundDuration;
        this._aggregate.totalBotLives += botCount;
        this._aggregate.totalBotSurvival += botSurvivalSum;
        for (const [deathCause, count] of Object.entries(botDeathCauseCounts)) {
            this._aggregate.totalBotDeathCauseCounts[deathCause] = (this._aggregate.totalBotDeathCauseCounts[deathCause] || 0)
                + Math.max(0, Number(count) || 0);
        }
        this._aggregate.totalSelfCollisions += this._roundSelfCollisions;
        this._aggregate.totalStuckEvents += this._roundStuckEvents;
        this._aggregate.totalBounceWallEvents += this._roundBounceWallEvents;
        this._aggregate.totalBounceTrailEvents += this._roundBounceTrailEvents;
        this._aggregate.totalItemUseEvents += this._roundItemUseEvents;
        for (const mode of ITEM_USE_MODES) {
            this._aggregate.totalItemUseModeCounts[mode] += Math.max(0, Number(this._roundItemUseModeCounts[mode]) || 0);
        }
        for (const [itemType, useCount] of Object.entries(this._roundItemUseTypeCounts)) {
            this._aggregate.totalItemUseTypeCounts[itemType] = (this._aggregate.totalItemUseTypeCounts[itemType] || 0)
                + Math.max(0, Number(useCount) || 0);
        }
        mergeMetricCounts(this._aggregate.totalItemSpawnTypeCounts, this._roundItemSpawnTypeCounts);
        mergeMetricCounts(this._aggregate.totalItemPickupTypeCounts, this._roundItemPickupTypeCounts);
        mergeMetricCounts(this._aggregate.totalItemPickupRejectedTypeCounts, this._roundItemPickupRejectedTypeCounts);
        mergeMetricCounts(this._aggregate.totalItemHitTypeCounts, this._roundItemHitTypeCounts);
        mergeMetricCounts(this._aggregate.totalItemDamageByType, this._roundItemDamageByType);
        for (const [code, useCount] of Object.entries(this._roundActionResultCodeCounts)) {
            this._aggregate.totalActionResultCodeCounts[code] = (this._aggregate.totalActionResultCodeCounts[code] || 0)
                + Math.max(0, Number(useCount) || 0);
        }
        this._aggregate.totalFailedItemActions += this._roundFailedItemActions;
        for (const mode of ITEM_USE_MODES) {
            this._aggregate.totalFailedItemActionModeCounts[mode] += Math.max(0, Number(this._roundFailedItemActionModeCounts[mode]) || 0);
        }
        for (const [code, useCount] of Object.entries(this._roundFailedItemActionCodeCounts)) {
            this._aggregate.totalFailedItemActionCodeCounts[code] = (this._aggregate.totalFailedItemActionCodeCounts[code] || 0)
                + Math.max(0, Number(useCount) || 0);
        }
        this._aggregate.totalMgHits += this._roundMgHits;
        this._aggregate.totalRocketHits += this._roundRocketHits;
        this._aggregate.totalShieldAbsorb += this._roundShieldAbsorb;
        this._aggregate.totalHpDamage += this._roundHpDamage;
        for (const [eventType, eventCount] of Object.entries(this._roundTurretEventCounts)) {
            this._aggregate.totalTurretEventCounts[eventType] = (
                this._aggregate.totalTurretEventCounts[eventType] || 0
            ) + eventCount;
        }
        if (winner?.isBot) this._aggregate.botWins += 1;
        if (parcoursCompleted) {
            this._aggregate.parcoursCompletions += 1;
            this._aggregate.totalParcoursCompletionTimeMs += parcoursCompletionTimeMs;
        }

        this._lastRoundSummary = cloneRoundMetricsSummary(round);

        return this._lastRoundSummary;
    }

    getLastRoundMetrics() {
        return this._lastRoundSummary ? { ...this._lastRoundSummary } : null;
    }

    getAggregateMetrics() {
        const rounds = this._aggregate.rounds;
        const totalDuration = this._aggregate.totalDuration;
        return {
            rounds,
            totalDuration,
            totalSelfCollisions: this._aggregate.totalSelfCollisions,
            botWinRate: rounds > 0 ? this._aggregate.botWins / rounds : 0,
            averageBotSurvival: this._aggregate.totalBotLives > 0
                ? this._aggregate.totalBotSurvival / this._aggregate.totalBotLives
                : 0,
            botDeathCauseTotals: { ...this._aggregate.totalBotDeathCauseCounts },
            selfCollisionsPerRound: rounds > 0 ? this._aggregate.totalSelfCollisions / rounds : 0,
            stuckEventsPerMinute: totalDuration > 0 ? this._aggregate.totalStuckEvents / (totalDuration / 60) : 0,
            bounceWallPerRound: rounds > 0 ? this._aggregate.totalBounceWallEvents / rounds : 0,
            bounceTrailPerRound: rounds > 0 ? this._aggregate.totalBounceTrailEvents / rounds : 0,
            itemUsePerRound: rounds > 0 ? this._aggregate.totalItemUseEvents / rounds : 0,
            // MG-Schuesse sind Dauerfeuer und liegen drei Groessenordnungen ueber
            // allen anderen Item-Einsaetzen. In der Summe ueberdecken sie jede
            // Aussage zur Item-Nutzung, deshalb steht daneben der MG-freie Wert.
            itemUseWithoutMgPerRound: rounds > 0
                ? Math.max(0, this._aggregate.totalItemUseEvents - this._aggregate.totalItemUseModeCounts.mg) / rounds
                : 0,
            failedItemActionsPerRound: rounds > 0 ? this._aggregate.totalFailedItemActions / rounds : 0,
            itemUseFailureRate: this._aggregate.totalItemUseEvents > 0
                ? this._aggregate.totalFailedItemActions / this._aggregate.totalItemUseEvents
                : 0,
            itemUseModePerRound: {
                use: rounds > 0 ? this._aggregate.totalItemUseModeCounts.use / rounds : 0,
                shoot: rounds > 0 ? this._aggregate.totalItemUseModeCounts.shoot / rounds : 0,
                mg: rounds > 0 ? this._aggregate.totalItemUseModeCounts.mg / rounds : 0,
                other: rounds > 0 ? this._aggregate.totalItemUseModeCounts.other / rounds : 0,
            },
            itemUseTypeTotals: { ...this._aggregate.totalItemUseTypeCounts },
            itemSpawnTypeTotals: { ...this._aggregate.totalItemSpawnTypeCounts },
            itemPickupTypeTotals: { ...this._aggregate.totalItemPickupTypeCounts },
            itemPickupRejectedTypeTotals: { ...this._aggregate.totalItemPickupRejectedTypeCounts },
            itemHitTypeTotals: { ...this._aggregate.totalItemHitTypeCounts },
            itemDamageByTypeTotals: { ...this._aggregate.totalItemDamageByType },
            actionResultCodeTotals: { ...this._aggregate.totalActionResultCodeCounts },
            failedItemActionModePerRound: {
                use: rounds > 0 ? this._aggregate.totalFailedItemActionModeCounts.use / rounds : 0,
                shoot: rounds > 0 ? this._aggregate.totalFailedItemActionModeCounts.shoot / rounds : 0,
                mg: rounds > 0 ? this._aggregate.totalFailedItemActionModeCounts.mg / rounds : 0,
                other: rounds > 0 ? this._aggregate.totalFailedItemActionModeCounts.other / rounds : 0,
            },
            failedItemActionCodeTotals: { ...this._aggregate.totalFailedItemActionCodeCounts },
            mgHitsPerRound: rounds > 0 ? this._aggregate.totalMgHits / rounds : 0,
            rocketHitsPerRound: rounds > 0 ? this._aggregate.totalRocketHits / rounds : 0,
            hpDamagePerRound: rounds > 0 ? this._aggregate.totalHpDamage / rounds : 0,
            shieldAbsorbPerRound: rounds > 0 ? this._aggregate.totalShieldAbsorb / rounds : 0,
            turretEventTotals: { ...this._aggregate.totalTurretEventCounts },
            parcoursCompletionRate: rounds > 0 ? this._aggregate.parcoursCompletions / rounds : 0,
            averageParcoursCompletionTimeMs: this._aggregate.parcoursCompletions > 0
                ? this._aggregate.totalParcoursCompletionTimeMs / this._aggregate.parcoursCompletions
                : 0,
        };
    }

    getAggregateTotals() {
        return { ...this._aggregate };
    }

    getActiveSurvivalObservation(players = []) {
        const observationSeconds = Math.max(0, this._elapsedSeconds());
        const censoredBotSurvivalSeconds = [];
        let aliveAtObservationEnd = 0;
        for (const player of Array.isArray(players) ? players : []) {
            if (!player?.isBot || player.alive === false) continue;
            aliveAtObservationEnd += 1;
            const spawnTime = player.index >= 0 && player.index < this.maxTrackedPlayers
                && this.playerSpawnTime[player.index] >= 0
                ? this.playerSpawnTime[player.index]
                : 0;
            censoredBotSurvivalSeconds.push(Math.max(0, observationSeconds - spawnTime));
        }
        return {
            observationSeconds,
            botDeathSurvivalSeconds: [...this._roundBotDeathSurvivalSeconds],
            botDeathCauseCounts: { ...this._roundBotDeathCauseCounts },
            censoredBotSurvivalSeconds,
            aliveAtObservationEnd,
        };
    }

    getRoundSummaries(limit = null) {
        const count = this.roundSummaryCount;
        if (count <= 0) return [];

        let max = count;
        if (Number.isFinite(limit)) {
            max = Math.max(0, Math.min(count, Number(limit)));
        }

        const items = [];
        const startIdx = count >= this.maxRounds ? this.roundSummaryIndex : 0;
        const offset = count - max;
        for (let i = 0; i < max; i++) {
            const idx = (startIdx + offset + i) % this.maxRounds;
            const round = this.roundSummaries[idx];
            items.push(cloneRoundMetricsSummary(round));
        }
        return items;
    }

    resetAggregateMetrics() {
        this._aggregate = createAggregateSummary();
        this.roundSummaryIndex = 0;
        this.roundSummaryCount = 0;
        this._roundIdCounter = 0;
        this._lastRoundSummary = null;
    }
}
