// ============================================
// PlanarAimAssistSystem.js - planar aim + playing timescale helpers
// ============================================
//
// Contract:
// - Inputs: game runtime (settings/input/runtimeConfig/entityManager/gameLoop)
// - Outputs: planar aim axis and normalized player.planarAimOffset values
// - Side effects: mutates human player planarAimOffset and gameLoop timescale
// - Hotpath guardrail: no per-frame object creation in update methods

import { CONFIG } from './Config.js';
import { clamp } from '../utils/MathOps.js';
import { createRuntimeAccess } from '../shared/runtime/RuntimeAccessFactory.js';

export function createPlanarAimAssistRuntimeAccess(runtime) {
    return createRuntimeAccess(runtime, (game) => {
        const getInputDown = (code) => game?.input?.isDown?.(code) === true;
        return {
        getControls: () => game?.settings?.controls || null,
        getNumHumans: () => Number(game?.numHumans) || 0,
        getInputDown,
        // Backward-compatible alias for transitional call sites.
        isInputDown: getInputDown,
        getEntityManager: () => game?.entityManager || null,
        getGameplayConfig: () => game?.runtimeConfig?.gameplay || null,
        getGameLoop: () => game?.gameLoop || null,
        getEntityRuntimeConfig: () => game?.entityRuntimeConfig || null,
    };
    });
}

export class PlanarAimAssistSystem {
    constructor(runtimeAccess = {}) {
        this.runtimeAccess = runtimeAccess && typeof runtimeAccess === 'object'
            ? runtimeAccess
            : {};
    }

    getPlanarAimAxis(playerIndex) {
        const controls = this.runtimeAccess.getControls?.() || null;
        if (!controls) return 0;

        const p1 = controls.PLAYER_1;
        const p2 = controls.PLAYER_2;
        let up = false;
        let down = false;

        if (this.runtimeAccess.getNumHumans?.() === 1 && playerIndex === 0) {
            up = this.runtimeAccess.getInputDown?.(p1.UP) === true
                || this.runtimeAccess.getInputDown?.(p2.UP) === true;
            down = this.runtimeAccess.getInputDown?.(p1.DOWN) === true
                || this.runtimeAccess.getInputDown?.(p2.DOWN) === true;
        } else {
            const map = playerIndex === 0 ? p1 : p2;
            up = this.runtimeAccess.getInputDown?.(map.UP) === true;
            down = this.runtimeAccess.getInputDown?.(map.DOWN) === true;
        }

        return (down ? 1 : 0) - (up ? 1 : 0);
    }

    updatePlanarAimAssist(dt) {
        const entityManager = this.runtimeAccess.getEntityManager?.() || null;
        if (!entityManager) return;

        const gameplayConfig = this.runtimeAccess.getGameplayConfig?.() || null;
        const inputSpeed = gameplayConfig?.planarAimInputSpeed || CONFIG.GAMEPLAY.PLANAR_AIM_INPUT_SPEED || 1.5;
        const returnSpeed = gameplayConfig?.planarAimReturnSpeed || CONFIG.GAMEPLAY.PLANAR_AIM_RETURN_SPEED || 0.6;
        const isPlanar = gameplayConfig?.planarMode ?? !!CONFIG.GAMEPLAY.PLANAR_MODE;
        const humans = entityManager.getHumanPlayers();

        for (let i = 0; i < humans.length; i++) {
            const player = humans[i];
            const axis = isPlanar ? this.getPlanarAimAxis(player.index) : 0;
            let offset = player.planarAimOffset || 0;

            if (axis !== 0) {
                offset += axis * inputSpeed * dt;
            } else {
                const recover = 1 - Math.exp(-returnSpeed * dt);
                offset += (0 - offset) * recover;
            }

            player.planarAimOffset = clamp(offset, -1, 1);
        }
    }

    applyPlayingTimeScaleFromEffects() {
        const entityManager = this.runtimeAccess.getEntityManager?.() || null;
        const gameLoop = this.runtimeAccess.getGameLoop?.() || null;
        if (!entityManager || !gameLoop) return;

        gameLoop.setTimeScale(1.0);
        const strategy = entityManager.gameModeStrategy || null;
        const entityRuntimeConfig = this.runtimeAccess.getEntityRuntimeConfig?.() || null;
        const modeType = String(strategy?.modeType || entityRuntimeConfig?.HUNT?.ACTIVE_MODE || 'CLASSIC').trim().toUpperCase();
        if (modeType === 'HUNT') {
            return;
        }

        const players = entityManager.players;
        let slowestScale = 1.0;
        for (let p = 0; p < players.length; p++) {
            const player = players[p];
            if (player.hasSlowTime && Number.isFinite(player.slowTimeScale)) {
                slowestScale = Math.min(slowestScale, player.slowTimeScale);
            }
        }
        gameLoop.setTimeScale(slowestScale);
    }
}
