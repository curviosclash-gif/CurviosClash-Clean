import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createRendererBuildDefines,
  createRendererShellBuildConfig,
} from '../dev/vite/rendererShellConfig.js';
import { pruneMobileClassicHtml } from '../scripts/build-mobile-classic-app.mjs';
import {
  applyMobileClassicSettings,
  applyMobileClassicUiLocks,
  isMobileClassicTargetValue,
} from '../src/mobile-classic/MobileClassicApp.js';
import { LEVEL4_SECTION_IDS } from '../src/ui/menu/MenuStateContracts.js';
import { MenuNavigationRuntime } from '../src/ui/menu/MenuNavigationRuntime.js';
import { createPreferredMatchInputSource } from '../src/ui/MatchInputSourceResolver.js';
import {
  createMobileClassicGithubUpdateConfig,
  MOBILE_CLASSIC_FALLBACK_GITHUB_REPOSITORY,
  normalizeMobileClassicGithubRepository,
  normalizeMobileClassicUpdateConfig,
} from '../src/mobile-classic/MobileClassicUpdateConfig.js';
import {
  deriveTiltSteeringState,
  resolveTouchButtonDefinitions,
  resolveTiltCalibrationNeutral,
  TouchInputSource,
  TOUCH_CONTROL_MODES,
} from '../src/ui/TouchInputSource.js';
import {
  TILT_CONTROL_STATES,
  TouchTiltSensorLifecycle,
  resolveScreenOrientationAngle,
} from '../src/ui/touch/TouchTiltSensorLifecycle.js';
import {
  DEFAULT_MOBILE_CLASSIC_CONTROLS,
  MOBILE_CLASSIC_TILT_ASSIST_MODES,
  MOBILE_CLASSIC_TILT_PITCH_MODES,
  normalizeMobileClassicControlSettings,
} from '../src/shared/contracts/MobileClassicControlsContract.js';
import { PlayerController } from '../src/entities/player/PlayerController.js';
import { PlayerInputSystem } from '../src/entities/systems/PlayerInputSystem.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

function withGlobalValue(name, value, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  try {
    return fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  }
}

function createButton(dataset = {}) {
  return {
    dataset,
    disabled: false,
    textContent: '',
    title: 'old',
    tabIndex: 0,
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    querySelector() {
      return null;
    },
  };
}

function createMapSelect(values = [], selectedValue = '') {
  const select = {
    value: selectedValue,
    options: [],
  };
  select.options = values.map((value) => ({
    value,
    remove() {
      const index = select.options.indexOf(this);
      if (index >= 0) select.options.splice(index, 1);
    },
  }));
  return select;
}

function createClassList(initial = []) {
  const entries = new Set(initial);
  return {
    add(value) {
      entries.add(value);
    },
    remove(value) {
      entries.delete(value);
    },
    contains(value) {
      return entries.has(value);
    },
    toggle(value, force) {
      const enabled = force === undefined ? !entries.has(value) : !!force;
      if (enabled) entries.add(value);
      else entries.delete(value);
      return enabled;
    },
  };
}

function createStyle() {
  return {
    setProperty(name, value) {
      this[name] = value;
    },
    removeProperty(name) {
      delete this[name];
    },
  };
}

function createTouchElement({ id = '', hidden = false } = {}) {
  return {
    id,
    dataset: {},
    style: createStyle(),
    attributes: {},
    classList: createClassList(hidden ? ['hidden'] : []),
    listeners: {},
    ownerDocument: null,
    appendChild(child) {
      child.parentNode = this;
    },
    removeChild(child) {
      if (child.parentNode === this) child.parentNode = null;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    removeEventListener(type) {
      delete this.listeners[type];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    contains(target) {
      return target === this;
    },
    closest() {
      return null;
    },
    getBoundingClientRect() {
      return { left: 20, top: 400, width: 120, height: 120 };
    },
  };
}

test('Unified Mobile Android uses its product-local Capacitor wrapper', async () => {
  const config = await readJson('tools/mobile-classic-app/capacitor.config.json');
  const subprojectPackage = await readJson('tools/mobile-classic-app/package.json');

  assert.equal(config.appId, 'de.curviosclash.classic');
  assert.equal(config.appName, 'Curvios Clash');
  assert.equal(config.webDir, '../../dist/mobile-classic');
  assert.equal(config.android.path, '../../android-classic');
  assert.equal(subprojectPackage.private, true);
  assert.equal(subprojectPackage.dependencies['@capacitor/android'], '8.3.4');
  assert.equal(subprojectPackage.dependencies['@capacitor/core'], '8.3.4');

  await assert.rejects(
    readJson('capacitor.config.json'),
    (error) => error?.code === 'ENOENT',
  );
});

test('Mobile menu panel focus keeps the shared submenu header visible', () => {
  const scrollContainer = {
    scrollTop: 569,
    scrollTo({ top }) {
      this.scrollTop = top;
    },
  };
  let focusOptions = null;
  const focusTarget = {
    focus(options) {
      focusOptions = options || null;
      if (!options?.preventScroll) {
        scrollContainer.scrollTop = 569;
      }
    },
  };
  const doc = {
    body: {
      classList: createClassList(['mobile-classic-app']),
    },
    querySelector() {
      return scrollContainer;
    },
  };
  const panel = {
    id: 'submenu-game',
    ownerDocument: doc,
    offsetTop: 48,
    classList: createClassList(['hidden']),
    setAttribute() {},
    querySelectorAll() {
      return [focusTarget];
    },
    closest(selector) {
      return selector === '.menu-content' ? scrollContainer : null;
    },
  };
  const navButton = {
    dataset: {
      submenu: 'submenu-game',
    },
    classList: createClassList(),
    setAttribute() {},
  };
  const runtime = new MenuNavigationRuntime({
    ui: {
      mainMenu: {
        ownerDocument: doc,
        querySelector() {
          return scrollContainer;
        },
      },
    },
  });
  runtime._panelById.set('submenu-game', panel);
  runtime._submenuPanels = [panel];
  runtime._navButtons = [navButton];

  assert.equal(runtime.showPanel('submenu-game'), true);
  assert.equal(focusOptions?.preventScroll, true);
  assert.equal(scrollContainer.scrollTop, 0);
});

test('Mobile Classic build target emits only the game shell into its own dist path', () => {
  const config = createRendererShellBuildConfig({
    rootDir: root,
    chunkSizeWarningLimit: 1300,
    env: {
      VITE_APP_MODE: 'app',
      VITE_APP_TARGET: 'mobile-classic',
    },
  });

  assert.equal(config.outDir, 'dist/mobile-classic');
  assert.deepEqual(Object.keys(config.rollupOptions.input), ['app']);
  assert.match(config.rollupOptions.input.app, /index\.html$/);

  const defines = createRendererBuildDefines({
    pkgVersion: '0.0.0-test',
    buildTime: 'test',
    buildId: 'test',
    env: {
      VITE_APP_MODE: 'app',
      VITE_APP_TARGET: 'mobile-classic',
    },
  });
  assert.equal(defines.__APP_MODE__, '"app"');
  assert.equal(defines.__APP_TARGET__, '"mobile-classic"');
});

test('Unified Mobile Android runtime guard defaults invalid modes to single-player Classic', () => {
  const settings = {
    mode: '2p',
    gameMode: 'HUNT',
    invertPitch: {
      PLAYER_1: true,
      PLAYER_2: true,
    },
    localSettings: {
      sessionType: 'multiplayer',
      modePath: 'fight',
      mobileControls: {
        tiltSensitivity: 9,
        tiltPitchMode: 'bad',
        tiltAssistMode: 'arcade',
        tiltDebugVisible: true,
        tiltSensorHzVisible: true,
      },
    },
    gameplay: {
      planarMode: true,
    },
    hunt: {
      respawnEnabled: true,
    },
  };

  assert.equal(isMobileClassicTargetValue('mobile-classic'), true);
  assert.equal(isMobileClassicTargetValue('app'), false);

  applyMobileClassicSettings(settings);

  assert.equal(settings.mode, '1p');
  assert.equal(settings.gameMode, 'CLASSIC');
  assert.equal(settings.localSettings.sessionType, 'single');
  assert.equal(settings.localSettings.modePath, 'normal');
  assert.equal(settings.invertPitch.PLAYER_1, false);
  assert.equal(settings.invertPitch.PLAYER_2, true);
  assert.equal(settings.localSettings.mobileControls.tiltSensitivity, 1.8);
  assert.equal(settings.localSettings.mobileControls.tiltPitchMode, MOBILE_CLASSIC_TILT_PITCH_MODES.TILT);
  assert.equal(settings.localSettings.mobileControls.tiltAssistMode, MOBILE_CLASSIC_TILT_ASSIST_MODES.ARCADE);
  assert.equal(settings.localSettings.mobileControls.tiltDebugVisible, true);
  assert.equal(settings.localSettings.mobileControls.tiltSensorHzVisible, true);
  assert.equal(settings.gameplay.planarMode, false);
  assert.equal(settings.hunt.respawnEnabled, false);
});

test('Unified Mobile Android settings keep Level 4 on phone-relevant sections', () => {
  const settings = {
    localSettings: {
      modePath: 'normal',
      toolsState: {
        activeSection: LEVEL4_SECTION_IDS.ADVANCED_MAP,
      },
    },
    gameplay: {},
    hunt: {},
  };

  applyMobileClassicSettings(settings);

  assert.equal(settings.localSettings.toolsState.activeSection, LEVEL4_SECTION_IDS.MOBILE_CONTROLS);

  settings.localSettings.toolsState.activeSection = LEVEL4_SECTION_IDS.GAMEPLAY;
  applyMobileClassicSettings(settings);

  assert.equal(settings.localSettings.toolsState.activeSection, LEVEL4_SECTION_IDS.GAMEPLAY);
});

test('Mobile Classic default tilt assist is soft for phone play', () => {
  const controls = normalizeMobileClassicControlSettings({});

  assert.equal(DEFAULT_MOBILE_CLASSIC_CONTROLS.tiltAssistMode, MOBILE_CLASSIC_TILT_ASSIST_MODES.SOFT);
  assert.equal(controls.tiltAssistMode, MOBILE_CLASSIC_TILT_ASSIST_MODES.SOFT);
});

test('Unified Mobile Android UI keeps the shared game menu copy and mobile mode limits', () => {
  const singleButton = createButton({ sessionType: 'single' });
  const multiButton = createButton({ sessionType: 'multiplayer' });
  const normalButton = createButton({ modePath: 'normal' });
  const arcadeButton = createButton({ modePath: 'arcade' });
  const fightButton = createButton({ modePath: 'fight' });
  const hostButton = createButton();
  const lanTransportButton = createButton({ multiplayerTransport: 'lan' });
  const onlineTransportButton = createButton({ multiplayerTransport: 'online' });
  const mapSelect = createMapSelect(['standard', 'micro_maw', 'storm_switchyard', 'mirror_docks'], 'storm_switchyard');
  const startButton = createButton();
  const menuContext = { textContent: 'Hauptmenue' };
  singleButton.textContent = 'Einzelspieler';
  normalButton.textContent = 'Klassisch';
  arcadeButton.textContent = 'Arcade';
  startButton.textContent = 'Spiel starten';
  const gameSettings = {
    localSettings: {
      modePath: 'arcade',
    },
  };

  applyMobileClassicUiLocks({
    settings: gameSettings,
    ui: {
      sessionButtons: [singleButton, multiButton],
      modePathButtons: [normalButton, arcadeButton, fightButton],
      mapSelect,
      multiplayerHostButton: hostButton,
      multiplayerTransportButtons: [lanTransportButton, onlineTransportButton],
      startButton,
      menuContext,
    },
  });

  assert.equal(singleButton.disabled, false);
  assert.equal(singleButton.textContent, 'Einzelspieler');
  assert.equal(multiButton.disabled, false);
  assert.equal(normalButton.disabled, false);
  assert.equal(normalButton.textContent, 'Klassisch');
  assert.equal(arcadeButton.disabled, false);
  assert.equal(arcadeButton.textContent, 'Arcade');
  assert.equal(fightButton.disabled, true);
  assert.equal(hostButton.disabled, true);
  assert.equal(lanTransportButton.disabled, false);
  assert.equal(onlineTransportButton.disabled, true);
  assert.deepEqual(mapSelect.options.map((option) => option.value), ['micro_maw', 'mirror_docks']);
  assert.equal(mapSelect.value, 'micro_maw');
  assert.equal(gameSettings.mapKey, 'micro_maw');
  assert.equal(gameSettings.localSettings.startSetup.modeSelections.arcade.mapKey, 'micro_maw');
  assert.equal(gameSettings.localSettings.startSetup.arcadeGhostDuelMode, 'self_longest_ghost');
  assert.equal(startButton.textContent, 'Spiel starten');
  assert.equal(menuContext.textContent, 'Hauptmenue');
});

test('Unified Mobile Android preserves an authoritative LAN multiplayer snapshot', () => {
  const settings = {
    mode: '1p',
    gameMode: 'CLASSIC',
    mapKey: 'maze',
    invertPitch: { PLAYER_1: true },
    localSettings: {
      sessionType: 'multiplayer',
      multiplayerTransport: 'lan',
      modePath: 'normal',
    },
    gameplay: { planarMode: true },
    hunt: { respawnEnabled: true },
  };

  applyMobileClassicSettings(settings);

  assert.equal(settings.mode, '1p');
  assert.equal(settings.gameMode, 'CLASSIC');
  assert.equal(settings.mapKey, 'maze');
  assert.equal(settings.localSettings.sessionType, 'multiplayer');
  assert.equal(settings.localSettings.multiplayerTransport, 'lan');
  assert.equal(settings.localSettings.modePath, 'normal');
  assert.equal(settings.gameplay.planarMode, true);
  assert.equal(settings.hunt.respawnEnabled, true);
  assert.equal(settings.invertPitch.PLAYER_1, false);
});

test('Unified Mobile Android Level 4 keeps the shared game menu copy', () => {
  const nodesById = new Map([
    ['btn-open-level4', { textContent: 'Erweiterte Optionen', dataset: { level4Section: LEVEL4_SECTION_IDS.GAMEPLAY } }],
    ['level4-tab-mobile-controls', { textContent: 'Mobile' }],
    ['level4-tab-gameplay', { textContent: 'Gameplay' }],
  ]);
  const nodesBySelector = new Map([
    ['#submenu-level4 .level4-header .submenu-title', { textContent: 'Erweiterte Optionen' }],
    ['#level4-section-mobile-controls .section-title', { textContent: 'Mobile-Feineinstellung' }],
    ['#level4-section-gameplay .section-title', { textContent: 'Spieloptionen' }],
  ]);
  const doc = {
    documentElement: {
      dataset: {},
    },
    body: {
      dataset: {},
    },
    getElementById(id) {
      return nodesById.get(id) || null;
    },
    querySelector(selector) {
      return nodesBySelector.get(selector) || null;
    },
  };

  applyMobileClassicUiLocks({
    settings: {
      localSettings: {
        modePath: 'normal',
      },
    },
    ui: {
      mainMenu: {
        ownerDocument: doc,
      },
    },
  });

  assert.equal(nodesById.get('btn-open-level4').textContent, 'Erweiterte Optionen');
  assert.equal(nodesById.get('btn-open-level4').dataset.level4Section, LEVEL4_SECTION_IDS.GAMEPLAY);
  assert.equal(nodesBySelector.get('#submenu-level4 .level4-header .submenu-title').textContent, 'Erweiterte Optionen');
  assert.equal(nodesById.get('level4-tab-mobile-controls').textContent, 'Mobile');
  assert.equal(nodesById.get('level4-tab-gameplay').textContent, 'Gameplay');
  assert.equal(nodesBySelector.get('#level4-section-mobile-controls .section-title').textContent, 'Mobile-Feineinstellung');
  assert.equal(nodesBySelector.get('#level4-section-gameplay .section-title').textContent, 'Spieloptionen');
});

test('Mobile Classic GitHub update config resolves repository metadata', () => {
  assert.equal(
    normalizeMobileClassicGithubRepository('git@github.com:curvios/repo.git'),
    'curvios/repo',
  );
  assert.equal(
    normalizeMobileClassicGithubRepository('https://github.com/curvios/repo.git'),
    'curvios/repo',
  );
  assert.equal(
    normalizeMobileClassicGithubRepository('not-a-repo'),
    MOBILE_CLASSIC_FALLBACK_GITHUB_REPOSITORY,
  );

  const config = createMobileClassicGithubUpdateConfig('curvios/repo');
  assert.equal(config.provider, 'github-releases');
  assert.equal(config.repository, 'curvios/repo');
  assert.equal(config.apiUrl, 'https://api.github.com/repos/curvios/repo/releases/latest');
  assert.equal(config.latestReleaseUrl, 'https://github.com/curvios/repo/releases/latest');

  const manifestConfig = normalizeMobileClassicUpdateConfig({
    updates: {
      repository: 'git@github.com:curvios/fork.git',
    },
  });
  assert.equal(manifestConfig.repository, 'curvios/fork');
  assert.equal(manifestConfig.apiUrl, 'https://api.github.com/repos/curvios/fork/releases/latest');
});

test('Mobile Classic tilt steering maps calibrated device orientation', () => {
  const neutral = {
    neutralBeta: 24,
    neutralGamma: -2,
    deadzoneDeg: 6,
    rangeDeg: 24,
  };

  const steady = deriveTiltSteeringState({
    ...neutral,
    beta: 26,
    gamma: 0,
  });
  assert.equal(steady.yawLeft, false);
  assert.equal(steady.yawRight, false);
  assert.equal(steady.pitchUp, false);
  assert.equal(steady.pitchDown, false);

  const right = deriveTiltSteeringState({
    ...neutral,
    beta: 24,
    gamma: 13,
  });
  assert.equal(right.yawRight, true);
  assert.equal(right.yawLeft, false);

  const left = deriveTiltSteeringState({
    ...neutral,
    beta: 24,
    gamma: -18,
  });
  assert.equal(left.yawLeft, true);
  assert.equal(left.yawRight, false);

  const landscapeRight = deriveTiltSteeringState({
    ...neutral,
    beta: 40,
    gamma: -2,
    orientationAngle: 90,
  });
  assert.equal(landscapeRight.yawRight, true);

  // V131 Orientation-Policy: Android lockt auf sensorLandscape, beide Landscape-
  // Richtungen (90/270) muessen dieselbe physische Neigung spiegelbildlich mappen.
  const reverseLandscapeLeft = deriveTiltSteeringState({
    ...neutral,
    beta: 40,
    gamma: -2,
    orientationAngle: 270,
  });
  assert.equal(reverseLandscapeLeft.yawLeft, true);
  assert.equal(reverseLandscapeLeft.yawRight, false);
  assert.equal(reverseLandscapeLeft.yawAxis, -landscapeRight.yawAxis);

  const reverseLandscapeRight = deriveTiltSteeringState({
    ...neutral,
    beta: 8,
    gamma: -2,
    orientationAngle: 270,
  });
  assert.equal(reverseLandscapeRight.yawRight, true);
  assert.equal(reverseLandscapeRight.yawLeft, false);
});

test('Mobile Classic tilt steering uses soft analog axes for phone control', () => {
  const centered = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 21,
    gamma: 1,
  });
  assert.equal(centered.pitchAxis, 0);
  assert.equal(centered.yawAxis, 0);

  const slightRight = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 20,
    gamma: 5,
  });
  const mediumRight = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 20,
    gamma: 12,
  });
  const softRight = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 20,
    gamma: 24,
  });
  assert.equal(slightRight.yawRight, true);
  assert.ok(slightRight.yawAxis > 0);
  assert.ok(slightRight.yawAxis < mediumRight.yawAxis);
  assert.ok(mediumRight.yawAxis < softRight.yawAxis);
  assert.equal(softRight.yawRight, true);
  assert.ok(softRight.yawAxis < 1);

  const tiltSource = new TouchInputSource({ controlMode: TOUCH_CONTROL_MODES.TILT });
  tiltSource._tiltState.enabled = true;
  tiltSource._tiltState.hasNeutral = true;
  tiltSource._tiltState.lastEventAt = Date.now();
  tiltSource._tiltState.neutralBeta = 20;
  tiltSource._tiltState.neutralGamma = 0;
  tiltSource._tiltState.beta = 20;
  tiltSource._tiltState.gamma = 5;
  const firstResolved = tiltSource._resolveTiltSteeringInput();
  assert.equal(firstResolved.yawRight, true);
  assert.ok(firstResolved.yawAxis > 0.04);
  assert.ok(firstResolved.yawAxis < 0.12);

  const controller = new PlayerController();
  const control = controller.resolveControlState(
    { controlRampEnabled: false },
    {
      pitchAxis: 0.35,
      yawAxis: -0.5,
      rollAxis: 0.2,
      boost: false,
      boostPressed: false,
    },
    false,
    1 / 60,
  );
  assert.equal(control.pitchInput, 0.35);
  assert.equal(control.yawInput, -0.5);
  assert.equal(control.rollInput, 0.2);
});

test('Mobile Classic tilt menu options shape steering and diagnostics', () => {
  const baseRight = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 20,
    gamma: 10,
    sensitivity: 1,
    assistMode: MOBILE_CLASSIC_TILT_ASSIST_MODES.OFF,
  });
  const sensitiveRight = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 20,
    gamma: 10,
    sensitivity: 1.5,
    assistMode: MOBILE_CLASSIC_TILT_ASSIST_MODES.OFF,
  });
  const arcadeRight = deriveTiltSteeringState({
    neutralBeta: 20,
    neutralGamma: 0,
    beta: 20,
    gamma: 10,
    sensitivity: 1,
    assistMode: MOBILE_CLASSIC_TILT_ASSIST_MODES.ARCADE,
  });
  assert.ok(sensitiveRight.yawAxis > baseRight.yawAxis);
  assert.ok(arcadeRight.yawAxis > baseRight.yawAxis);

  const controls = normalizeMobileClassicControlSettings({
    tiltSensitivity: 1.45,
    tiltPitchMode: MOBILE_CLASSIC_TILT_PITCH_MODES.TOUCH,
    tiltAssistMode: MOBILE_CLASSIC_TILT_ASSIST_MODES.SOFT,
    tiltDebugVisible: true,
    tiltSensorHzVisible: true,
  });
  const tiltSource = new TouchInputSource({
    controlMode: TOUCH_CONTROL_MODES.TILT,
    mobileControls: controls,
  });
  tiltSource._tiltState.enabled = true;
  tiltSource._tiltState.hasNeutral = true;
  tiltSource._tiltState.lastEventAt = Date.now();
  tiltSource._tiltState.neutralBeta = 20;
  tiltSource._tiltState.neutralGamma = 0;
  tiltSource._tiltState.beta = 20;
  tiltSource._tiltState.gamma = 10;
  tiltSource._tiltState.sensorHz = 58;
  tiltSource._joystickDelta = { x: 0, y: -0.5 };
  const polled = tiltSource.poll();
  assert.equal(polled.pitchUp, true);
  assert.equal(polled.pitchAxis, 0.5);
  assert.equal(polled.yawRight, true);
  assert.match(tiltSource._resolveTiltStatusText(), /Y \+/);
  assert.match(tiltSource._resolveTiltStatusText(), /58Hz/);
});

test('Mobile Classic tilt calibration treats the current hand posture as neutral', () => {
  const neutral = resolveTiltCalibrationNeutral([
    { beta: 63, gamma: 4, orientationAngle: 0 },
    { beta: 65, gamma: 5, orientationAngle: 0 },
    { beta: 64, gamma: 3, orientationAngle: 0 },
  ]);
  assert.ok(neutral.neutralBeta > 63);
  assert.ok(neutral.neutralBeta < 65);
  assert.ok(neutral.neutralGamma > 3);
  assert.ok(neutral.neutralGamma < 5);

  const steady = deriveTiltSteeringState({
    neutralBeta: neutral.neutralBeta,
    neutralGamma: neutral.neutralGamma,
    beta: neutral.neutralBeta + 2,
    gamma: neutral.neutralGamma + 2,
  });
  assert.equal(steady.pitchAxis, 0);
  assert.equal(steady.yawAxis, 0);

  const turnRight = deriveTiltSteeringState({
    neutralBeta: neutral.neutralBeta,
    neutralGamma: neutral.neutralGamma,
    beta: neutral.neutralBeta,
    gamma: neutral.neutralGamma + 18,
  });
  assert.equal(turnRight.yawRight, true);
});

test('Mobile Classic tilt lifecycle models calibrating, active, fallback and re-calibration', async () => {
  let nowMs = 100000;
  const fakeWindow = {
    DeviceOrientationEvent: function DeviceOrientationEvent() {},
    screen: { orientation: { angle: 0 } },
    listeners: {},
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    removeEventListener(type) {
      delete this.listeners[type];
    },
  };
  const lifecycle = new TouchTiltSensorLifecycle({
    getWindow: () => fakeWindow,
    now: () => nowMs,
  });

  assert.equal(lifecycle.resolveControlState({ fresh: false }), TILT_CONTROL_STATES.FALLBACK);

  assert.equal(lifecycle.startListening({ auto: true }), true);
  assert.equal(lifecycle.resolveControlState({ fresh: true }), TILT_CONTROL_STATES.CALIBRATING);

  for (let i = 0; i < 9; i += 1) {
    nowMs += 80;
    lifecycle.handleOrientation({ beta: 21, gamma: 1 });
  }
  assert.equal(lifecycle.state.hasNeutral, true);
  assert.equal(lifecycle.calibration.active, false);
  assert.equal(lifecycle.resolveControlState({ fresh: true }), TILT_CONTROL_STATES.ACTIVE);
  assert.equal(lifecycle.resolveControlState({ fresh: false }), TILT_CONTROL_STATES.FALLBACK);

  fakeWindow.screen.orientation.angle = 90;
  nowMs += 80;
  lifecycle.handleOrientation({ beta: 2, gamma: -20 });
  assert.equal(lifecycle.calibration.active, true);
  assert.equal(lifecycle.calibration.reason, 'orientation-change');
  assert.equal(lifecycle.resolveControlState({ fresh: true }), TILT_CONTROL_STATES.CALIBRATING);

  const deniedWindow = {
    DeviceOrientationEvent: function DeviceOrientationEvent() {},
    screen: { orientation: { angle: 0 } },
    addEventListener() {},
    removeEventListener() {},
  };
  deniedWindow.DeviceOrientationEvent.requestPermission = async () => 'denied';
  const deniedLifecycle = new TouchTiltSensorLifecycle({ getWindow: () => deniedWindow });
  assert.equal(await deniedLifecycle.requestControl(), false);
  assert.equal(deniedLifecycle.state.permission, 'denied');
  assert.equal(deniedLifecycle.resolveControlState({ fresh: true }), TILT_CONTROL_STATES.DENIED);

  const unsupportedLifecycle = new TouchTiltSensorLifecycle({
    getWindow: () => ({ addEventListener() {}, removeEventListener() {} }),
  });
  assert.equal(unsupportedLifecycle.startListening({ auto: true }), false);
  assert.equal(unsupportedLifecycle.state.permission, 'unsupported');
  assert.equal(unsupportedLifecycle.resolveControlState({ fresh: false }), TILT_CONTROL_STATES.UNSUPPORTED);
});

test('Mobile Classic tilt lifecycle canonicalizes legacy negative orientation angles', () => {
  let nowMs = 200000;
  const fakeWindow = {
    DeviceOrientationEvent: function DeviceOrientationEvent() {},
    orientation: -90,
    addEventListener() {},
    removeEventListener() {},
  };
  const lifecycle = new TouchTiltSensorLifecycle({
    getWindow: () => fakeWindow,
    now: () => nowMs,
  });

  assert.equal(resolveScreenOrientationAngle(fakeWindow), 270);
  assert.equal(lifecycle.startListening({ auto: true }), true);
  for (let index = 0; index < 9; index += 1) {
    nowMs += 80;
    lifecycle.handleOrientation({ beta: 21, gamma: 1 });
  }
  assert.equal(lifecycle.state.neutralOrientationAngle, 270);
  assert.equal(lifecycle.calibration.active, false);

  nowMs += 80;
  lifecycle.handleOrientation({ beta: 21, gamma: 1 });
  assert.equal(lifecycle.calibration.active, false);

  fakeWindow.orientation = 90;
  nowMs += 80;
  lifecycle.handleOrientation({ beta: 1, gamma: -20 });
  assert.equal(lifecycle.calibration.active, true);
  assert.equal(lifecycle.calibration.reason, 'orientation-change');
});

test('Mobile Classic tilt UI guides neutral hold, fallback and re-calibration', () => {
  const container = createTouchElement({ id: 'touch-controls' });
  const tiltStatus = createTouchElement();
  const tiltButton = createTouchElement();
  const source = new TouchInputSource({
    controlMode: TOUCH_CONTROL_MODES.TILT,
    game: { settings: { localSettings: {} } },
  });
  source._containerEl = container;
  source._tiltStatusEl = tiltStatus;
  source._tiltButtonEl = tiltButton;

  source._tiltState.enabled = true;
  source._tiltState.permission = 'auto';
  source._tiltState.pendingCalibration = true;
  source._tiltCalibration.active = true;
  source._updateTiltUi();
  assert.equal(container.dataset.tiltControlState, TILT_CONTROL_STATES.CALIBRATING);
  assert.match(tiltStatus.textContent, /KALIBRIERE/);
  assert.match(tiltStatus.textContent, /NEUTRAL HALTEN/);
  assert.equal(tiltButton.textContent, 'HALTEN');

  source._tiltCalibration.active = false;
  source._tiltState.pendingCalibration = false;
  source._tiltState.hasNeutral = true;
  source._tiltState.lastEventAt = Date.now();
  source._updateTiltUi();
  assert.equal(container.dataset.tiltControlState, TILT_CONTROL_STATES.ACTIVE);
  assert.equal(tiltButton.textContent, 'NEU');
  assert.match(tiltButton.title, /Neu kalibrieren/);

  source._tiltState.lastEventAt = Date.now() - 5000;
  source._updateTiltUi();
  assert.equal(container.dataset.tiltControlState, TILT_CONTROL_STATES.FALLBACK);
  assert.match(tiltStatus.textContent, /JOYSTICK/);

  source._tiltState.permission = 'denied';
  source._updateTiltUi();
  assert.equal(container.dataset.tiltControlState, TILT_CONTROL_STATES.DENIED);
  assert.match(tiltStatus.textContent, /ABGELEHNT/);

  source._tiltState.permission = 'unsupported';
  source._updateTiltUi();
  assert.equal(container.dataset.tiltControlState, TILT_CONTROL_STATES.UNSUPPORTED);
  assert.match(tiltStatus.textContent, /KEIN NEIGUNGSSENSOR/);

  source.dispose();
});

test('Mobile Classic tilt touch controls expose all classic match actions', () => {
  const tiltButtons = resolveTouchButtonDefinitions(TOUCH_CONTROL_MODES.TILT).map((button) => button.id);
  assert.deepEqual(tiltButtons, ['fire', 'rocket', 'useItem', 'nextItem', 'boost']);
  assert.equal(tiltButtons.includes('shootMG'), false);
});

test('Mobile Classic touch path has pause and edge-triggered item actions', () => {
  const tiltButtons = resolveTouchButtonDefinitions(TOUCH_CONTROL_MODES.TILT, {
    includePauseButton: true,
  }).map((button) => button.id);

  assert.deepEqual(tiltButtons, ['fire', 'rocket', 'useItem', 'nextItem', 'boost', 'pause']);

  let pauseCount = 0;
  const source = new TouchInputSource({
    controlMode: TOUCH_CONTROL_MODES.TILT,
    includePauseButton: true,
    game: {
      matchFlowUiController: {
        pause() {
          pauseCount += 1;
        },
      },
      settings: {
        localSettings: {},
      },
    },
  });
  source._resolveActionState = () => ({
    canShootNow: true,
    selectedCanShootNow: true,
    canUseNow: true,
    canCycle: true,
    showMg: false,
  });

  source._buttons.fire = true;
  source._buttons.useItem = true;
  source._buttons.nextItem = true;
  source._pendingButtonPresses.add('fire');
  source._pendingButtonPresses.add('useItem');
  source._pendingButtonPresses.add('nextItem');
  const firstPoll = source.poll();
  const secondPoll = source.poll();

  assert.equal(firstPoll.shootItem, true);
  assert.equal(firstPoll.useItem, true);
  assert.equal(firstPoll.nextItem, true);
  assert.equal(secondPoll.shootItem, false);
  assert.equal(secondPoll.useItem, false);
  assert.equal(secondPoll.nextItem, false);

  const player = {
    index: 0,
    isBot: false,
    inventory: [{}],
    selectedItemIndex: 0,
  };
  const playerInputSystem = new PlayerInputSystem({
    humanPlayers: [player],
    renderer: {
      cameraModes: [],
      cycleCamera() {},
    },
  });
  let currentTouchInput = firstPoll;
  const inputManager = {
    getPlayerInput() {
      return currentTouchInput;
    },
  };
  assert.equal(playerInputSystem.resolvePlayerInput(player, 1 / 60, inputManager).useItem, 0);
  currentTouchInput = secondPoll;
  assert.equal(playerInputSystem.resolvePlayerInput(player, 1 / 60, inputManager).useItem, -1);

  assert.equal(source._requestPause(), true);
  assert.equal(source._requestPause(), false);
  assert.equal(pauseCount, 1);

  source.dispose();
});

test('Mobile Classic touch controls yield to pause overlay and Android back resumes', () => {
  const container = createTouchElement({ id: 'touch-controls' });
  const joystick = createTouchElement();
  const fireButton = createTouchElement();
  const pauseOverlay = createTouchElement({ hidden: true });
  let pauseCount = 0;
  let resumeCount = 0;
  const source = new TouchInputSource({
    game: {
      ui: {
        pauseOverlay,
      },
      matchFlowUiController: {
        pause() {
          pauseCount += 1;
          pauseOverlay.classList.remove('hidden');
        },
        resumeFromPause() {
          resumeCount += 1;
          pauseOverlay.classList.add('hidden');
        },
      },
      settings: {
        localSettings: {},
      },
    },
  });

  source._containerEl = container;
  source._joystickEl = joystick;
  source._buttonEls = { fire: fireButton };
  source._inMatch = true;
  source._setUIVisibility(true);
  assert.equal(container.style.pointerEvents, 'auto');

  assert.equal(source._handleAndroidBack(), true);
  assert.equal(pauseCount, 1);
  assert.equal(container.dataset.overlayActive, '1');
  assert.equal(container.style.pointerEvents, 'none');
  assert.equal(fireButton.style.display, 'none');

  assert.equal(source._handleAndroidBack(), true);
  assert.equal(resumeCount, 1);
  assert.equal(container.dataset.overlayActive, '0');
  assert.equal(container.style.pointerEvents, 'auto');

  source.dispose();
});

test('Mobile Classic fallback joystick can start as a floating left-side stick', () => {
  const container = createTouchElement({ id: 'touch-controls' });
  container.ownerDocument = {
    defaultView: {
      innerWidth: 400,
      innerHeight: 800,
    },
    documentElement: {
      clientWidth: 400,
      clientHeight: 800,
    },
  };
  const joystick = createTouchElement();
  const knob = createTouchElement();
  const source = new TouchInputSource({
    controlMode: TOUCH_CONTROL_MODES.JOYSTICK,
    game: {
      settings: {
        localSettings: {},
      },
    },
  });

  source._containerEl = container;
  source._joystickEl = joystick;
  source._joystickKnobEl = knob;
  source._setUIVisibility(true);

  const touch = { identifier: 7, clientX: 120, clientY: 520 };
  assert.equal(source._shouldStartFloatingJoystick(touch, null), true);
  source._beginJoystickTouch(touch, { floating: true });

  assert.equal(source._joystickTouchId, 7);
  assert.deepEqual(source._joystickCenter, { x: 120, y: 520 });
  assert.equal(joystick.style.left, '60px');
  assert.equal(joystick.style.top, '460px');

  source.dispose();
});

test('Mobile Classic keeps a quick touch tap latched until the next poll', () => {
  const fireTarget = {
    dataset: { action: 'fire' },
    closest(selector) {
      return selector === '[data-action]' ? this : null;
    },
  };
  const source = new TouchInputSource({ game: { settings: { localSettings: {} } } });
  source._resolveActionState = () => ({
    canShootNow: true,
    selectedCanShootNow: true,
    canUseNow: true,
    canCycle: true,
    showMg: false,
  });
  const event = {
    changedTouches: [{ identifier: 4, clientX: 10, clientY: 10 }],
    preventDefault() {},
  };

  withGlobalValue('document', { elementFromPoint: () => fireTarget }, () => {
    source._onTouchStart(event);
    source._onTouchEnd(event);
  });

  assert.equal(source.poll().shootItem, true);
  assert.equal(source.poll().shootItem, false);
  source.dispose();
});

test('Mobile Classic keeps the first joystick finger as owner', () => {
  const joystick = createTouchElement();
  const source = new TouchInputSource({ game: { settings: { localSettings: {} } } });
  source._joystickEl = joystick;
  source._joystickKnobEl = createTouchElement();

  source._beginJoystickTouch({ identifier: 1, clientX: 40, clientY: 440 });
  source._beginJoystickTouch({ identifier: 2, clientX: 60, clientY: 460 });
  source._onTouchEnd({ changedTouches: [{ identifier: 2 }] });

  assert.equal(source._joystickTouchId, 1);
  assert.equal(source._joystickActive, true);
  source.dispose();
});

test('Mobile Classic clears held touch controls through the shared input reset', () => {
  const source = new TouchInputSource();
  source._buttons.boost = true;
  source._joystickActive = true;
  source._joystickTouchId = 8;
  source._joystickDelta = { x: 0.8, y: -0.4 };

  source.clearInputState();

  assert.equal(source._buttons.boost, false);
  assert.equal(source._joystickActive, false);
  assert.equal(source._joystickTouchId, null);
  assert.deepEqual(source._joystickDelta, { x: 0, y: 0 });
  source.dispose();
});

test('Mobile Classic restores the visible joystick when tilt input becomes stale', () => {
  const container = createTouchElement({ id: 'touch-controls' });
  const joystick = createTouchElement();
  const source = new TouchInputSource({
    controlMode: TOUCH_CONTROL_MODES.TILT,
    game: {
      settings: {
        localSettings: {},
      },
    },
  });

  source._containerEl = container;
  source._joystickEl = joystick;
  source._uiVisible = true;
  source._tiltState.enabled = true;
  source._tiltState.hasNeutral = true;
  source._tiltState.lastEventAt = Date.now() - 2000;
  container.dataset.tiltControlState = TILT_CONTROL_STATES.ACTIVE;
  container.dataset.tiltActive = '1';
  joystick.style.display = 'none';

  source.poll();

  assert.equal(container.dataset.tiltControlState, TILT_CONTROL_STATES.FALLBACK);
  assert.equal(container.dataset.tiltActive, '0');
  assert.equal(joystick.style.display, '');
  source.dispose();
});

test('Mobile Classic keeps an action held while another finger still holds it', () => {
  const source = new TouchInputSource();
  source._buttons.boost = true;
  source._buttonTouches.set(1, 'boost');
  source._buttonTouches.set(2, 'boost');

  source._onTouchEnd({ changedTouches: [{ identifier: 1 }] });
  assert.equal(source._buttons.boost, true);

  source._onTouchEnd({ changedTouches: [{ identifier: 2 }] });
  assert.equal(source._buttons.boost, false);
  source.dispose();
});

test('Mobile Classic input resolver falls back to touch after a gamepad disconnect', () => {
  const gamepad = {
    axes: [0, 0, 0],
    buttons: Array.from({ length: 8 }, () => ({ pressed: false })),
  };
  let gamepads = [gamepad];
  const container = createTouchElement({ id: 'touch-controls' });
  const doc = {
    body: container,
    documentElement: {
      clientWidth: 800,
      clientHeight: 400,
    },
    defaultView: {
      innerWidth: 800,
      innerHeight: 400,
    },
    createElement() {
      const element = createTouchElement();
      element.ownerDocument = doc;
      return element;
    },
    getElementById(id) {
      return id === 'touch-controls' ? container : null;
    },
  };
  container.ownerDocument = doc;

  withGlobalValue('window', { ontouchstart: null }, () => {
    withGlobalValue('navigator', { getGamepads: () => gamepads }, () => {
      withGlobalValue('document', doc, () => {
        const source = createPreferredMatchInputSource({
          inputManager: { getKeyboardInput: () => null },
          playerIndex: 0,
          localHumanCount: 1,
          game: {
            _mobileClassicAppTarget: true,
            settings: { localSettings: {} },
          },
        });
        assert.equal(source.type, 'gamepad');
        assert.equal(Math.abs(source.poll().yawAxis), 0);
        assert.equal(container.style.display, undefined);

        gamepads = [];
        assert.equal(Math.abs(source.poll().yawAxis), 0);
        assert.equal(container.style.display, 'block');

        gamepads = [gamepad];
        assert.equal(Math.abs(source.poll().yawAxis), 0);
        assert.equal(container.style.display, 'none');
        source.dispose();
      });
    });
  });
});

test('Mobile Classic touch availability accepts touch-point devices without ontouchstart', () => {
  withGlobalValue('window', { matchMedia: () => ({ matches: false }) }, () => {
    withGlobalValue('navigator', { maxTouchPoints: 5, getGamepads: () => [] }, () => {
      assert.equal(TouchInputSource.isAvailable(), true);
    });
  });
});

test('Mobile Classic build prunes developer DOM and inactive preloads', () => {
  const html = `<!doctype html>
<html>
<head>
  <link rel="modulepreload" crossorigin href="/assets/training-a.js">
  <link rel="modulepreload" crossorigin href="/assets/recorder-a.js">
  <link rel="modulepreload" crossorigin href="/assets/developer-ui-a.js">
  <link rel="modulepreload" crossorigin href="/assets/three-core-a.js">
  <link rel="modulepreload" crossorigin href="/assets/validation-a.js">
  <link rel="modulepreload" crossorigin href="/assets/map-presets-a.js">
</head>
<body>
  <button type="button" id="btn-open-developer">Developer oeffnen</button>
  <!-- ======= SUBMENU: DEVELOPER ======= -->
  <div id="submenu-developer" class="submenu-panel hidden">
    <div><button>Nested developer action</button></div>
  </div>
  <!-- ======= SUBMENU: DEBUG / INFO ======= -->
  <div id="submenu-debug"></div>
</body>
</html>`;
  const prunedHtml = pruneMobileClassicHtml(html);

  assert.doesNotMatch(prunedHtml, /training-a\.js|recorder-a\.js|developer-ui-a\.js/);
  assert.doesNotMatch(prunedHtml, /validation-a\.js|map-presets-a\.js/);
  assert.match(prunedHtml, /three-core-a\.js/);
  assert.doesNotMatch(prunedHtml, /btn-open-developer|submenu-developer|Nested developer action/);
  assert.match(prunedHtml, /submenu-debug/);
});

test('Unified Mobile Android scripts build, wrap, and validate the phone app path', async () => {
  const packageJson = await readJson('package.json');
  const buildScript = await readText('scripts/build-mobile-classic-app.mjs');
  const capacitorScript = await readText('scripts/capacitor-mobile-classic.mjs');
  const gradleFile = await readText('android-classic/app/build.gradle');
  const androidManifest = await readText('android-classic/app/src/main/AndroidManifest.xml');
  const capacitorConfig = await readJson('tools/mobile-classic-app/capacitor.config.json');
  const mainActivity = await readText('android-classic/app/src/main/java/de/curviosclash/classic/MainActivity.java');
  const updateScript = await readText('scripts/update-mobile-classic-from-github.mjs');
  const mobileClassicApp = await readText('src/mobile-classic/MobileClassicApp.js');
  const mobileClassicStyles = await readText('src/mobile-classic/MobileClassicStyles.js');
  const mobileClassicUpdateUi = await readText('src/mobile-classic/MobileClassicUpdateUi.js');
  const mobileClassicMenuUi = await readText('src/mobile-classic/MobileClassicMenuUi.js');
  const mobileClassicSurface = `${mobileClassicApp}\n${mobileClassicStyles}\n${mobileClassicUpdateUi}\n${mobileClassicMenuUi}`;
  const startSetupUiOps = await readText('src/ui/start-setup/StartSetupUiOps.js');
  const matchInputResolver = await readText('src/ui/MatchInputSourceResolver.js');
  const touchInputSource = await readText('src/ui/TouchInputSource.js');
  const touchTiltUiOps = await readText('src/ui/touch/TouchTiltUiOps.js');
  const readme = await readText('tools/mobile-classic-app/README.md');

  assert.equal(packageJson.scripts['app:android:build'], 'node scripts/build-mobile-classic-app.mjs');
  assert.equal(packageJson.scripts['app:android:check'], 'node --test tests/mobile-classic-app.contract.test.mjs tests/mobile-arcade-app.contract.test.mjs');
  assert.equal(packageJson.scripts['app:android:sync'], 'node scripts/capacitor-mobile-classic.mjs sync');
  assert.equal(packageJson.scripts['app:android:assets:check'], 'node scripts/capacitor-mobile-classic.mjs check-assets');
  assert.equal(packageJson.scripts['app:android:install'], 'node scripts/capacitor-mobile-classic.mjs install');
  assert.equal(packageJson.scripts['app:android:update:github'], 'node scripts/update-mobile-classic-from-github.mjs');
  assert.equal(packageJson.scripts['app:classic:android:build'], undefined);
  assert.equal(packageJson.scripts['app:classic:android:update:github'], undefined);
  assert.match(buildScript, /VITE_APP_TARGET = 'mobile-classic'/);
  assert.match(buildScript, /mobile-classic\.manifest\.json/);
  assert.match(buildScript, /curvios\.mobile-android-app\.v1/);
  assert.match(buildScript, /modePaths: \['normal', 'arcade'\]/);
  assert.match(buildScript, /sessionTypes: \['single', 'multiplayer'\]/);
  assert.match(buildScript, /role: 'client'/);
  assert.match(buildScript, /transport: 'lan'/);
  assert.match(buildScript, /listMobileArcadeRouteAllowlist/);
  assert.match(buildScript, /CURVIOS_CLASSIC_APP_GITHUB_REPOSITORY/);
  assert.match(buildScript, /updates: createMobileClassicGithubUpdateConfig/);
  assert.match(buildScript, /pruneMobileClassicHtml/);
  assert.match(capacitorScript, /tools', 'mobile-classic-app'/);
  assert.match(capacitorScript, /@capacitor', 'cli', 'bin', 'capacitor'/);
  assert.match(capacitorScript, /check-assets/);
  assert.match(capacitorScript, /cleanAndroidPublicAssets/);
  assert.match(capacitorScript, /copy', 'android'/);
  assert.match(capacitorScript, /verifyAndroidAssetsFresh/);
  assert.match(capacitorScript, /ANDROID_HOME/);
  assert.match(capacitorScript, /cmd\.exe/);
  assert.match(capacitorScript, /assembleDebug/);
  assert.match(capacitorScript, /de\.curviosclash\.classic/);
  assert.match(capacitorScript, /error\.stderr/);
  assert.match(gradleFile, /JsonSlurper/);
  assert.match(gradleFile, /mobileAndroidApplicationId = 'de\.curviosclash\.classic'/);
  assert.match(gradleFile, /mobileAndroidAppName = 'Curvios Clash'/);
  assert.doesNotMatch(gradleFile, /mobileAndroidIsArcade|de\.curviosclash\.arcade/);
  assert.match(gradleFile, /versionCode mobileClassicVersionCode/);
  assert.match(gradleFile, /versionName mobileClassicVersionName/);
  // V131 Orientation-Policy: landscape-stabil fuer Match und Menue, keine Activity-Recreation bei Rotation.
  assert.match(androidManifest, /android:screenOrientation="sensorLandscape"/);
  assert.match(androidManifest, /android:configChanges="[^"]*orientation[^"]*"/);
  assert.match(androidManifest, /android:usesCleartextTraffic="true"/);
  assert.deepEqual(capacitorConfig.server, {
    hostname: 'localhost',
    androidScheme: 'http',
    cleartext: true,
  });
  assert.match(mainActivity, /WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON/);
  assert.match(mainActivity, /OnBackPressedCallback/);
  assert.match(mainActivity, /__curviosAndroidBackHandler/);
  assert.match(mainActivity, /evaluateJavascript/);
  assert.match(updateScript, /merge', '--ff-only'/);
  assert.match(updateScript, /ensureCleanWorkingTree/);
  assert.match(updateScript, /capacitor-mobile-classic\.mjs/);
  assert.match(updateScript, /GitHub URL/);
  assert.match(mobileClassicApp, /setupMobileClassicUpdateUi/);
  assert.doesNotMatch(mobileClassicApp, /mobileClassicUpdateState|mobile-classic\.manifest\.json/);
  assert.match(mobileClassicUpdateUi, /mobile-classic-update-check/);
  assert.match(mobileClassicUpdateUi, /checkMobileClassicGithubRelease/);
  assert.match(mobileClassicUpdateUi, /mobile-classic\.manifest\.json/);
  assert.doesNotMatch(mobileClassicMenuUi, /Freier Flug fuer den schnellen Start/);
  assert.doesNotMatch(mobileClassicMenuUi, /Zeitroute mit Ghost-Selbstduell/);
  assert.doesNotMatch(mobileClassicMenuUi, /mobile-android-route-panel/);
  assert.doesNotMatch(mobileClassicMenuUi, /mobileRouteKey|dispatchMapSelectChange/);
  assert.match(mobileClassicStyles, /#menu-nav\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.doesNotMatch(mobileClassicStyles, /nav-btn\[data-session-type="multiplayer"\]/);
  assert.match(mobileClassicStyles, /#btn-multiplayer-host/);
  assert.match(mobileClassicStyles, /#btn-multiplayer-transport-online/);
  assert.doesNotMatch(mobileClassicStyles, /mobile-android-entry|mobile-android-route/);
  assert.match(mobileClassicApp, /ensureMobileClassicStyles/);
  assert.match(startSetupUiOps, /dataset\.summaryLabel/);
  assert.doesNotMatch(mobileClassicMenuUi, /Classic starten|Parcours starten|Solo spielen/);
  assert.match(mobileClassicUpdateUi, /Update/);
  assert.match(touchTiltUiOps, /TILT SANFT/);
  assert.match(touchTiltUiOps, /KALIBRIERE/);
  assert.match(touchInputSource, /resolveTiltCalibrationNeutral/);
  assert.match(touchInputSource, /resolveTouchButtonDefinitions/);
  assert.match(touchInputSource, /maxTouchPoints/);
  assert.match(touchInputSource, /aria-hidden/);
  assert.match(readme, /Classic and\s+Arcade-Parcours/);
  assert.match(readme, /app:android:assets:check/);
  assert.match(readme, /app:android:update:github/);
  assert.doesNotMatch(readme, /app:classic:android:/);
  assert.equal(TOUCH_CONTROL_MODES.TILT, 'tilt');
  assert.match(matchInputResolver, /pitchAxis/);
  assert.match(matchInputResolver, /TOUCH_CONTROL_MODES\.TILT/);
  assert.match(matchInputResolver, /_mobileClassicAppTarget/);
});

