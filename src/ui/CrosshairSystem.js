// ============================================
// CrosshairSystem.js - screen crosshair runtime
// ============================================

import * as THREE from 'three';
import { clamp } from '../shared/utils/MathOps.js';
import { GAMEPLAY_CAMERA_MODE_ID, resolveGameplayCameraModeId } from '../shared/contracts/CameraModeContract.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export class CrosshairSystem {
    constructor(deps = {}) {
        this.game = deps.game || null;
        this.ports = deps.ports || null;
        this._tmpAimVec = new THREE.Vector3();
        this._tmpAimDir = new THREE.Vector3();
        this._tmpPosition = new THREE.Vector3();
        this._tmpQuat = new THREE.Quaternion();
        this._tmpRollEuler = new THREE.Euler(0, 0, 0, 'YXZ');
        this._domStateByElement = new WeakMap();
        this._mgAimDotByCrosshair = new WeakMap();
    }

    _getMatchRuntimeProjection() {
        return this.ports?.runtimeProjectionPort?.getMatchRuntimeProjection?.() || null;
    }

    _getLocalPlayerIndex(projection = null) {
        const value = projection?.localPlayerIndex ?? this.game?.runtimeConfig?.session?.localPlayerIndex;
        return Number.isInteger(value) && value >= 0 ? value : 0;
    }

    _getDomState(crosshairElement) {
        let state = this._domStateByElement.get(crosshairElement);
        if (!state) {
            state = {
                display: null,
                left: null,
                top: null,
                transform: null,
                locked: null,
                overheat: null,
            };
            this._domStateByElement.set(crosshairElement, state);
        }
        return state;
    }

    _setCrosshairDisplay(crosshairElement, isVisible) {
        if (!crosshairElement) return;
        const state = this._getDomState(crosshairElement);
        const nextDisplay = isVisible ? 'block' : 'none';
        if (state.display !== nextDisplay || crosshairElement.style.display !== nextDisplay) {
            crosshairElement.style.display = nextDisplay;
            state.display = nextDisplay;
        }
    }

    _setCrosshairStyleValue(crosshairElement, key, nextValue) {
        if (!crosshairElement) return;
        const state = this._getDomState(crosshairElement);
        if (state[key] !== nextValue || crosshairElement.style[key] !== nextValue) {
            crosshairElement.style[key] = nextValue;
            state[key] = nextValue;
        }
    }

    _findProjectedPlayer(projection, playerIndex) {
        if (!Array.isArray(projection?.players)) return null;
        return projection.players.find((player) => player?.playerIndex === playerIndex) || null;
    }

    _findProjectedLockTarget(projection, playerIndex) {
        if (!Array.isArray(projection?.lockTargets)) return null;
        return projection.lockTargets.find((entry) => entry?.playerIndex === playerIndex) || null;
    }

    _ensureMgAimDot(crosshairElement, playerIndex) {
        if (!crosshairElement) return null;
        const cached = this._mgAimDotByCrosshair.get(crosshairElement);
        if (cached && cached.isConnected !== false) return cached;

        const container = crosshairElement.parentElement;
        const doc = crosshairElement.ownerDocument;
        if (!container?.appendChild || !doc?.createElement) return null;

        const dotId = `mg-aim-dot-p${playerIndex + 1}`;
        const existing = typeof container.querySelector === 'function'
            ? container.querySelector(`#${dotId}`)
            : null;
        const dot = existing || doc.createElement('div');
        if (!existing) {
            dot.id = dotId;
            dot.className = 'mg-aim-dot';
            dot.setAttribute?.('aria-hidden', 'true');
            Object.assign(dot.style, {
                position: 'absolute',
                width: '8px',
                height: '8px',
                display: 'none',
                borderRadius: '50%',
                background: '#ff2d2d',
                boxShadow: '0 0 3px #ffffff, 0 0 9px rgba(255, 32, 32, 0.95)',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
            });
            container.appendChild(dot);
        }
        this._mgAimDotByCrosshair.set(crosshairElement, dot);
        return dot;
    }

    _shouldShowMgAimDot(projection = null) {
        if (projection) return projection?.hunt?.active === true;
        return this.game?.entityManager?.gameModeStrategy?.hasMachineGun?.() === true;
    }

    _updateMgAimDot(player, crosshairElement, projection = null) {
        const playerIndex = player?.playerIndex ?? player?.index ?? 0;
        const dot = this._ensureMgAimDot(crosshairElement, playerIndex);
        if (!dot) return;
        if (!player?.alive || !this._shouldShowMgAimDot(projection)) {
            dot.style.display = 'none';
            return;
        }

        const camera = this.game?.renderer?.cameras?.[playerIndex];
        if (!camera) {
            dot.style.display = 'none';
            return;
        }

        const lockTarget = projection
            ? this._findProjectedLockTarget(projection, playerIndex)
            : this.game?.entityManager?.getLockOnTarget?.(playerIndex);
        const targetPosition = lockTarget?.alive !== false ? lockTarget?.position : null;
        if (targetPosition) {
            this._tmpAimVec.set(
                Number(targetPosition.x) || 0,
                Number(targetPosition.y) || 0,
                Number(targetPosition.z) || 0,
            );
        } else {
            this._tmpAimDir.set(
                Number(player?.aimDirection?.x) || 0,
                Number(player?.aimDirection?.y) || 0,
                Number.isFinite(Number(player?.aimDirection?.z)) ? Number(player.aimDirection.z) : -1,
            );
            if (this._tmpAimDir.lengthSq() <= 0.000001) this._tmpAimDir.set(0, 0, -1);
            else this._tmpAimDir.normalize();
            this._tmpPosition.set(
                Number(player?.position?.x) || 0,
                Number(player?.position?.y) || 0,
                Number(player?.position?.z) || 0,
            );
            this._tmpAimVec.copy(this._tmpPosition).addScaledVector(this._tmpAimDir, 80);
        }
        this._tmpAimVec.project(camera);

        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const localHumans = Math.max(1, Number(projection?.localHumanCount || this.game?.numHumans) || 1);
        const split = localHumans >= 2;
        const viewportW = split ? screenW * 0.5 : screenW;
        const viewportX = split ? (playerIndex === this._getLocalPlayerIndex(projection) ? 0 : viewportW) : 0;
        const x = viewportX + (clamp(this._tmpAimVec.x, -1.05, 1.05) * 0.5 + 0.5) * viewportW;
        const y = (-(clamp(this._tmpAimVec.y, -1.05, 1.05) * 0.5) + 0.5) * screenH;

        dot.style.left = `${x}px`;
        dot.style.top = `${y}px`;
        dot.style.display = 'block';
    }

    _shouldShowScreenCrosshair(player, fallbackGameplayConfig = null) {
        if (!player) return false;
        const gameplayConfig = fallbackGameplayConfig || resolveGameplayConfig(this.game);
        const cameraModeId = String(
            player?.cameraModeId
            || gameplayConfig?.CAMERA?.MODES?.[player?.cameraMode]
            || resolveGameplayCameraModeId(gameplayConfig)
            || GAMEPLAY_CAMERA_MODE_ID
        ).trim() || GAMEPLAY_CAMERA_MODE_ID;
        if (typeof player?.planarMode === 'boolean') {
            if (player.planarMode) return true;
            return cameraModeId !== GAMEPLAY_CAMERA_MODE_ID;
        }

        if (gameplayConfig.GAMEPLAY?.PLANAR_MODE === true) return true;
        return cameraModeId !== GAMEPLAY_CAMERA_MODE_ID;
    }

    _updateCrosshairPosition(player, crosshairElement, projection = null) {
        const game = this.game;
        if (!player || !player.alive || !crosshairElement) {
            this._setCrosshairDisplay(crosshairElement, false);
            return;
        }

        const camera = game?.renderer?.cameras?.[player.playerIndex ?? player.index];
        if (!camera) {
            this._setCrosshairDisplay(crosshairElement, false);
            return;
        }
        this._setCrosshairDisplay(crosshairElement, true);

        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const localHumans = Math.max(1, Number(projection?.localHumanCount || game?.numHumans) || 1);
        const split = localHumans >= 2;
        const viewportW = split ? screenW * 0.5 : screenW;
        const playerIndex = player.playerIndex ?? player.index ?? 0;
        const viewportX = split ? (playerIndex === this._getLocalPlayerIndex(projection) ? 0 : viewportW) : 0;

        this._tmpAimDir.set(
            Number(player?.aimDirection?.x) || 0,
            Number(player?.aimDirection?.y) || 0,
            Number.isFinite(Number(player?.aimDirection?.z)) ? Number(player.aimDirection.z) : -1
        );
        if (this._tmpAimDir.lengthSq() <= 0.000001) {
            this._tmpAimDir.set(0, 0, -1);
        }
        this._tmpAimDir.normalize();
        this._tmpPosition.set(
            Number(player?.position?.x) || 0,
            Number(player?.position?.y) || 0,
            Number(player?.position?.z) || 0
        );
        this._tmpAimVec.copy(this._tmpPosition).addScaledVector(this._tmpAimDir, 80).project(camera);

        const ndcX = clamp(this._tmpAimVec.x, -1.05, 1.05);
        const ndcY = clamp(this._tmpAimVec.y, -1.05, 1.05);
        const x = viewportX + (ndcX * 0.5 + 0.5) * viewportW;
        const y = (-(ndcY * 0.5) + 0.5) * screenH;

        this._tmpQuat.set(
            toFiniteNumber(player?.quaternion?.x, 0),
            toFiniteNumber(player?.quaternion?.y, 0),
            toFiniteNumber(player?.quaternion?.z, 0),
            toFiniteNumber(player?.quaternion?.w, 1)
        );
        if (this._tmpQuat.lengthSq() <= 0.000001) this._tmpQuat.identity();
        else this._tmpQuat.normalize();
        this._tmpRollEuler.setFromQuaternion(this._tmpQuat, 'YXZ');
        const rollDeg = THREE.MathUtils.radToDeg(this._tmpRollEuler.z);

        this._setCrosshairStyleValue(crosshairElement, 'left', `${x}px`);
        this._setCrosshairStyleValue(crosshairElement, 'top', `${y}px`);
        this._setCrosshairStyleValue(
            crosshairElement,
            'transform',
            `translate(-50%, -50%) rotate(${rollDeg.toFixed(2)}deg)`,
        );
    }

    _syncCrosshairLockState(playerIndex, crosshairElement, projection = null) {
        if (!crosshairElement) return;
        const lockTarget = projection
            ? this._findProjectedLockTarget(projection, playerIndex)
            : this.game?.entityManager?.getLockOnTarget?.(playerIndex);
        const state = this._getDomState(crosshairElement);
        const isLocked = !!lockTarget;
        if (state.locked !== isLocked) {
            crosshairElement.classList.toggle('locked', isLocked);
            state.locked = isLocked;
        }
    }

    _syncCrosshairOverheatState(player, crosshairElement, projection = null) {
        if (!crosshairElement || !player) return;
        const playerIndex = player?.playerIndex ?? player?.index ?? 0;
        const overheat = projection
            ? Number(projection?.hunt?.overheatByPlayer?.[playerIndex] || 0)
            : Number(this.game?.huntState?.overheatByPlayer?.[playerIndex] || 0);
        const overheatRatio = clamp(overheat / 100, 0, 1).toFixed(2);
        const state = this._getDomState(crosshairElement);
        if (state.overheat !== overheatRatio) {
            crosshairElement.style.setProperty('--crosshair-overheat', overheatRatio);
            state.overheat = overheatRatio;
        }
    }

    updateCrosshairs(runtimeProjection = null) {
        const game = this.game;
        const projection = runtimeProjection || this._getMatchRuntimeProjection();
        if (!projection && !game?.entityManager) return;

        const fallbackGameplayConfig = resolveGameplayConfig(game);
        const localStart = this._getLocalPlayerIndex(projection);
        const p1 = projection ? this._findProjectedPlayer(projection, localStart) : game.entityManager.players[localStart];
        const p2 = projection ? this._findProjectedPlayer(projection, localStart + 1) : game.entityManager.players[localStart + 1];

        if (game.ui.crosshairP1) {
            if (this._shouldShowScreenCrosshair(p1, fallbackGameplayConfig)) {
                this._updateCrosshairPosition(p1, game.ui.crosshairP1, projection);
            } else {
                this._setCrosshairDisplay(game.ui.crosshairP1, false);
            }
            this._syncCrosshairLockState(localStart, game.ui.crosshairP1, projection);
            this._syncCrosshairOverheatState(p1, game.ui.crosshairP1, projection);
            this._updateMgAimDot(p1, game.ui.crosshairP1, projection);
        }

        if (game.ui.crosshairP2) {
            const showP2 = projection
                ? projection.localHumanCount >= 2
                : Math.max(1, Number(game.runtimeConfig?.session?.localHumanCount || game.numHumans) || 1) >= 2;
            if (showP2) {
                if (this._shouldShowScreenCrosshair(p2, fallbackGameplayConfig)) {
                    this._updateCrosshairPosition(p2, game.ui.crosshairP2, projection);
                } else {
                    this._setCrosshairDisplay(game.ui.crosshairP2, false);
                }
                this._syncCrosshairLockState(localStart + 1, game.ui.crosshairP2, projection);
                this._syncCrosshairOverheatState(p2, game.ui.crosshairP2, projection);
                this._updateMgAimDot(p2, game.ui.crosshairP2, projection);
            } else {
                this._setCrosshairDisplay(game.ui.crosshairP2, false);
                const dot = this._mgAimDotByCrosshair.get(game.ui.crosshairP2);
                if (dot) dot.style.display = 'none';
            }
        }
    }
}
