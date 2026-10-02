import { DemolitionRuntime } from '../arcade/DemolitionRuntime.js';
import { applyDemolitionComboEvent, clearDemolitionCombo, getDemolitionComboMultiplier, resetDemolitionCombo } from '../arcade/DemolitionComboOps.js';
import { isDemolitionConfig } from '../../shared/contracts/DemolitionContract.js';

export class GameRuntimeDemolitionSupport {
    constructor({
        getRuntimeConfig = null,
        getMultiplier = null,
        getRecordStoreForPlayerIndex = null,
        comboRuntime = null,
        bindGameplayCallback = null,
        requestMapTransition = null,
        requestAdvance = null,
    } = {}) {
        this._getRuntimeConfig = typeof getRuntimeConfig === 'function' ? getRuntimeConfig : () => null;
        this._bindGameplayCallback = typeof bindGameplayCallback === 'function'
            ? bindGameplayCallback
            : () => {};
        this._comboRuntime = comboRuntime;
        this.runtime = new DemolitionRuntime({
            getMultiplier: getMultiplier || (() => getDemolitionComboMultiplier(this._comboRuntime)),
            getRecordStoreForPlayerIndex,
            onComboAction: (event) => {
                if (this._comboRuntime) applyDemolitionComboEvent(this._comboRuntime, event);
            },
            requestMapTransition,
            requestAdvance,
        });
    }

    isActive() {
        return isDemolitionConfig(this._getRuntimeConfig());
    }

    handleGameplayEvent(event) {
        return this.runtime.handleGameplayEvent(event);
    }

    getState() {
        return this.runtime.getHudState();
    }

    getPreparedState() {
        return this.isActive() ? this.getState() : null;
    }

    startIfActive({ runtimeState = null, seed = undefined, vehicleId = null } = {}) {
        if (!this.isActive()) return { handled: false, state: null };
        this._bindGameplayCallback(runtimeState);
        if (this.runtime.phase === 'idle' || this.runtime.phase === 'transition') {
            if (this._comboRuntime) resetDemolitionCombo(this._comboRuntime);
        }
        return {
            handled: true,
            state: this.runtime.start({
                entityManager: runtimeState?.entityManager || null,
                seed,
                vehicleId,
                profileIds: this._getRuntimeConfig()?.arcade?.demolitionProfileIds || [],
            }),
        };
    }

    resetIfUsed(resetArcadeRun) {
        const state = this.getState();
        if (!this.isActive() && state.phase === 'idle') return { handled: false, state: null };
        if (this._comboRuntime) clearDemolitionCombo(this._comboRuntime);
        this.runtime.dispose();
        resetArcadeRun?.();
        return { handled: true, state: this.getState() };
    }

    updateIfActive(dt) {
        if (!this.isActive()) return false;
        this.runtime.update(dt);
        return true;
    }
}
