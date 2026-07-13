import {
    normalizeOrientationAngle,
    resolveTiltCalibrationNeutral,
} from './TouchTiltSteeringOps.js';

const TILT_CALIBRATION_MIN_SAMPLES = 8;
const TILT_CALIBRATION_SAMPLE_MS = 520;
const TILT_CALIBRATION_MAX_MS = 1100;

function resolveDefaultWindow() {
    return typeof window !== 'undefined' ? window : null;
}

function hasDeviceOrientationSupport(ownerWindow) {
    return !!ownerWindow && 'DeviceOrientationEvent' in ownerWindow;
}

export const TILT_CONTROL_STATES = Object.freeze({
    CALIBRATING: 'calibrating',
    ACTIVE: 'active',
    FALLBACK: 'fallback',
    DENIED: 'denied',
    UNSUPPORTED: 'unsupported',
});

/**
 * Derives the guided tilt control state for UI and input decisions.
 * `fresh` is owned by the caller (sensor staleness window lives in TouchInputSource).
 */
export function resolveTiltControlState({ state, calibration, tiltMode = true, fresh = false } = {}) {
    if (!tiltMode || !state) return TILT_CONTROL_STATES.FALLBACK;
    if (state.permission === 'unsupported') return TILT_CONTROL_STATES.UNSUPPORTED;
    if (state.permission === 'denied') return TILT_CONTROL_STATES.DENIED;
    if (state.enabled && (calibration?.active || state.pendingCalibration || !state.hasNeutral)) {
        return TILT_CONTROL_STATES.CALIBRATING;
    }
    if (state.enabled && state.hasNeutral && fresh) return TILT_CONTROL_STATES.ACTIVE;
    return TILT_CONTROL_STATES.FALLBACK;
}

export function resolveScreenOrientationAngle(ownerWindow = resolveDefaultWindow()) {
    if (!ownerWindow) return 0;
    const screenAngle = Number(ownerWindow.screen?.orientation?.angle);
    if (Number.isFinite(screenAngle)) {
        return normalizeOrientationAngle(screenAngle);
    }
    const legacyAngle = Number(ownerWindow.orientation);
    return Number.isFinite(legacyAngle) ? normalizeOrientationAngle(legacyAngle) : 0;
}

export class TouchTiltSensorLifecycle {
    constructor({
        getWindow = resolveDefaultWindow,
        isTiltMode = () => true,
        now = () => Date.now(),
        resetResolvedAxes = () => {},
        updateUi = () => {},
    } = {}) {
        this._getWindow = typeof getWindow === 'function' ? getWindow : resolveDefaultWindow;
        this._isTiltMode = typeof isTiltMode === 'function' ? isTiltMode : () => true;
        this._now = typeof now === 'function' ? now : () => Date.now();
        this._resetResolvedAxes = typeof resetResolvedAxes === 'function' ? resetResolvedAxes : () => {};
        this._updateUi = typeof updateUi === 'function' ? updateUi : () => {};
        this._listeningWindow = null;
        this.orientationHandler = (event) => this.handleOrientation(event);

        this.state = {
            supported: hasDeviceOrientationSupport(this._resolveWindow()),
            enabled: false,
            listening: false,
            permission: 'idle',
            beta: 0,
            gamma: 0,
            neutralBeta: 0,
            neutralGamma: 0,
            neutralOrientationAngle: 0,
            hasNeutral: false,
            pendingCalibration: false,
            lastEventAt: 0,
            eventIntervalMs: 0,
            sensorHz: 0,
        };
        this.calibration = {
            active: false,
            samples: [],
            startedAt: 0,
            reason: 'none',
        };
    }

    _resolveWindow() {
        return this._getWindow() || null;
    }

    resolveControlState({ fresh = false, tiltMode = this._isTiltMode() } = {}) {
        return resolveTiltControlState({
            state: this.state,
            calibration: this.calibration,
            tiltMode,
            fresh,
        });
    }

    startListening({ auto = false } = {}) {
        if (!this._isTiltMode()) return false;
        const ownerWindow = this._resolveWindow();
        this.state.supported = hasDeviceOrientationSupport(ownerWindow);
        if (!this.state.supported) {
            this.state.permission = 'unsupported';
            this._updateUi();
            return false;
        }
        if (!this.state.listening) {
            ownerWindow.addEventListener('deviceorientation', this.orientationHandler, { passive: true });
            this._listeningWindow = ownerWindow;
            this.state.listening = true;
        }
        this.state.enabled = true;
        this.state.permission = auto ? 'auto' : 'granted';
        this.beginCalibration(auto ? 'match-start' : 'manual');
        this._updateUi();
        return true;
    }

    async requestControl() {
        if (!this._isTiltMode()) return false;
        const ownerWindow = this._resolveWindow();
        this.state.supported = hasDeviceOrientationSupport(ownerWindow);
        if (!this.state.supported) {
            this.state.permission = 'unsupported';
            this._updateUi();
            return false;
        }

        const requestPermission = ownerWindow.DeviceOrientationEvent?.requestPermission;
        if (typeof requestPermission === 'function') {
            const permission = await requestPermission.call(ownerWindow.DeviceOrientationEvent);
            this.state.permission = permission === 'granted' ? 'granted' : 'denied';
            if (permission !== 'granted') {
                this._updateUi();
                return false;
            }
        }

        return this.startListening({ auto: false });
    }

    handleOrientation(event) {
        const beta = Number(event?.beta);
        const gamma = Number(event?.gamma);
        if (!Number.isFinite(beta) || !Number.isFinite(gamma)) {
            return;
        }
        const orientationAngle = resolveScreenOrientationAngle(this._resolveWindow());
        const now = this._now();
        const previousEventAt = this.state.lastEventAt;
        if (previousEventAt > 0 && now > previousEventAt) {
            const intervalMs = now - previousEventAt;
            this.state.eventIntervalMs = this.state.eventIntervalMs > 0
                ? (this.state.eventIntervalMs * 0.82) + (intervalMs * 0.18)
                : intervalMs;
            this.state.sensorHz = this.state.eventIntervalMs > 0
                ? 1000 / this.state.eventIntervalMs
                : 0;
        }
        this.state.beta = beta;
        this.state.gamma = gamma;
        this.state.lastEventAt = now;
        if (
            this.state.hasNeutral
            && normalizeOrientationAngle(this.state.neutralOrientationAngle) !== orientationAngle
            && !this.calibration.active
        ) {
            this.beginCalibration('orientation-change');
        }
        if (this.state.pendingCalibration || !this.state.hasNeutral || this.calibration.active) {
            this.captureCalibrationSample(beta, gamma, orientationAngle);
        }
        this._updateUi();
    }

    beginCalibration(reason = 'manual') {
        this.calibration.active = true;
        this.calibration.samples = [];
        this.calibration.startedAt = this._now();
        this.calibration.reason = reason;
        this.state.pendingCalibration = true;
        this._resetResolvedAxes();
    }

    captureCalibrationSample(beta, gamma, orientationAngle) {
        if (!this.calibration.active) {
            this.beginCalibration('sample');
        }
        this.calibration.samples.push({ beta, gamma, orientationAngle });
        const elapsedMs = this._now() - this.calibration.startedAt;
        const enoughSamples = this.calibration.samples.length >= TILT_CALIBRATION_MIN_SAMPLES;
        const enoughTime = elapsedMs >= TILT_CALIBRATION_SAMPLE_MS;
        const timedOut = elapsedMs >= TILT_CALIBRATION_MAX_MS;
        if ((enoughSamples && enoughTime) || timedOut) {
            this.finishCalibration();
        }
    }

    finishCalibration() {
        const neutral = resolveTiltCalibrationNeutral(this.calibration.samples, this.state);
        this.state.neutralBeta = neutral.neutralBeta;
        this.state.neutralGamma = neutral.neutralGamma;
        this.state.neutralOrientationAngle = neutral.neutralOrientationAngle;
        this.state.hasNeutral = true;
        this.state.pendingCalibration = false;
        this.calibration.active = false;
        this.calibration.samples = [];
        this._resetResolvedAxes();
    }

    stopListening() {
        const ownerWindow = this._listeningWindow || this._resolveWindow();
        if (this.state.listening && ownerWindow) {
            ownerWindow.removeEventListener('deviceorientation', this.orientationHandler);
        }
        this._listeningWindow = null;
        this.state.listening = false;
        this.state.enabled = false;
        this.state.lastEventAt = 0;
        this.state.eventIntervalMs = 0;
        this.state.sensorHz = 0;
    }
}
