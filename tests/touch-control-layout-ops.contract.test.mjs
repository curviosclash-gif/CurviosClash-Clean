import assert from 'node:assert/strict';
import test from 'node:test';

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
} from '../src/ui/touch/TouchControlLayoutOps.js';

function createStyle() {
  return {
    cssText: '',
    setProperty(name, value) {
      this[name] = value;
    },
  };
}

function createElement(tagName = 'div') {
  return {
    tagName,
    type: '',
    className: '',
    textContent: '',
    title: '',
    dataset: {},
    style: createStyle(),
    attributes: {},
    children: [],
    parentNode: null,
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function createDocument({ width = 400, height = 800 } = {}) {
  return {
    defaultView: {
      innerWidth: width,
      innerHeight: height,
    },
    documentElement: {
      clientWidth: width,
      clientHeight: height,
    },
    createElement,
  };
}

test('Touch control layout definitions preserve mobile action order and clone entries', () => {
  const joystickButtons = resolveTouchButtonDefinitions(TOUCH_CONTROL_MODES.JOYSTICK).map((button) => button.id);
  const tiltButtons = resolveTouchButtonDefinitions(TOUCH_CONTROL_MODES.TILT, {
    includePauseButton: true,
  });

  assert.deepEqual(joystickButtons, ['fire', 'useItem', 'shootMG', 'nextItem', 'boost']);
  assert.deepEqual(tiltButtons.map((button) => button.id), ['fire', 'useItem', 'nextItem', 'boost', 'pause']);
  tiltButtons[0].label = 'changed';
  assert.equal(resolveTouchButtonDefinitions(TOUCH_CONTROL_MODES.TILT)[0].label, 'SCHUSS');
});

test('Touch control layout ops create joystick, buttons, and tilt affordances', () => {
  const containerEl = createElement('section');
  containerEl.id = 'touch-controls';
  containerEl.ownerDocument = createDocument();
  let clickCount = 0;

  const joystick = createTouchJoystickElements({
    containerEl,
    joystickRadius: 48,
  });
  const buttons = createTouchButtonElements({
    containerEl,
    buttonDefinitions: resolveTouchButtonDefinitions(TOUCH_CONTROL_MODES.TILT, {
      includePauseButton: true,
    }),
  });
  const tiltControls = createTouchTiltControlElements({
    containerEl,
    activateHandler: () => {
      clickCount += 1;
    },
  });

  assert.equal(joystick.joystickEl.className, 'touch-joystick');
  assert.equal(joystick.joystickKnobEl.className, 'touch-joystick-knob');
  assert.match(joystick.joystickEl.style.cssText, /width: 96px/);
  assert.equal(buttons.pause.dataset.action, 'pause');
  assert.equal(buttons.fire.dataset.baseLabel, 'SCHUSS');
  assert.match(buttons.pause.style.cssText, /touch-action: none/);
  assert.equal(tiltControls.tiltButtonEl.type, 'button');
  assert.equal(tiltControls.tiltButtonEl.dataset.tiltAction, 'calibrate');
  assert.equal(tiltControls.tiltButtonEl.listeners.click(), undefined);
  assert.equal(clickCount, 1);
  assert.equal(tiltControls.tiltStatusEl.textContent, 'TILT');
});

test('Touch control layout ops keep visibility and floating joystick rules stable', () => {
  const containerEl = createElement('section');
  containerEl.id = 'touch-controls';
  containerEl.ownerDocument = createDocument({ width: 400, height: 800 });
  const joystickEl = createElement();
  const fireButton = createElement();
  const tiltButtonEl = createElement('button');
  const tiltStatusEl = createElement();

  applyTouchControlsVisibility({
    containerEl,
    joystickEl,
    buttonEls: { fire: fireButton },
    tiltButtonEl,
    tiltStatusEl,
    visible: true,
    overlayActive: false,
    showJoystickFallback: true,
  });

  assert.equal(containerEl.style.pointerEvents, 'auto');
  assert.equal(containerEl.attributes['aria-hidden'], 'false');
  assert.equal(containerEl.dataset.overlayActive, '0');
  assert.equal(fireButton.style.display, 'flex');
  assert.equal(tiltStatusEl.style.display, 'block');

  applyTouchButtonVisualState(fireButton, {
    enabled: false,
    visible: true,
    controlsVisible: true,
    title: 'cooldown',
  });
  assert.equal(fireButton.dataset.enabled, '0');
  assert.equal(fireButton.title, 'cooldown');
  assert.equal(fireButton.style.opacity, '0.35');

  assert.equal(shouldStartFloatingJoystick({
    touch: { clientX: 120, clientY: 520 },
    target: null,
    joystickEl,
    showJoystickFallback: true,
    containerEl,
  }), true);
  assert.equal(shouldStartFloatingJoystick({
    touch: { clientX: 260, clientY: 520 },
    target: null,
    joystickEl,
    showJoystickFallback: true,
    containerEl,
  }), false);
  assert.equal(shouldStartFloatingJoystick({
    touch: { clientX: 120, clientY: 520 },
    target: { closest: () => ({ dataset: { action: 'fire' } }) },
    joystickEl,
    showJoystickFallback: true,
    containerEl,
  }), false);

  positionFloatingJoystick(joystickEl, {
    clientX: 120,
    clientY: 520,
    joystickRadius: 60,
  });
  assert.equal(joystickEl.style.left, '60px');
  assert.equal(joystickEl.style.top, '460px');
  assert.equal(joystickEl.style.bottom, 'auto');

  restoreJoystickHomePosition(joystickEl);
  assert.equal(joystickEl.style.left, '5%');
  assert.equal(joystickEl.style.bottom, '20%');
  assert.equal(joystickEl.style.top, 'auto');
});
