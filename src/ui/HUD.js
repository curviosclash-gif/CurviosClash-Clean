/* ============================================
   HUD.js - Fighter Jet Head-Up Display
   ============================================ */
import * as THREE from 'three';
import { GAMEPLAY_CAMERA_MODE_ID, resolveGameplayCameraModeId } from '../shared/contracts/CameraModeContract.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export class HUD {
    constructor(elementId, playerIndex, options = {}) {
        this.container = document.getElementById(elementId);
        this.playerIndex = playerIndex;
        this.configSource = options?.configSource || null;
        this.ports = options?.ports || null;
        this._getCamera = typeof options?.getCamera === 'function'
            ? options.getCamera
            : () => null;

        // Elements
        this.horizon = this.container.querySelector('.hud-horizon');
        this.pitchLadder = this.container.querySelector('.hud-pitch-ladder');
        this.centerCrosshair = this.container.querySelector('.hud-center-crosshair');
        this.bankLine = this.container.querySelector('.hud-bank-line');
        this.bankAngle = this.container.querySelector('.hud-bank-angle');
        this.speedValue = this.container.querySelector('#' + (playerIndex === 0 ? 'p1' : 'p2') + '-hud-speed');
        this.altValue = this.container.querySelector('#' + (playerIndex === 0 ? 'p1' : 'p2') + '-hud-alt');
        this.headingValue = this.container.querySelector('#' + (playerIndex === 0 ? 'p1' : 'p2') + '-hud-heading');
        this.lockReticle = this.container.querySelector('.hud-lock-reticle');
        this.lockDist = this.lockReticle.querySelector('.lock-dist');
        this.boostFill = document.getElementById((playerIndex === 0 ? 'p1' : 'p2') + '-hud-boost-fill');
        this.lifeBar = document.getElementById((playerIndex === 0 ? 'p1' : 'p2') + '-hud-life-bar');
        this.lifeFill = document.getElementById((playerIndex === 0 ? 'p1' : 'p2') + '-hud-life-fill');

        // Tapes (Scales)
        this.speedScale = this.container.querySelector('#' + (playerIndex === 0 ? 'p1' : 'p2') + '-hud-speed-scale');
        this.altScale = this.container.querySelector('#' + (playerIndex === 0 ? 'p1' : 'p2') + '-hud-alt-scale');
        this.headingScale = this.container.querySelector('#' + (playerIndex === 0 ? 'p1' : 'p2') + '-hud-heading-scale');

        this._createPitchLadder();
        this._createTapeScales();

        this.visible = false;

        // Temp vectors/objects
        this._vec = new THREE.Vector3();
        this._euler = new THREE.Euler();
        this._quat = new THREE.Quaternion();
        this._playerPosition = new THREE.Vector3();
        this._targetPosition = new THREE.Vector3();
    }

    _setStyle(element, property, value) {
        if (!element) return;
        if (element.style[property] !== value) {
            element.style[property] = value;
        }
    }

    _setText(element, value) {
        if (!element) return;
        if (element.textContent !== value) {
            element.textContent = value;
        }
    }

    _setClassFlag(element, className, enabled) {
        if (!element) return;
        const hasClass = element.classList.contains(className);
        if (hasClass !== enabled) {
            element.classList.toggle(className, enabled);
        }
    }

    _createPitchLadder() {
        for (let i = -18; i <= 18; i++) {
            if (i === 0) continue;
            const deg = i * 5;
            const line = document.createElement('div');
            line.className = 'pitch-line';
            line.dataset.deg = deg;
            line.style.top = `${-deg * 8}px`;
            line.style.width = `${120 - Math.abs(deg) * 0.5}px`;
            if (deg < 0) {
                line.style.borderTopStyle = 'dashed';
            }
            this.pitchLadder.appendChild(line);
        }
    }

    _createTapeScales() {
        this._fillScale(this.speedScale, 0, 100, 10, 20);
        this._fillScale(this.altScale, 0, 200, 10, 20);

        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        for (let i = 0; i <= 360; i += 15) {
            const tick = document.createElement('div');
            tick.style.position = 'absolute';
            tick.style.left = `${i * 4}px`;
            tick.style.height = i % 90 === 0 ? '10px' : '5px';
            tick.style.borderLeft = '1px solid #0f0';
            tick.style.bottom = '0';

            if (i % 45 === 0) {
                const label = document.createElement('div');
                label.textContent = dirs[(i / 45) % 8];
                label.style.position = 'absolute';
                label.style.left = '-10px';
                label.style.top = '-15px';
                label.style.fontSize = '10px';
                tick.appendChild(label);
            }
            this.headingScale.appendChild(tick);
        }
    }

    _fillScale(container, min, max, step, pxPerStep) {
        for (let v = min; v <= max; v += step) {
            const tick = document.createElement('div');
            tick.style.position = 'absolute';
            tick.style.top = `${-(v * (pxPerStep / step))}px`;
            tick.style.right = '0';
            tick.style.width = '8px';
            tick.style.borderTop = '1px solid #0f0';

            if (v % (step * 2) === 0) {
                const label = document.createElement('div');
                label.textContent = v;
                label.style.position = 'absolute';
                label.style.right = '12px';
                label.style.top = '-6px';
                label.style.fontSize = '9px';
                tick.appendChild(label);
            }
            container.appendChild(tick);
        }
    }

    setVisibility(visible) {
        if (this.visible !== visible) {
            this.visible = visible;
            if (visible) {
                this.container.classList.remove('hidden');
            } else {
                this.container.classList.add('hidden');
            }
        }
    }

    update(player, _dt, context = {}) {
        if (!player || !player.alive) {
            this.setVisibility(false);
            return;
        }

        const fallbackGameplayConfig = resolveGameplayConfig({
            config: this.configSource,
            entityRuntimeConfig: player?.entityRuntimeConfig || null,
        });
        const boostCapacity = Math.max(
            0.001,
            Number(player?.boostCapacity) || Number(fallbackGameplayConfig.PLAYER?.BOOST_DURATION) || 1
        );
        const boostCharge = Math.max(0, Math.min(boostCapacity, Number(player?.boostCharge) || 0));
        const isBoostRecharging = typeof player?.boostRecharging === 'boolean'
            ? player.boostRecharging
            : (!player?.manualBoostActive && boostCharge < (boostCapacity - 0.001));
        const planarMode = typeof player?.planarMode === 'boolean'
            ? player.planarMode
            : fallbackGameplayConfig.GAMEPLAY?.PLANAR_MODE === true;
        const cameraModeId = String(
            player?.cameraModeId
            || fallbackGameplayConfig.CAMERA?.MODES?.[player?.cameraMode]
            || resolveGameplayCameraModeId(fallbackGameplayConfig)
            || GAMEPLAY_CAMERA_MODE_ID
        ).trim() || GAMEPLAY_CAMERA_MODE_ID;

        if (this.boostFill) {
            const pct = (boostCharge / boostCapacity) * 100;
            this._setStyle(this.boostFill, 'width', `${pct.toFixed(1)}%`);
            this._setClassFlag(this.boostFill, 'cooldown', isBoostRecharging);
        }

        if (this.lifeBar && this.lifeFill) {
            const maxHp = Math.max(1, Number(player?.maxHp) || 1);
            const hp = Math.max(0, Number(player?.hp) || 0);
            const showLifeBar = maxHp > 1;
            this._setClassFlag(this.lifeBar, 'hidden', !showLifeBar);
            if (showLifeBar) {
                const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
                this._setStyle(this.lifeFill, 'width', `${pct.toFixed(1)}%`);
            } else {
                this._setStyle(this.lifeFill, 'width', '0%');
            }
        }

        if (cameraModeId !== GAMEPLAY_CAMERA_MODE_ID) {
            this.setVisibility(false);
            return;
        }

        this.setVisibility(true);

        this._quat.set(
            toFiniteNumber(player?.quaternion?.x, 0),
            toFiniteNumber(player?.quaternion?.y, 0),
            toFiniteNumber(player?.quaternion?.z, 0),
            toFiniteNumber(player?.quaternion?.w, 1)
        );
        if (this._quat.lengthSq() <= 0.000001) this._quat.identity();
        else this._quat.normalize();
        this._euler.setFromQuaternion(this._quat, 'YXZ');
        const pitchDeg = THREE.MathUtils.radToDeg(this._euler.x);
        const yawDeg = THREE.MathUtils.radToDeg(this._euler.y);
        const rollDeg = THREE.MathUtils.radToDeg(this._euler.z);

        this._setStyle(this.horizon, 'transform', 'translate(-50%, -50%)');
        this._setStyle(this.pitchLadder, 'transform', `translate(-50%, -50%) translateY(${pitchDeg * 8}px)`);

        if (this.bankLine) {
            this._setStyle(this.bankLine, 'transform', `translate(-50%, -50%) rotate(${rollDeg}deg)`);
        }
        if (this.bankAngle) {
            const rollInt = Math.round(rollDeg);
            const sign = rollInt > 0 ? '+' : '';
            this._setText(this.bankAngle, `${sign}${rollInt} deg`);
        }

        if (this.centerCrosshair) {
            this._setClassFlag(this.centerCrosshair, 'hidden', planarMode);
        }

        const speed = Math.round((Number(player?.speed) || 0) * 10);
        const alt = Math.round(Number(player?.position?.y) || 0);

        this._setText(this.speedValue, String(speed));
        this._setText(this.altValue, String(alt));
        this._setStyle(this.speedScale, 'transform', `translateY(0) translateY(${speed * 2}px)`);
        this._setStyle(this.altScale, 'transform', `translateY(0) translateY(${alt * 2}px)`);

        let heading = -yawDeg;
        if (heading < 0) heading += 360;
        heading = heading % 360;
        const headingInt = Math.round(heading);

        this._setText(this.headingValue, headingInt.toString().padStart(3, '0'));
        this._setStyle(this.headingScale, 'transform', `translateX(-50%) translateX(${-heading * 4}px)`);

        const lockTarget = context?.lockTarget || null;
        if (lockTarget && lockTarget.alive) {
            this._setClassFlag(this.lockReticle, 'hidden', false);
            this._playerPosition.set(
                Number(player?.position?.x) || 0,
                Number(player?.position?.y) || 0,
                Number(player?.position?.z) || 0,
            );
            this._targetPosition.set(
                Number(lockTarget?.position?.x) || 0,
                Number(lockTarget?.position?.y) || 0,
                Number(lockTarget?.position?.z) || 0,
            );
            const dist = Math.round(this._playerPosition.distanceTo(this._targetPosition));
            this._setText(this.lockDist, `${dist}m`);

            const camera = typeof context?.getCamera === 'function'
                ? context.getCamera(this.playerIndex)
                : this._getCamera(this.playerIndex);
            if (camera) {
                this._vec.copy(this._targetPosition);
                this._vec.project(camera);

                const x = (this._vec.x * 0.5 + 0.5) * this.container.clientWidth;
                const y = (-(this._vec.y * 0.5) + 0.5) * this.container.clientHeight;

                if (this._vec.z < 1) {
                    this._setStyle(this.lockReticle, 'left', `${x}px`);
                    this._setStyle(this.lockReticle, 'top', `${y}px`);
                } else {
                    this._setClassFlag(this.lockReticle, 'hidden', true);
                }
            }
        } else {
            this._setClassFlag(this.lockReticle, 'hidden', true);
        }
    }
}
