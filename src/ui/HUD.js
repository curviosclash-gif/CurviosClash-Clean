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
        this.lockBox = this.lockReticle.querySelector('.lock-box');
        this.lockArrow = document.createElement('div');
        this.lockArrow.className = 'lock-arrow hidden';
        this.lockReticle.appendChild(this.lockArrow);
        this.boostFill = document.getElementById((playerIndex === 0 ? 'p1' : 'p2') + '-hud-boost-fill');
        this.lifeBar = document.getElementById((playerIndex === 0 ? 'p1' : 'p2') + '-hud-life-bar');
        this.lifeFill = document.getElementById((playerIndex === 0 ? 'p1' : 'p2') + '-hud-life-fill');

        // Tapes (Scales)
        this.speedScale = this.container.querySelector('#' + (playerIndex === 0 ? 'p1' : 'p2') + '-hud-speed-scale');
        this.altScale = this.container.querySelector('#' + (playerIndex === 0 ? 'p1' : 'p2') + '-hud-alt-scale');
        this.headingScale = this.container.querySelector('#' + (playerIndex === 0 ? 'p1' : 'p2') + '-hud-heading-scale');

        this._tapeSpeedMax = 0;
        this._tapeAltMax = 0;

        this._createPitchLadder();
        this._createHeadingScale();
        const initialRanges = this._resolveConfiguredTapeRanges(
            resolveGameplayConfig({ config: this.configSource })
        );
        this._ensureSpeedTapeRange(initialRanges.speedMax);
        this._ensureAltTapeRange(initialRanges.altMax);

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

    // Heading ticks cover -120°..480° so the tape has no blank side near
    // the 0°/360° wrap. Tick i sits at left = i*4 px; update() shifts the
    // scale by -heading*4 px, which places tick `heading` exactly at the
    // tape center marker.
    _createHeadingScale() {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        for (let i = -120; i <= 480; i += 15) {
            const tick = document.createElement('div');
            tick.className = 'tape-tick tape-tick-heading';
            tick.style.left = `${i * 4}px`;
            tick.style.height = i % 90 === 0 ? '10px' : '5px';

            if (i % 45 === 0) {
                const label = document.createElement('div');
                label.className = 'tape-tick-label tape-tick-label-heading';
                label.textContent = dirs[(((i / 45) % 8) + 8) % 8];
                tick.appendChild(label);
            }
            this.headingScale.appendChild(tick);
        }
    }

    _resolveConfiguredTapeRanges(gameplayConfig) {
        const playerConfig = gameplayConfig?.PLAYER || {};
        const arenaConfig = gameplayConfig?.ARENA || {};
        const baseSpeed = Math.max(0, Number(playerConfig.SPEED)) || 35;
        const boostMultiplier = Math.max(1, Number(playerConfig.BOOST_MULTIPLIER)) || 1;
        // HUD speed readout is speed * 10; boost marks the upper end.
        const speedMax = Math.max(100, Math.ceil((baseSpeed * boostMultiplier * 10) / 50) * 50);
        const arenaTop = Math.max(0, Number(arenaConfig.WALL_HEIGHT) || 0)
            * Math.max(1, Number(arenaConfig.MAP_SCALE) || 1);
        const altMax = Math.max(200, Math.ceil(arenaTop / 50) * 50);
        return { speedMax, altMax };
    }

    _ensureSpeedTapeRange(speedMax) {
        const required = Math.max(100, Math.ceil(Number(speedMax) || 0));
        if (required <= this._tapeSpeedMax) return;
        this._tapeSpeedMax = required;
        this._fillScale(this.speedScale, 0, required, 10, 20);
    }

    _ensureAltTapeRange(altMax) {
        const required = Math.max(200, Math.ceil(Number(altMax) || 0));
        if (required <= this._tapeAltMax) return;
        this._tapeAltMax = required;
        this._fillScale(this.altScale, 0, required, 10, 20);
    }

    _fillScale(container, min, max, step, pxPerStep) {
        if (!container) return;
        container.replaceChildren();
        for (let v = min; v <= max; v += step) {
            const tick = document.createElement('div');
            tick.className = 'tape-tick tape-tick-vertical';
            tick.style.top = `${-(v * (pxPerStep / step))}px`;
            tick.style.width = '8px';

            if (v % (step * 2) === 0) {
                const label = document.createElement('div');
                label.className = 'tape-tick-label tape-tick-label-vertical';
                label.textContent = v;
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

        // Artificial horizon: rotate with roll and shift with pitch so the
        // horizon line and pitch ladder stay world-referenced.
        const attitudeTransform = `translate(-50%, -50%) rotate(${rollDeg}deg) translateY(${pitchDeg * 8}px) scale(var(--hud-scale, 1))`;
        this._setStyle(this.horizon, 'transform', attitudeTransform);
        this._setStyle(this.pitchLadder, 'transform', attitudeTransform);

        if (this.bankLine) {
            this._setStyle(this.bankLine, 'transform', `translate(-50%, -50%) rotate(${rollDeg}deg) scale(var(--hud-scale, 1))`);
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

        // Grow tape ranges when config or live values exceed the built scales
        // (rebuilds only on range growth, never per frame).
        const tapeRanges = this._resolveConfiguredTapeRanges(fallbackGameplayConfig);
        this._ensureSpeedTapeRange(Math.max(tapeRanges.speedMax, speed));
        this._ensureAltTapeRange(Math.max(tapeRanges.altMax, alt));

        this._setText(this.speedValue, String(speed));
        this._setText(this.altValue, String(alt));
        this._setStyle(this.speedScale, 'transform', `translateY(0) translateY(${speed * 2}px)`);
        this._setStyle(this.altScale, 'transform', `translateY(0) translateY(${alt * 2}px)`);

        let heading = -yawDeg;
        if (heading < 0) heading += 360;
        heading = heading % 360;
        // 359.5°..359.99° rounds to 360, which must display as 000.
        const headingInt = Math.round(heading) % 360;

        this._setText(this.headingValue, headingInt.toString().padStart(3, '0'));
        this._setStyle(this.headingScale, 'transform', `translateX(${-heading * 4}px)`);

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

                const width = this.container.clientWidth;
                const height = this.container.clientHeight;
                let x = (this._vec.x * 0.5 + 0.5) * width;
                let y = (-(this._vec.y * 0.5) + 0.5) * height;
                const behindCamera = this._vec.z >= 1;
                if (behindCamera) {
                    // NDC is mirrored for targets behind the camera; flip the
                    // projected point so the bearing points the right way.
                    x = width - x;
                    y = height - y;
                }

                const margin = 28;
                const offscreen = behindCamera
                    || x < margin || x > width - margin
                    || y < margin || y > height - margin;

                if (offscreen) {
                    // Clamp an arrow to the screen edge, pointing at the target.
                    const centerX = width * 0.5;
                    const centerY = height * 0.5;
                    const dx = x - centerX;
                    const dy = y - centerY;
                    let edgeX = centerX;
                    let edgeY = margin;
                    let arrowDeg = 0;
                    if (dx !== 0 || dy !== 0) {
                        let t = Infinity;
                        if (dx > 0) t = Math.min(t, (width - margin - centerX) / dx);
                        else if (dx < 0) t = Math.min(t, (margin - centerX) / dx);
                        if (dy > 0) t = Math.min(t, (height - margin - centerY) / dy);
                        else if (dy < 0) t = Math.min(t, (margin - centerY) / dy);
                        if (Number.isFinite(t)) {
                            edgeX = centerX + dx * t;
                            edgeY = centerY + dy * t;
                        }
                        arrowDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
                    }
                    this._setStyle(
                        this.lockReticle,
                        'transform',
                        `translate(${edgeX}px, ${edgeY}px) translate(-50%, -50%) scale(var(--hud-scale, 1))`
                    );
                    this._setStyle(
                        this.lockArrow,
                        'transform',
                        `translate(-50%, -50%) rotate(${arrowDeg}deg)`
                    );
                    this._setClassFlag(this.lockBox, 'hidden', true);
                    this._setClassFlag(this.lockArrow, 'hidden', false);
                } else {
                    this._setStyle(
                        this.lockReticle,
                        'transform',
                        `translate(${x}px, ${y}px) translate(-50%, -50%) scale(var(--hud-scale, 1))`
                    );
                    this._setClassFlag(this.lockBox, 'hidden', false);
                    this._setClassFlag(this.lockArrow, 'hidden', true);
                }
                this._setClassFlag(this.lockReticle, 'hidden', false);
            } else {
                this._setClassFlag(this.lockReticle, 'hidden', true);
            }
        } else {
            this._setClassFlag(this.lockReticle, 'hidden', true);
        }
    }
}
