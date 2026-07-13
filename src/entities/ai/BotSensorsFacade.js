import { AI_SENSE_PHASE_WINDOW } from './perception/AiPerceptionConfig.js';

function normalizeSensePhaseCounter(value) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export class BotSensorsFacade {
    constructor(sensors) {
        this.sensors = sensors || null;
        this.runtimeBot = null;
    }

    bindRuntime(bot) {
        this.runtimeBot = bot || this.runtimeBot;
        this.sensors?.bindRuntime?.(bot);
        return this;
    }

    get sense() {
        return this.sensors?.sense;
    }

    get state() {
        return this.runtimeBot?.state || this.sensors?.state || null;
    }

    get profile() {
        return this.runtimeBot?.profile || this.sensors?.profile || null;
    }

    get _probes() {
        return this.sensors?._probes || [];
    }

    get _tmpForward() {
        return this.sensors?._tmpForward;
    }

    get _tmpRight() {
        return this.sensors?._tmpRight;
    }

    get _tmpUp() {
        return this.sensors?._tmpUp;
    }

    get _tmpVec() {
        return this.sensors?._tmpVec;
    }

    get _tmpVec2() {
        return this.sensors?._tmpVec2;
    }

    get _tmpVec3() {
        return this.sensors?._tmpVec3;
    }

    get _probeRayCenter() {
        return this.sensors?._probeRayCenter;
    }

    get _probeRayLeft() {
        return this.sensors?._probeRayLeft;
    }

    get _probeRayRight() {
        return this.sensors?._probeRayRight;
    }

    get _recentBouncePressure() {
        if (this.runtimeBot && Number.isFinite(this.runtimeBot._recentBouncePressure)) {
            return this.runtimeBot._recentBouncePressure;
        }
        return Number(this.sensors?._recentBouncePressure) || 0;
    }

    get sensePhase() {
        return this.sensors?._sensePhase || 0;
    }

    get sensePhaseCounter() {
        return this.sensors?._sensePhaseCounter || 0;
    }

    setSensePhaseCounter(value) {
        if (!this.sensors) return;
        this.sensors._sensePhaseCounter = normalizeSensePhaseCounter(value);
    }

    incrementSensePhaseCounter() {
        this.setSensePhaseCounter((this.sensePhaseCounter + 1) % AI_SENSE_PHASE_WINDOW);
    }

    clearCollisionCache() {
        this.sensors?._collisionCache?.clear?.();
    }

    mapBehavior(arena) {
        return this.sensors?._mapBehavior(arena) || { caution: 0, portalBias: 0, aggressionBias: 0 };
    }

    computeDynamicLookAhead(player) {
        return this.sensors?._computeDynamicLookAhead(player) || 8;
    }

    _buildBasis(forward) {
        this.sensors?._buildBasis(forward);
    }

    composeProbeDirection(forward, right, up, probe) {
        this.sensors?._composeProbeDirection(forward, right, up, probe);
    }

    scoreProbe(player, arena, allPlayers, probe, lookAhead) {
        this.sensors?._scoreProbe(player, arena, allPlayers, probe, lookAhead);
    }

    checkTrailHit(position, player, allPlayers, radius = player.hitboxRadius * 1.6, skipRecent = 20) {
        return !!this.sensors?._checkTrailHit(position, player, allPlayers, radius, skipRecent);
    }

    senseProjectiles(player, projectiles) {
        this.sensors?._senseProjectiles(player, projectiles);
    }

    senseHeight(player, arena) {
        this.sensors?._senseHeight(player, arena);
    }

    senseBotSpacing(player, allPlayers) {
        this.sensors?._senseBotSpacing(player, allPlayers);
    }

    evaluatePursuit(player) {
        this.sensors?._evaluatePursuit(player);
    }

    evaluatePortalIntent(player, arena, allPlayers) {
        this.sensors?._evaluatePortalIntent(player, arena, allPlayers);
    }

    setSensePhase(phase) {
        this.sensors?.setSensePhase?.(phase);
    }

    getSensorSnapshot() {
        return this.sensors?.getSnapshot?.() || null;
    }

    getSensorArray() {
        return this.sensors?.getSensorArray?.() || [];
    }
}
