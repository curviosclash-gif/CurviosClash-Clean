import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveTiltSteeringState,
  normalizeOrientationAngle,
  resolveTiltCalibrationNeutral,
} from '../src/ui/touch/TouchTiltSteeringOps.js';
import { TouchTiltSensorLifecycle } from '../src/ui/touch/TouchTiltSensorLifecycle.js';
import {
  MOBILE_CLASSIC_TILT_ASSIST_MODES,
} from '../src/shared/contracts/MobileClassicControlsContract.js';

test('Touch tilt calibration averages valid posture samples and normalizes orientation', () => {
  const neutral = resolveTiltCalibrationNeutral([
    { beta: 63, gamma: 4, orientationAngle: -90 },
    { beta: 65, gamma: 6, orientationAngle: 270 },
    { beta: Number.NaN, gamma: 9, orientationAngle: 0 },
  ]);

  assert.equal(neutral.neutralBeta, 64);
  assert.equal(neutral.neutralGamma, 5);
  assert.equal(neutral.neutralOrientationAngle, 270);
  assert.equal(normalizeOrientationAngle(450), 90);
});

test('Touch tilt calibration preserves normalized fallback without valid samples', () => {
  assert.deepEqual(resolveTiltCalibrationNeutral([], {
    neutralBeta: 21,
    neutralGamma: -4,
    neutralOrientationAngle: -90,
  }), {
    neutralBeta: 21,
    neutralGamma: -4,
    neutralOrientationAngle: 270,
  });
});

test('Touch tilt steering keeps deadzone and orientation mapping behavior', () => {
  const centered = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 21,
    gamma: 1,
  });
  assert.equal(centered.pitchAxis, 0);
  assert.equal(centered.yawAxis, 0);

  const landscapeRight = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 36,
    gamma: 0,
    orientationAngle: 90,
  });
  assert.equal(landscapeRight.yawRight, true);
  assert.equal(landscapeRight.yawLeft, false);
});

test('Touch tilt sensitivity and assist remain monotonic', () => {
  const base = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 20,
    gamma: 10,
    sensitivity: 1,
    assistMode: MOBILE_CLASSIC_TILT_ASSIST_MODES.OFF,
  });
  const sensitive = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 20,
    gamma: 10,
    sensitivity: 1.5,
    assistMode: MOBILE_CLASSIC_TILT_ASSIST_MODES.OFF,
  });
  const arcade = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 20,
    gamma: 10,
    sensitivity: 1,
    assistMode: MOBILE_CLASSIC_TILT_ASSIST_MODES.ARCADE,
  });

  assert.ok(sensitive.yawAxis > base.yawAxis);
  assert.ok(arcade.yawAxis > base.yawAxis);
  assert.ok(sensitive.yawAxis <= 1);
  assert.ok(arcade.yawAxis <= 1);
});

test('Touch tilt sensor lifecycle owns permission, calibration, and listener cleanup', async () => {
  const listeners = new Map();
  let now = 1000;
  let resetCount = 0;
  let updateCount = 0;
  const ownerWindow = {
    DeviceOrientationEvent: {
      async requestPermission() {
        return 'granted';
      },
    },
    screen: {
      orientation: {
        angle: 90,
      },
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  const lifecycle = new TouchTiltSensorLifecycle({
    getWindow: () => ownerWindow,
    isTiltMode: () => true,
    now: () => now,
    resetResolvedAxes: () => {
      resetCount += 1;
    },
    updateUi: () => {
      updateCount += 1;
    },
  });

  assert.equal(await lifecycle.requestControl(), true);
  assert.equal(lifecycle.state.listening, true);
  assert.equal(lifecycle.state.permission, 'granted');
  assert.equal(lifecycle.calibration.reason, 'manual');
  assert.equal(listeners.has('deviceorientation'), true);

  for (let index = 0; index < 8; index += 1) {
    now += 80;
    listeners.get('deviceorientation')({
      beta: 30 + index,
      gamma: 10 + index,
    });
  }

  assert.equal(lifecycle.state.hasNeutral, true);
  assert.equal(lifecycle.state.pendingCalibration, false);
  assert.equal(lifecycle.state.neutralOrientationAngle, 90);
  assert.ok(lifecycle.state.sensorHz > 0);
  assert.ok(resetCount >= 2);
  assert.ok(updateCount >= 2);

  lifecycle.stopListening();
  assert.equal(lifecycle.state.listening, false);
  assert.equal(lifecycle.state.enabled, false);
  assert.equal(lifecycle.state.sensorHz, 0);
  assert.equal(listeners.has('deviceorientation'), false);

  lifecycle.stopListening();
  assert.equal(lifecycle.state.listening, false);
});
