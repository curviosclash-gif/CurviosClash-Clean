import * as THREE from 'three';
import { GAME_STATE_IDS, normalizeGameStateId } from '../shared/contracts/GameStateIds.js';
import {
    getLastRoundRecordingMetrics,
    recordMatchEndTelemetry,
    recordRoundEndTelemetry,
} from './MatchFlowTransitionHotspots.js';

function normalizeTelemetryString(value, fallback = 'unknown') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function resolveRoundTelemetryWinnerLabel(players, roundMetrics) {
    if (!roundMetrics) return 'Unbekannt';
    const winnerIndex = Number(roundMetrics.winnerIndex);
    if (!Number.isFinite(winnerIndex) || winnerIndex < 0) return 'Unentschieden';
    const winner = Array.isArray(players)
        ? players.find((player) => Number(player?.index) === winnerIndex)
        : null;
    if (!winner) {
        return roundMetrics.winnerIsBot ? `Bot ${winnerIndex + 1}` : `Spieler ${winnerIndex + 1}`;
    }
    return winner.isBot ? `Bot ${winner.index + 1}` : `Spieler ${winner.index + 1}`;
}

export class MatchFlowTelemetryController {
    constructor(deps = {}) {
        this.matchFlowUiController = deps.matchFlowUiController || null;
        this.runtime = deps.runtime || deps.game || this.matchFlowUiController?.game || null;
        this.runtimePort = deps.runtimePort || this.matchFlowUiController?.runtimePort || null;
        this._damageDir = new THREE.Vector3();
        this._damageForward = new THREE.Vector3();
        this._damageRight = new THREE.Vector3();
        this._damageWorldUp = new THREE.Vector3(0, 1, 0);
        this._huntDamageIndicatorSequence = 0;
    }

    get game() {
        return this.runtime;
    }

    bindHuntEventHandlers(sessionOrchestrator) {
        sessionOrchestrator?.bindHuntEventHandlers?.({
            onHuntFeedEvent: (entry) => this.pushHuntFeedEntry(entry),
            onHuntDamageEvent: (event) => this.handleHuntDamageEvent(event),
        });
    }

    _resolveDamageIndicatorAngle(target, event) {
        if (!target) return 0;

        if (event?.sourcePlayer?.position) {
            this._damageDir.subVectors(event.sourcePlayer.position, target.position);
        } else if (event?.hitNormal) {
            this._damageDir.copy(event.hitNormal).multiplyScalar(-1);
        } else {
            target.getDirection(this._damageDir).multiplyScalar(-1);
        }

        if (this._damageDir.lengthSq() <= 0.000001) {
            return 0;
        }
        this._damageDir.normalize();

        target.getDirection(this._damageForward).normalize();
        this._damageRight.crossVectors(this._damageWorldUp, this._damageForward);
        if (this._damageRight.lengthSq() <= 0.000001) {
            this._damageRight.set(1, 0, 0);
        } else {
            this._damageRight.normalize();
        }

        const forwardDot = THREE.MathUtils.clamp(this._damageForward.dot(this._damageDir), -1, 1);
        const sideDot = THREE.MathUtils.clamp(this._damageRight.dot(this._damageDir), -1, 1);
        return THREE.MathUtils.radToDeg(Math.atan2(sideDot, forwardDot));
    }

    handleHuntDamageEvent(event) {
        const game = this.game;
        if (!game.huntState) return;

        if (game.screenShake?.triggerForDamage) {
            game.screenShake.triggerForDamage(event);
        }

        const target = event?.target;
        if (!target || target.isBot || !target.alive) return;

        const humans = game.entityManager?.getHumanPlayers ? game.entityManager.getHumanPlayers() : [];
        if (!humans.includes(target)) return;

        const damageResult = event?.damageResult || {};
        const applied = Math.max(0, Number(damageResult.applied) || 0);
        const absorbed = Math.max(0, Number(damageResult.absorbedByShield) || 0);
        const hpApplied = Math.max(0, Number(damageResult.hpApplied) || (applied - absorbed));
        const damageValue = hpApplied + absorbed;
        if (damageValue <= 0) return;

        const intensity = THREE.MathUtils.clamp(0.2 + damageValue / 60, 0.2, 1.0);
        const durationSeconds = THREE.MathUtils.clamp(0.35 + intensity * 0.55, 0.35, 0.95);
        this._huntDamageIndicatorSequence += 1;
        const nextIndicator = {
            angleDeg: this._resolveDamageIndicatorAngle(target, event),
            intensity,
            expiresAtMs: Date.now() + Math.round(durationSeconds * 1000),
            remainingMs: Math.round(durationSeconds * 1000),
            sequence: this._huntDamageIndicatorSequence,
        };
        if (!game.huntState.damageIndicatorsByPlayer || typeof game.huntState.damageIndicatorsByPlayer !== 'object') {
            game.huntState.damageIndicatorsByPlayer = {};
        }
        game.huntState.damageIndicatorsByPlayer[target.index] = nextIndicator;
        if (target.index === 0) {
            game.huntState.damageIndicator = nextIndicator;
        }
    }

    pushHuntFeedEntry(entry) {
        const game = this.game;
        if (!game.huntState) return;
        if (!Array.isArray(game.huntState.killFeed)) game.huntState.killFeed = [];
        game.huntState.killFeed.unshift(String(entry));
        if (game.huntState.killFeed.length > 5) {
            game.huntState.killFeed.length = 5;
        }
    }

    buildRoundEndTelemetryPayload(roundEndPlan) {
        const game = this.game;
        const roundMetrics = getLastRoundRecordingMetrics(this.runtimePort, game, roundEndPlan);
        if (!roundMetrics) return null;

        const itemUseModeSource = roundMetrics.itemUseModeCounts && typeof roundMetrics.itemUseModeCounts === 'object'
            ? roundMetrics.itemUseModeCounts
            : {};
        const itemUseByMode = {
            use: Math.max(0, Number(itemUseModeSource.use) || 0),
            shoot: Math.max(0, Number(itemUseModeSource.shoot) || 0),
            mg: Math.max(0, Number(itemUseModeSource.mg) || 0),
            other: Math.max(0, Number(itemUseModeSource.other) || 0),
        };
        const itemUseTypeSource = roundMetrics.itemUseTypeCounts && typeof roundMetrics.itemUseTypeCounts === 'object'
            ? roundMetrics.itemUseTypeCounts
            : {};
        const itemUseByType = {};
        Object.entries(itemUseTypeSource).forEach(([itemType, count]) => {
            const normalizedType = String(itemType || '').trim().toUpperCase();
            if (!normalizedType) return;
            itemUseByType[normalizedType] = Math.max(0, Number(count) || 0);
        });

        return {
            mapKey: normalizeTelemetryString(game?.arena?.currentMapKey || game?.mapKey, 'standard'),
            mode: normalizeTelemetryString(game?.activeGameMode || game?.runtimeConfig?.session?.activeGameMode, 'classic').toLowerCase(),
            state: normalizeGameStateId(roundEndPlan?.outcome?.state, GAME_STATE_IDS.ROUND_END),
            reason: normalizeTelemetryString(roundEndPlan?.outcome?.reason, 'ELIMINATION'),
            winnerType: roundMetrics.winnerIndex < 0
                ? 'draw'
                : (roundMetrics.winnerIsBot ? 'bot' : 'human'),
            winnerLabel: resolveRoundTelemetryWinnerLabel(game?.entityManager?.players, roundMetrics),
            duration: Math.max(0, Number(roundMetrics.duration) || 0),
            selfCollisions: Math.max(0, Number(roundMetrics.selfCollisions) || 0),
            itemUses: Math.max(0, Number(roundMetrics.itemUseEvents) || 0),
            itemUse: {
                total: Math.max(0, Number(roundMetrics.itemUseEvents) || 0),
                byMode: itemUseByMode,
                byType: itemUseByType,
            },
            mgHits: Math.max(0, Number(roundMetrics.mgHits) || 0),
            rocketHits: Math.max(0, Number(roundMetrics.rocketHits) || 0),
            shieldAbsorb: Math.max(0, Number(roundMetrics.shieldAbsorb) || 0),
            hpDamage: Math.max(0, Number(roundMetrics.hpDamage) || 0),
            stuckEvents: Math.max(0, Number(roundMetrics.stuckEvents) || 0),
            parcoursCompleted: roundMetrics.parcoursCompleted === true,
            parcoursRouteId: normalizeTelemetryString(roundMetrics.parcoursRouteId, ''),
            parcoursCompletionTimeMs: Math.max(0, Number(roundMetrics.parcoursCompletionTimeMs) || 0),
            parcoursCheckpointCount: Math.max(0, Number(roundMetrics.parcoursCheckpointCount) || 0),
        };
    }

    recordRoundEndTelemetry(roundEndPlan) {
        const telemetryPayload = this.buildRoundEndTelemetryPayload(roundEndPlan);
        if (!telemetryPayload) return;
        recordRoundEndTelemetry(this.runtimePort, this.game, telemetryPayload);
        if (telemetryPayload.state === GAME_STATE_IDS.MATCH_END) {
            recordMatchEndTelemetry(this.runtimePort, this.game, telemetryPayload);
        }
    }
}
