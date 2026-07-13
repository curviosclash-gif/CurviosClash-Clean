// ============================================
// TouchInputSource.js - touch/tablet input adapter
// ============================================

import { PlayerInputSource } from './PlayerInputSource.js';
import { resolveInventoryActionAvailability } from '../shared/contracts/GameplayActionAvailabilityContract.js';
import {
    MOBILE_CLASSIC_TILT_PITCH_MODES,
    normalizeMobileClassicControlSettings,
    normalizeMobileClassicTiltSensitivity,
} from '../shared/contracts/MobileClassicControlsContract.js';
import {
    applyTouchButtonVisualState,
    applyTouchControlsVisibility,
    createTouchButtonElements,
    createTouchJoystickElements,
    createTouchTiltControlElements,
    positionFloatingJoystick,
    resolveTouchButtonDefinitions,
    restoreJoystickHomePosition,
    shouldStartFloatingJoystick,
    TOUCH_CONTROL_MODES,
} from './touch/TouchControlLayoutOps.js';
import {
    clamp,
    deriveTiltSteeringState,
    TILT_DEFAULT_CURVE_EXPONENT,
    TILT_DEFAULT_DEADZONE_DEG,
    TILT_DEFAULT_RANGE_DEG,
} from './touch/TouchTiltSteeringOps.js';
import {
    resolveScreenOrientationAngle,
    TILT_CONTROL_STATES,
    TouchTiltSensorLifecycle,
} from './touch/TouchTiltSensorLifecycle.js';

import {
    resolveTiltButtonUi,
    resolveTiltStatusText,
} from './touch/TouchTiltUiOps.js';

export {
    deriveTiltSteeringState,
    resolveTiltCalibrationNeutral,
} from './touch/TouchTiltSteeringOps.js';
export {
    resolveTouchButtonDefinitions,
    TOUCH_CONTROL_MODES,
} from './touch/TouchControlLayoutOps.js';

const TILT_DEFAULT_SMOOTHING = 0.24;
const TILT_DEFAULT_RELEASE_THRESHOLD = 0.015;
const TILT_EVENT_STALE_MS = 1600;

/**
 * Virtual joystick + touch buttons for tablet/mobile play.
 * Layout:
 *   Left side: virtual joystick (pitch/yaw/throttle)
 *   Right side: action buttons (fire, use, boost, next item)
 *
 * Auto-detected via 'ontouchstart' in window.
 * Auto-show bei Touch-Geraet, Auto-hide bei Desktop (C.4).
 * Touch-Controls nur im Match sichtbar, nicht im Menue (C.4).
 */
export class TouchInputSource extends PlayerInputSource {
    constructor(options = {}) {
        super('touch');
        this._disposed = false;
        this._game = options.game || null;
        this._getRuntimeProjection = typeof options.getMatchRuntimeProjection === 'function'
            ? options.getMatchRuntimeProjection
            : null;
        this._playerIndex = Number.isInteger(options.playerIndex) ? options.playerIndex : 0;
        this._joystickRadius = options.joystickRadius || 60;
        this._controlMode = options.controlMode === TOUCH_CONTROL_MODES.TILT
            ? TOUCH_CONTROL_MODES.TILT
            : TOUCH_CONTROL_MODES.JOYSTICK;
        this._includePauseButton = options.includePauseButton === true;
        this._mobileControlSettings = normalizeMobileClassicControlSettings(options.mobileControls);
        this._tiltSensitivity = normalizeMobileClassicTiltSensitivity(
            options.tiltSensitivity ?? this._mobileControlSettings.tiltSensitivity
        );
        this._tiltPitchMode = this._mobileControlSettings.tiltPitchMode;
        this._tiltAssistMode = this._mobileControlSettings.tiltAssistMode;
        this._tiltDebugVisible = this._mobileControlSettings.tiltDebugVisible;
        this._tiltSensorHzVisible = this._mobileControlSettings.tiltSensorHzVisible;
        this._tiltDeadzoneDeg = Math.max(1, Number(options.tiltDeadzoneDeg) || TILT_DEFAULT_DEADZONE_DEG);
        this._tiltRangeDeg = Math.max(this._tiltDeadzoneDeg + 1, Number(options.tiltRangeDeg) || TILT_DEFAULT_RANGE_DEG);
        this._tiltCurveExponent = Math.max(1, Number(options.tiltCurveExponent) || TILT_DEFAULT_CURVE_EXPONENT);
        this._tiltSmoothing = clamp(Number(options.tiltSmoothing) || TILT_DEFAULT_SMOOTHING, 0, 0.95);
        this._tiltReleaseThreshold = clamp(
            Number(options.tiltReleaseThreshold) || TILT_DEFAULT_RELEASE_THRESHOLD,
            0,
            0.25
        );
        this._joystickCenter = null;
        this._joystickDelta = { x: 0, y: 0 };
        this._joystickActive = false;
        this._joystickTouchId = null;
        this._buttonTouches = new Map();
        this._tiltResolved = {
            yawAxis: 0,
            pitchAxis: 0,
        };
        this._tiltSensorLifecycle = new TouchTiltSensorLifecycle({
            isTiltMode: () => this._controlMode === TOUCH_CONTROL_MODES.TILT,
            resetResolvedAxes: () => {
                this._tiltResolved.yawAxis = 0;
                this._tiltResolved.pitchAxis = 0;
            },
            updateUi: () => this._updateTiltUi(),
        });
        this._tiltState = this._tiltSensorLifecycle.state;
        this._tiltCalibration = this._tiltSensorLifecycle.calibration;

        this._buttons = {
            fire: false,
            useItem: false,
            boost: false,
            boostPressed: false,
            nextItem: false,
            dropItem: false,
            shootMG: false,
        };
        this._prevBoost = false;
        this._prevDiscreteButtons = {
            fire: false,
            useItem: false,
            nextItem: false,
        };
        this._lastPauseRequestAt = 0;
        this._overlayActive = false;
        this._blockingOverlayObserver = null;
        this._androidBackHandler = null;
        this._previousAndroidBackHandler = null;

        this._containerEl = null;
        this._joystickEl = null;
        this._joystickKnobEl = null;
        this._tiltButtonEl = null;
        this._tiltStatusEl = null;
        this._buttonEls = {};

        this._uiVisible = false;
        this._inMatch = false;

        this._touchStartHandler = (e) => this._onTouchStart(e);
        this._touchMoveHandler = (e) => this._onTouchMove(e);
        this._touchEndHandler = (e) => this._onTouchEnd(e);
        this._tiltActivateHandler = (e) => {
            e.preventDefault();
            this.requestTiltControl().catch(() => {
                this._tiltState.permission = 'denied';
                this._updateTiltUi();
            });
        };
    }

    static isAvailable() {
        const hasTouchEvent = typeof window !== 'undefined' && 'ontouchstart' in window;
        const hasTouchPoints = typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints) > 0;
        const hasCoarsePointer = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(pointer: coarse)').matches === true;
        return hasTouchEvent || hasTouchPoints || hasCoarsePointer;
    }

    bind(playerIndex) {
        super.bind(playerIndex);
        this._playerIndex = Number.isInteger(playerIndex) ? playerIndex : 0;
    }

    createUI(container) {
        this._containerEl = container || document.getElementById('touch-controls') || document.body;
        this._containerEl.dataset.touchControlMode = this._controlMode;

        const joystick = createTouchJoystickElements({
            containerEl: this._containerEl,
            joystickRadius: this._joystickRadius,
        });
        this._joystickEl = joystick.joystickEl;
        this._joystickKnobEl = joystick.joystickKnobEl;
        this._buttonEls = createTouchButtonElements({
            containerEl: this._containerEl,
            buttonDefinitions: this._resolveButtonDefinitions(),
        });

        if (this._controlMode === TOUCH_CONTROL_MODES.TILT) {
            this._createTiltControlUI();
        }

        this._containerEl.addEventListener('touchstart', this._touchStartHandler, { passive: false });
        this._containerEl.addEventListener('touchmove', this._touchMoveHandler, { passive: false });
        this._containerEl.addEventListener('touchend', this._touchEndHandler, { passive: false });
        this._containerEl.addEventListener('touchcancel', this._touchEndHandler, { passive: false });
        this._bindBlockingOverlayObserver();
        this._registerAndroidBackHandler();

        this._setUIVisibility(false);
    }

    _resolveButtonDefinitions() {
        return resolveTouchButtonDefinitions(this._controlMode, {
            includePauseButton: this._includePauseButton,
        });
    }

    _createTiltControlUI() {
        const tiltControls = createTouchTiltControlElements({
            containerEl: this._containerEl,
            activateHandler: this._tiltActivateHandler,
        });
        this._tiltButtonEl = tiltControls.tiltButtonEl;
        this._tiltStatusEl = tiltControls.tiltStatusEl;
        this._updateTiltUi();
    }

    autoDetectAndShow() {
        if (TouchInputSource.isAvailable() && this._inMatch) {
            this._setUIVisibility(true);
        } else {
            this._setUIVisibility(false);
        }
    }

    onMatchStart() {
        this._inMatch = true;
        if (this._controlMode === TOUCH_CONTROL_MODES.TILT) {
            this._tiltSensorLifecycle.startListening({ auto: true });
        }
        this.autoDetectAndShow();
    }

    onMatchEnd() {
        this._inMatch = false;
        this._setUIVisibility(false);
    }

    _setUIVisibility(visible) {
        this._uiVisible = visible;
        this._overlayActive = this._isBlockingOverlayActive();
        applyTouchControlsVisibility({
            containerEl: this._containerEl,
            joystickEl: this._joystickEl,
            buttonEls: this._buttonEls,
            tiltButtonEl: this._tiltButtonEl,
            tiltStatusEl: this._tiltStatusEl,
            visible,
            overlayActive: this._overlayActive,
            showJoystickFallback: this._shouldShowJoystickFallback(),
        });
        this._updateTiltUi();
    }

    get isUIVisible() {
        return this._uiVisible;
    }

    _getMatchRuntimeProjection() {
        const projected = this._getRuntimeProjection?.();
        if (projected && typeof projected === 'object') {
            return projected;
        }
        return this._game?.runtimePorts?.runtimeProjectionPort?.getMatchRuntimeProjection?.() || null;
    }

    _findProjectedPlayer(projection = null) {
        if (!Array.isArray(projection?.players)) return null;
        return projection.players.find((player) => player?.playerIndex === this._playerIndex) || null;
    }

    _onTouchStart(e) {
        if (this._syncBlockingOverlayState()) {
            return;
        }
        e.preventDefault();
        for (const touch of e.changedTouches) {
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const tiltTarget = target?.closest?.('[data-tilt-action]');
            if (tiltTarget && this._tiltButtonEl?.contains(tiltTarget)) {
                this._tiltActivateHandler(e);
                continue;
            }
            if (this._isJoystickTarget(target) || this._shouldStartFloatingJoystick(touch, target)) {
                this._beginJoystickTouch(touch, { floating: !this._isJoystickTarget(target) });
            } else {
                const actionTarget = target?.closest?.('[data-action]') || target;
                const action = actionTarget?.dataset?.action;
                if (action === 'pause') {
                    this._requestPause();
                    this._buttonTouches.set(touch.identifier, action);
                    continue;
                }
                if (action && action in this._buttons) {
                    this._buttons[action] = true;
                    this._buttonTouches.set(touch.identifier, action);
                }
            }
        }
    }

    _onTouchMove(e) {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier === this._joystickTouchId) {
                this._updateJoystick(touch.clientX, touch.clientY);
            }
        }
    }

    _onTouchEnd(e) {
        for (const touch of e.changedTouches) {
            if (touch.identifier === this._joystickTouchId) {
                this._joystickActive = false;
                this._joystickTouchId = null;
                this._joystickDelta = { x: 0, y: 0 };
                if (this._joystickKnobEl) {
                    this._joystickKnobEl.style.transform = '';
                }
                this._restoreJoystickHomePosition();
                continue;
            }

            const action = this._buttonTouches.get(touch.identifier);
            if (action && action in this._buttons) {
                this._buttons[action] = false;
                if (action in this._prevDiscreteButtons) {
                    this._prevDiscreteButtons[action] = false;
                }
            }
            this._buttonTouches.delete(touch.identifier);
        }
    }

    _isJoystickTarget(target) {
        return target === this._joystickEl
            || target === this._joystickKnobEl
            || this._joystickEl?.contains(target);
    }

    _shouldStartFloatingJoystick(touch, target) {
        if (!this._joystickEl || this._joystickActive || !this._shouldShowJoystickFallback()) {
            return false;
        }
        return shouldStartFloatingJoystick({
            touch,
            target,
            joystickEl: this._joystickEl,
            joystickActive: this._joystickActive,
            showJoystickFallback: true,
            containerEl: this._containerEl,
        });
    }

    _beginJoystickTouch(touch, { floating = false } = {}) {
        this._joystickTouchId = touch.identifier;
        if (floating) {
            this._joystickCenter = { x: touch.clientX, y: touch.clientY };
            this._positionFloatingJoystick(touch.clientX, touch.clientY);
        } else {
            const rect = this._joystickEl.getBoundingClientRect();
            this._joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        this._joystickActive = true;
        this._updateJoystick(touch.clientX, touch.clientY);
    }

    _positionFloatingJoystick(clientX, clientY) {
        positionFloatingJoystick(this._joystickEl, {
            clientX,
            clientY,
            joystickRadius: this._joystickRadius,
        });
    }

    _restoreJoystickHomePosition() {
        restoreJoystickHomePosition(this._joystickEl);
    }

    _updateJoystick(clientX, clientY) {
        if (!this._joystickCenter) return;
        let dx = clientX - this._joystickCenter.x;
        let dy = clientY - this._joystickCenter.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = this._joystickRadius;

        if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
        }

        this._joystickDelta = { x: dx / maxDist, y: dy / maxDist };

        if (this._joystickKnobEl) {
            this._joystickKnobEl.style.transform = `translate(${dx}px, ${dy}px)`;
        }
    }

    _resolveActionState() {
        const entityManager = this._game?.entityManager;
        const projection = this._getMatchRuntimeProjection();
        const player = this._findProjectedPlayer(projection)
            || entityManager?.players?.[this._playerIndex]
            || null;
        const strategy = entityManager?.gameModeStrategy || null;
        return resolveInventoryActionAvailability({
            player,
            modeType: projection?.modeId || strategy?.modeType || 'CLASSIC',
            showMg: !!strategy?.hasMachineGun?.(),
        });
    }

    _setButtonVisualState(id, { enabled = true, visible = true, title = '' } = {}) {
        const button = this._buttonEls[id];
        if (!button) return;
        applyTouchButtonVisualState(button, {
            enabled,
            visible,
            title,
            controlsVisible: this._uiVisible && !this._overlayActive,
        });
    }

    _requestPause() {
        const nowMs = Date.now();
        if (nowMs - this._lastPauseRequestAt < 350) {
            return false;
        }
        this._lastPauseRequestAt = nowMs;
        this._releaseAllControls();
        this._game?.matchFlowUiController?.pause?.();
        this._syncBlockingOverlayState();
        return true;
    }

    _syncActionButtons(actionState) {
        const typeLabel = actionState?.type ? actionState.type.replace(/_/g, ' ') : 'Kein Item';
        this._setButtonVisualState('fire', {
            enabled: !!actionState?.canShootNow,
            visible: true,
            title: actionState?.canShoot
                ? `${typeLabel}${actionState.canShootNow ? '' : ` | Shoot-CD ${actionState.shootCooldownRemaining.toFixed(1)}s`}`
                : `${typeLabel} | Nicht verschiessbar`,
        });
        this._setButtonVisualState('useItem', {
            enabled: !!actionState?.canUseNow,
            visible: true,
            title: actionState?.canUse
                ? `${typeLabel}${actionState.canUseNow ? '' : ` | Use-CD ${actionState.useCooldownRemaining.toFixed(1)}s`}`
                : `${typeLabel} | Nicht direkt nutzbar`,
        });
        this._setButtonVisualState('nextItem', {
            enabled: !!actionState?.canCycle,
            visible: true,
            title: actionState?.canCycle ? 'Naechstes Inventar-Item' : 'Kein weiteres Inventar-Item',
        });
        this._setButtonVisualState('shootMG', {
            enabled: !!actionState?.showMg,
            visible: !!actionState?.showMg,
            title: actionState?.showMg ? 'Maschinengewehr' : '',
        });

        if (!actionState?.canShootNow) this._buttons.fire = false;
        if (!actionState?.canUseNow) this._buttons.useItem = false;
        if (!actionState?.canCycle) this._buttons.nextItem = false;
        if (!actionState?.showMg) this._buttons.shootMG = false;
    }

    _syncMobileControlSettings() {
        this._mobileControlSettings = normalizeMobileClassicControlSettings(
            this._game?.settings?.localSettings?.mobileControls || this._mobileControlSettings
        );
        this._tiltSensitivity = this._mobileControlSettings.tiltSensitivity;
        this._tiltPitchMode = this._mobileControlSettings.tiltPitchMode;
        this._tiltAssistMode = this._mobileControlSettings.tiltAssistMode;
        this._tiltDebugVisible = this._mobileControlSettings.tiltDebugVisible;
        this._tiltSensorHzVisible = this._mobileControlSettings.tiltSensorHzVisible;
    }

    poll() {
        this._syncMobileControlSettings();
        if (this._syncBlockingOverlayState()) {
            this._releaseAllControls();
            return this._createNeutralInput();
        }
        const deadzone = 0.15;
        const jx = Math.abs(this._joystickDelta.x) > deadzone ? this._joystickDelta.x : 0;
        const jy = Math.abs(this._joystickDelta.y) > deadzone ? this._joystickDelta.y : 0;
        const tiltInput = this._resolveTiltSteeringInput();
        const touchPitchActive = !!tiltInput && this._tiltPitchMode === MOBILE_CLASSIC_TILT_PITCH_MODES.TOUCH;
        const actionState = this._resolveActionState();
        this._syncActionButtons(actionState);

        const boostDown = this._buttons.boost;
        const boostPressed = boostDown && !this._prevBoost;
        this._prevBoost = boostDown;
        const firePressed = this._buttons.fire && !this._prevDiscreteButtons.fire;
        const useItemPressed = this._buttons.useItem && !this._prevDiscreteButtons.useItem;
        const nextItemPressed = this._buttons.nextItem && !this._prevDiscreteButtons.nextItem;
        this._prevDiscreteButtons.fire = this._buttons.fire;
        this._prevDiscreteButtons.useItem = this._buttons.useItem;
        this._prevDiscreteButtons.nextItem = this._buttons.nextItem;

        return {
            pitchUp: touchPitchActive ? jy < -deadzone : (tiltInput ? tiltInput.pitchUp : jy < -deadzone),
            pitchDown: touchPitchActive ? jy > deadzone : (tiltInput ? tiltInput.pitchDown : jy > deadzone),
            yawLeft: tiltInput ? tiltInput.yawLeft : jx < -deadzone,
            yawRight: tiltInput ? tiltInput.yawRight : jx > deadzone,
            rollLeft: false,
            rollRight: false,
            pitchAxis: touchPitchActive ? -jy : (tiltInput ? -tiltInput.pitchAxis : -jy),
            yawAxis: tiltInput ? -tiltInput.yawAxis : -jx,
            rollAxis: 0,
            boost: boostDown,
            boostPressed,
            cameraSwitch: false,
            dropItem: false,
            useItem: useItemPressed && !!actionState?.canUseNow,
            shootItem: firePressed && !!actionState?.canShootNow,
            shootMG: this._buttons.shootMG && !!actionState?.showMg,
            nextItem: nextItemPressed && !!actionState?.canCycle,
        };
    }

    _createNeutralInput() {
        return {
            pitchUp: false,
            pitchDown: false,
            yawLeft: false,
            yawRight: false,
            rollLeft: false,
            rollRight: false,
            pitchAxis: 0,
            yawAxis: 0,
            rollAxis: 0,
            boost: false,
            boostPressed: false,
            cameraSwitch: false,
            dropItem: false,
            useItem: false,
            shootItem: false,
            shootMG: false,
            nextItem: false,
        };
    }

    _releaseAllControls() {
        this._joystickActive = false;
        this._joystickTouchId = null;
        this._joystickDelta = { x: 0, y: 0 };
        if (this._joystickKnobEl) {
            this._joystickKnobEl.style.transform = '';
        }
        this._restoreJoystickHomePosition();
        this._buttonTouches.clear();
        for (const key of Object.keys(this._buttons)) {
            this._buttons[key] = false;
        }
        this._prevBoost = false;
        for (const key of Object.keys(this._prevDiscreteButtons)) {
            this._prevDiscreteButtons[key] = false;
        }
    }

    _isElementVisible(element) {
        return !!element && !element.classList?.contains?.('hidden')
            && element.getAttribute?.('aria-hidden') !== 'true';
    }

    _isPauseOverlayActive() {
        const doc = this._containerEl?.ownerDocument || (typeof document !== 'undefined' ? document : null);
        return this._isElementVisible(this._game?.ui?.pauseOverlay || doc?.getElementById?.('pause-overlay'));
    }

    _isBlockingOverlayActive() {
        const doc = this._containerEl?.ownerDocument || (typeof document !== 'undefined' ? document : null);
        return this._isPauseOverlayActive()
            || this._isElementVisible(this._game?.ui?.messageOverlay || doc?.getElementById?.('message-overlay'));
    }

    _syncBlockingOverlayState() {
        const overlayActive = this._isBlockingOverlayActive();
        if (overlayActive !== this._overlayActive) {
            this._overlayActive = overlayActive;
            if (overlayActive) {
                this._releaseAllControls();
            }
            this._setUIVisibility(this._uiVisible);
        } else if (this._containerEl?.id === 'touch-controls') {
            this._containerEl.dataset.overlayActive = overlayActive ? '1' : '0';
            this._containerEl.style.pointerEvents = this._uiVisible && !overlayActive ? 'auto' : 'none';
        }
        return overlayActive;
    }

    _bindBlockingOverlayObserver() {
        const ownerWindow = this._containerEl?.ownerDocument?.defaultView
            || (typeof window !== 'undefined' ? window : null);
        if (!ownerWindow?.MutationObserver || this._blockingOverlayObserver) {
            return;
        }
        const doc = this._containerEl?.ownerDocument || (typeof document !== 'undefined' ? document : null);
        const targets = [
            this._game?.ui?.pauseOverlay || doc?.getElementById?.('pause-overlay'),
            this._game?.ui?.messageOverlay || doc?.getElementById?.('message-overlay'),
        ].filter(Boolean);
        if (targets.length === 0) {
            return;
        }
        this._blockingOverlayObserver = new ownerWindow.MutationObserver(() => {
            this._syncBlockingOverlayState();
        });
        for (const target of targets) {
            this._blockingOverlayObserver.observe(target, {
                attributes: true,
                attributeFilter: ['class', 'aria-hidden'],
            });
        }
    }

    _registerAndroidBackHandler() {
        const ownerWindow = this._containerEl?.ownerDocument?.defaultView
            || (typeof window !== 'undefined' ? window : null);
        if (!ownerWindow || this._androidBackHandler) {
            return;
        }
        this._previousAndroidBackHandler = typeof ownerWindow.__curviosAndroidBackHandler === 'function'
            ? ownerWindow.__curviosAndroidBackHandler
            : null;
        this._androidBackHandler = () => {
            if (this._handleAndroidBack()) return true;
            return this._previousAndroidBackHandler?.() === true;
        };
        ownerWindow.__curviosAndroidBackHandler = this._androidBackHandler;
    }

    _unregisterAndroidBackHandler() {
        const ownerWindow = this._containerEl?.ownerDocument?.defaultView
            || (typeof window !== 'undefined' ? window : null);
        if (!ownerWindow || !this._androidBackHandler) {
            return;
        }
        if (ownerWindow.__curviosAndroidBackHandler === this._androidBackHandler) {
            if (this._previousAndroidBackHandler) {
                ownerWindow.__curviosAndroidBackHandler = this._previousAndroidBackHandler;
            } else {
                delete ownerWindow.__curviosAndroidBackHandler;
            }
        }
        this._androidBackHandler = null;
        this._previousAndroidBackHandler = null;
    }

    _handleAndroidBack() {
        if (!this._inMatch || !this._uiVisible) {
            return false;
        }
        if (this._isPauseOverlayActive()) {
            this._game?.matchFlowUiController?.resumeFromPause?.();
            this._syncBlockingOverlayState();
            return true;
        }
        return this._requestPause();
    }

    _isTiltFresh() {
        return this._tiltState.lastEventAt > 0
            && Date.now() - this._tiltState.lastEventAt < TILT_EVENT_STALE_MS;
    }

    _shouldShowJoystickFallback() {
        this._syncMobileControlSettings();
        return this._controlMode !== TOUCH_CONTROL_MODES.TILT
            || this._tiltPitchMode === MOBILE_CLASSIC_TILT_PITCH_MODES.TOUCH
            || !this._isTiltFresh();
    }

    requestTiltControl() {
        return this._tiltSensorLifecycle.requestControl();
    }

    _resolveTiltSteeringInput() {
        if (this._controlMode !== TOUCH_CONTROL_MODES.TILT) return null;
        if (!this._tiltState.enabled || !this._tiltState.hasNeutral || !this._isTiltFresh()) {
            this._tiltResolved.yawAxis = 0;
            this._tiltResolved.pitchAxis = 0;
            return null;
        }
        if (this._tiltCalibration.active || this._tiltState.pendingCalibration) {
            return null;
        }
        const next = deriveTiltSteeringState({
            beta: this._tiltState.beta,
            gamma: this._tiltState.gamma,
            neutralBeta: this._tiltState.neutralBeta,
            neutralGamma: this._tiltState.neutralGamma,
            orientationAngle: resolveScreenOrientationAngle(),
            deadzoneDeg: this._tiltDeadzoneDeg,
            rangeDeg: this._tiltRangeDeg,
            curveExponent: this._tiltCurveExponent,
            sensitivity: this._tiltSensitivity,
            assistMode: this._tiltAssistMode,
        });
        const blend = 1 - this._tiltSmoothing;
        this._tiltResolved.yawAxis += (next.yawAxis - this._tiltResolved.yawAxis) * blend;
        this._tiltResolved.pitchAxis += (next.pitchAxis - this._tiltResolved.pitchAxis) * blend;

        const yawAxis = Math.abs(this._tiltResolved.yawAxis) <= this._tiltReleaseThreshold
            ? 0
            : this._tiltResolved.yawAxis;
        const pitchAxis = Math.abs(this._tiltResolved.pitchAxis) <= this._tiltReleaseThreshold
            ? 0
            : this._tiltResolved.pitchAxis;

        return {
            ...next,
            yawAxis,
            pitchAxis,
            yawLeft: yawAxis < 0,
            yawRight: yawAxis > 0,
            pitchUp: pitchAxis < 0,
            pitchDown: pitchAxis > 0,
        };
    }

    _resolveTiltControlState() {
        return this._tiltSensorLifecycle.resolveControlState({
            fresh: this._isTiltFresh(),
            tiltMode: this._controlMode === TOUCH_CONTROL_MODES.TILT,
        });
    }

    _resolveTiltStatusText(controlState = this._resolveTiltControlState()) {
        return resolveTiltStatusText(controlState, {
            debugVisible: this._tiltDebugVisible,
            sensorHzVisible: this._tiltSensorHzVisible,
            yawAxis: this._tiltResolved.yawAxis,
            pitchAxis: this._tiltResolved.pitchAxis,
            sensorHz: this._tiltState.sensorHz,
        });
    }

    _updateTiltUi() {
        this._syncMobileControlSettings();
        const controlState = this._resolveTiltControlState();
        if (this._containerEl) {
            this._containerEl.dataset.tiltActive = controlState === TILT_CONTROL_STATES.ACTIVE ? '1' : '0';
            this._containerEl.dataset.tiltPermission = this._tiltState.permission;
            this._containerEl.dataset.tiltControlState = controlState;
        }
        if (this._tiltButtonEl) {
            const buttonUi = resolveTiltButtonUi(controlState);
            this._tiltButtonEl.dataset.active = buttonUi.active ? '1' : '0';
            this._tiltButtonEl.textContent = buttonUi.text;
            this._tiltButtonEl.title = buttonUi.title;
        }
        if (this._tiltStatusEl) {
            this._tiltStatusEl.textContent = this._resolveTiltStatusText(controlState);
        }
        if (this._uiVisible && this._joystickEl) {
            this._joystickEl.style.display = !this._overlayActive && this._shouldShowJoystickFallback() ? '' : 'none';
        }
    }

    removeUI() {
        this._unregisterAndroidBackHandler();
        this._blockingOverlayObserver?.disconnect?.();
        this._blockingOverlayObserver = null;
        if (this._containerEl) {
            this._containerEl.removeEventListener('touchstart', this._touchStartHandler);
            this._containerEl.removeEventListener('touchmove', this._touchMoveHandler);
            this._containerEl.removeEventListener('touchend', this._touchEndHandler);
            this._containerEl.removeEventListener('touchcancel', this._touchEndHandler);
        }
        if (this._tiltButtonEl) {
            this._tiltButtonEl.removeEventListener('click', this._tiltActivateHandler);
        }
        this._tiltSensorLifecycle.stopListening();
        if (this._joystickEl?.parentNode) this._joystickEl.parentNode.removeChild(this._joystickEl);
        for (const el of Object.values(this._buttonEls)) {
            if (el?.parentNode) el.parentNode.removeChild(el);
        }
        if (this._tiltButtonEl?.parentNode) this._tiltButtonEl.parentNode.removeChild(this._tiltButtonEl);
        if (this._tiltStatusEl?.parentNode) this._tiltStatusEl.parentNode.removeChild(this._tiltStatusEl);
        this._buttonEls = {};
        this._buttonTouches.clear();
        this._joystickEl = null;
        this._joystickKnobEl = null;
        this._tiltButtonEl = null;
        this._tiltStatusEl = null;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this.removeUI();
        super.dispose();
    }
}
