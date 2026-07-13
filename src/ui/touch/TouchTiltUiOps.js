// ============================================
// TouchTiltUiOps.js - tilt status/button UI text resolution
// ============================================

import { TILT_CONTROL_STATES } from './TouchTiltSensorLifecycle.js';

function formatAxisValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.005) return '0.00';
    return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}`;
}

function formatSensorHz(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? `${numeric.toFixed(0)}Hz` : '--Hz';
}

export function resolveTiltStatusText(controlState, {
    debugVisible = false,
    sensorHzVisible = false,
    yawAxis = 0,
    pitchAxis = 0,
    sensorHz = 0,
} = {}) {
    if (controlState === TILT_CONTROL_STATES.CALIBRATING) return 'KALIBRIERE - RUHIG NEUTRAL HALTEN';
    if (controlState === TILT_CONTROL_STATES.DENIED) return 'NEIGUNG ABGELEHNT - JOYSTICK AKTIV';
    if (controlState === TILT_CONTROL_STATES.UNSUPPORTED) return 'KEIN NEIGUNGSSENSOR - JOYSTICK AKTIV';
    if (controlState !== TILT_CONTROL_STATES.ACTIVE) {
        return sensorHzVisible ? `TILT ${formatSensorHz(0)} - JOYSTICK` : 'TILT AUS - JOYSTICK AKTIV';
    }
    const parts = [];
    if (debugVisible) {
        parts.push(`Y ${formatAxisValue(yawAxis)}`);
        parts.push(`P ${formatAxisValue(pitchAxis)}`);
    }
    if (sensorHzVisible) {
        parts.push(formatSensorHz(sensorHz));
    }
    return parts.length > 0 ? parts.join(' ') : 'TILT SANFT';
}

export function resolveTiltButtonUi(controlState) {
    const active = controlState === TILT_CONTROL_STATES.ACTIVE;
    return {
        active,
        text: controlState === TILT_CONTROL_STATES.CALIBRATING ? 'HALTEN' : (active ? 'NEU' : 'NEIGUNG'),
        title: active
            ? 'Neu kalibrieren: Geraet kurz neutral halten'
            : 'Neigungssteuerung aktivieren: Geraet kurz neutral halten',
    };
}
