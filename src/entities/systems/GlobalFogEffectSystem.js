import {
    GLOBAL_FOG_EFFECT_DURATION_SECONDS,
    createGlobalFogEffectState,
    isWithinGlobalFogRange,
    resolveGlobalFogMapRange,
} from '../../shared/contracts/GlobalFogEffectContract.js';

export class GlobalFogEffectSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.remainingSeconds = 0;
        this.visibilityRange = 0;
        this.active = false;
        this.networkReplica = false;
        this._visiblePlayersByObserver = new WeakMap();
        this._visiblePowerupsByObserver = new WeakMap();
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    activate() {
        if (this.networkReplica) return false;
        this.visibilityRange = this._resolveMapVisibilityRange();
        this.remainingSeconds += GLOBAL_FOG_EFFECT_DURATION_SECONDS;
        this._setActive(true);
        return true;
    }

    update(dt) {
        if (!this.active) return;
        this.remainingSeconds = Math.max(0, this.remainingSeconds - Math.max(0, Number(dt) || 0));
        if (this.remainingSeconds <= 0) {
            this.remainingSeconds = 0;
            this._setActive(false);
        }
    }

    applyNetworkSnapshot(value = null) {
        const state = createGlobalFogEffectState(value);
        this.remainingSeconds = state.remainingSeconds;
        this.visibilityRange = state.active
            ? (state.visibilityRange > 0 ? state.visibilityRange : this._resolveMapVisibilityRange())
            : 0;
        this._setActive(state.active);
        return this.getState();
    }

    reset() {
        this.remainingSeconds = 0;
        this.visibilityRange = 0;
        this._setActive(false);
        this._visiblePlayersByObserver = new WeakMap();
        this._visiblePowerupsByObserver = new WeakMap();
    }

    _setActive(active) {
        const nextActive = active === true && this.remainingSeconds > 0;
        if (this.active === nextActive) return;
        this.active = nextActive;
        this.entityManager?.renderer?.setGlobalFogEffect?.(this.getState());
    }

    getState() {
        return {
            active: this.active,
            remainingSeconds: this.active ? Math.max(0, this.remainingSeconds) : 0,
            visibilityRange: this.active ? Math.max(0, this.visibilityRange) : 0,
        };
    }

    _resolveMapVisibilityRange() {
        return resolveGlobalFogMapRange(
            this.entityManager?.arena?.currentMapDefinition?.lighting
        ).far;
    }

    getVisibilityRange() {
        if (!this.active) return Infinity;
        if (!(this.visibilityRange > 0)) this.visibilityRange = this._resolveMapVisibilityRange();
        return Math.max(0, this.visibilityRange);
    }

    isPositionVisible(observerPosition, targetPosition) {
        return !this.active || isWithinGlobalFogRange(
            observerPosition,
            targetPosition,
            this.getVisibilityRange()
        );
    }

    filterVisiblePlayers(observer, players) {
        if (!this.active || !observer || !Array.isArray(players)) return players;
        let visible = this._visiblePlayersByObserver.get(observer);
        if (!visible) {
            visible = [];
            this._visiblePlayersByObserver.set(observer, visible);
        }
        visible.length = 0;
        for (let i = 0; i < players.length; i += 1) {
            const candidate = players[i];
            if (candidate === observer || this.isPositionVisible(observer.position, candidate?.position)) {
                visible.push(candidate);
            }
        }
        return visible;
    }

    filterVisiblePowerups(observer, powerups) {
        if (!this.active || !observer || !Array.isArray(powerups)) return powerups;
        let visible = this._visiblePowerupsByObserver.get(observer);
        if (!visible) {
            visible = [];
            this._visiblePowerupsByObserver.set(observer, visible);
        }
        visible.length = 0;
        for (let i = 0; i < powerups.length; i += 1) {
            const item = powerups[i];
            const position = item?.mesh?.position || item?.position || null;
            if (this.isPositionVisible(observer.position, position)) visible.push(item);
        }
        return visible;
    }
}
