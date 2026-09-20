// ============================================
// InputManager.js - keyboard input and dynamic bindings
// ============================================

import {
    CONTINUE_INTENT_KEY,
    GamepadContinueInput,
    isContinueKeyEvent,
    isContinueMouseEvent,
    isInteractiveContinueTarget,
} from '../shared/input/ContinueIntentOps.js';
import { GamepadPauseInput } from '../shared/input/GamepadInputSource.js';
import { CONFIG } from './Config.js';

// Keys that activate a focused button or details toggle by themselves.
const ACTIVATION_CODES = new Set(['Enter', 'NumpadEnter', 'Space']);

const ACTION_KEYS = [
    'UP',
    'DOWN',
    'LEFT',
    'RIGHT',
    'ROLL_LEFT',
    'ROLL_RIGHT',
    'BOOST',
    'SLOWMO',
    'SHOOT',
    'SHOOT_MG',
    'NEXT_ITEM',
    'USE_ITEM',
    'CAMERA',
];

const GLOBAL_ACTION_KEYS = [
    'CINEMATIC_TOGGLE',
    'RECORDING_TOGGLE',
];

const PREVENT_DEFAULT_NATIVE_INPUT_TYPES = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset']);

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

export class InputManager {
    constructor() {
        this._gamepadPause = new GamepadPauseInput();
        this._gamepadPause.setBindings();
        this._gamepadContinue = new GamepadContinueInput(this._gamepadPause);
        this.keys = {};
        this.justPressed = {};
        // "Any key means continue" at round and match end; read via wasPressed('Continue').
        this._continueIntent = false;
        this.bindings = deepClone(CONFIG.KEYS);
        this._preventDefaultCodes = new Set();

        // GC Optimization: Reusable object
        this._reuseInput = {
            pitchUp: false,
            pitchDown: false,
            yawLeft: false,
            yawRight: false,
            rollLeft: false,
            rollRight: false,
            boost: false,
            boostPressed: false,
            slowMo: false,
            slowMoPressed: false,
            cameraSwitch: false,
            dropItem: false,
            useItem: false,
            shootItem: false,
            shootRocket: false,
            nextItem: false,
        };

        /**
         * PlayerInputSource instances indexed by player slot.
         * When a source is assigned for a slot, getPlayerInput() delegates to it.
         * @type {Map<number, import('./input/PlayerInputSource.js').PlayerInputSource>}
         */
        this._playerSources = new Map();

        this._rebuildPreventDefaultCodes();
        this._document = window.document;
        this._onKeyDown = (e) => this._handleKeyDown(e);
        this._onKeyUp = (e) => this._handleKeyUp(e);
        this._onMouseDown = (e) => this._handleMouseDown(e);
        this._onWindowBlur = () => this.clearInputState('window-blur');
        this._onWindowFocus = () => this.clearInputState('window-focus');
        this._onVisibilityChange = () => {
            if (this._document?.hidden === true) {
                this.clearInputState('visibility-hidden');
            }
        };

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('blur', this._onWindowBlur);
        window.addEventListener('focus', this._onWindowFocus);
        this._document?.addEventListener?.('visibilitychange', this._onVisibilityChange);
    }

    /**
     * DOM side of the continue rule: focus and event target are only readable here.
     * The pure rules in ContinueIntentOps only get a finished yes/no.
     */
    _isContinueTargetInteractive(e) {
        if (isInteractiveContinueTarget(e?.target)) return true;
        return isInteractiveContinueTarget(document.activeElement);
    }

    _noteContinueIntentFromKey(e) {
        // An already held key repeats; only the first edge is a decision.
        if (this.keys[e.code]) return;
        if (!isContinueKeyEvent({
            code: e.code,
            key: e.key,
            repeat: e.repeat === true,
            targetIsInteractive: this._isContinueTargetInteractive(e),
        })) return;
        this._continueIntent = true;
    }

    _handleMouseDown(e) {
        // A click is decided by what it lands on, never by what happens to hold the focus:
        // mousedown fires before the focus moves away from a summary opened a moment ago.
        if (!isContinueMouseEvent({
            button: e?.button,
            targetIsInteractive: isInteractiveContinueTarget(e?.target),
        })) return;
        this._continueIntent = true;
    }

    _handleKeyDown(e) {
        this._noteContinueIntentFromKey(e);
        if (this._isTextInputFocused()) return;
        // A button or a details toggle activates on Enter and Space itself; that press belongs
        // to the element, so it must not also arrive as a raw game key (the board reads Enter).
        if (ACTIVATION_CODES.has(e.code) && this._isContinueTargetInteractive(e)) return;
        if (!this.keys[e.code]) {
            this.justPressed[e.code] = true;
        }
        this.keys[e.code] = true;
        if (this._shouldPreventDefault(e.code)) {
            e.preventDefault();
        }
    }

    _handleKeyUp(e) {
        const textInputFocused = this._isTextInputFocused();
        this.keys[e.code] = false;
        // Preserve tap edges until the next input poll so short key taps between frames are not lost.
        if (textInputFocused) return;
        if (this._shouldPreventDefault(e.code)) {
            e.preventDefault();
        }
    }

    setBindings(bindingsByPlayer) {
        this.gamepadControls = bindingsByPlayer;
        this._gamepadPause?.setBindings(bindingsByPlayer);
        // A moved PAUSE button must not turn the button it left behind into a stale edge.
        this._gamepadContinue?.clearInputState();
        this.bindings = {
            PLAYER_1: this._normalizePlayerBindings(bindingsByPlayer?.PLAYER_1, CONFIG.KEYS.PLAYER_1),
            PLAYER_2: this._normalizePlayerBindings(bindingsByPlayer?.PLAYER_2, CONFIG.KEYS.PLAYER_2),
            PLAYER_3: this._normalizePlayerBindings(bindingsByPlayer?.PLAYER_3, CONFIG.KEYS.PLAYER_3),
            GLOBAL: this._normalizeGlobalBindings(bindingsByPlayer?.GLOBAL, CONFIG.KEYS.GLOBAL),
        };
        this._rebuildPreventDefaultCodes();
    }

    getBindings() {
        return deepClone(this.bindings);
    }

    _normalizePlayerBindings(source, fallback) {
        const fromSource = source || {};
        const normalized = {};

        for (const key of ACTION_KEYS) {
            normalized[key] = fromSource[key] || fallback[key];
        }

        return normalized;
    }

    _normalizeGlobalBindings(source, fallback) {
        const fromSource = source || {};
        const base = fallback || {};
        const normalized = {};

        for (const key of GLOBAL_ACTION_KEYS) {
            normalized[key] = fromSource[key] || base[key];
        }

        return normalized;
    }

    _rebuildPreventDefaultCodes() {
        const codes = new Set(['Escape', 'Enter']);

        const addBindingCodes = (bindingSet, actionKeys) => {
            if (!bindingSet) return;
            for (const action of actionKeys) {
                const code = bindingSet[action];
                if (typeof code === 'string' && code.length > 0) {
                    codes.add(code);
                }
            }
        };

        addBindingCodes(this.bindings?.PLAYER_1, ACTION_KEYS);
        addBindingCodes(this.bindings?.PLAYER_2, ACTION_KEYS);
        addBindingCodes(this.bindings?.PLAYER_3, ACTION_KEYS);
        addBindingCodes(this.bindings?.GLOBAL, GLOBAL_ACTION_KEYS);
        this._preventDefaultCodes = codes;
    }

    _shouldPreventDefault(code) {
        if (this._isPreventDefaultGuardedControlFocused()) return false;
        return this._preventDefaultCodes.has(code);
    }

    _isPreventDefaultGuardedControlFocused() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'SELECT' || tag === 'BUTTON') return true;
        if (tag === 'INPUT') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            if (PREVENT_DEFAULT_NATIVE_INPUT_TYPES.has(type)) return true;
        }
        return this._isTextInputFocused();
    }

    _isTextInputFocused() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'TEXTAREA') return true;
        if (tag === 'INPUT') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            return type === 'text' || type === 'search' || type === 'url'
                || type === 'email' || type === 'number' || type === 'password';
        }
        if (el.isContentEditable) return true;
        return false;
    }

    isDown(code) {
        return !!this.keys[code];
    }

    wasPressed(code) {
        if (code === CONTINUE_INTENT_KEY) return this._readContinueIntent();
        const controllerPressed = code === 'Escape' && this._gamepadPause?.wasPressed() === true;
        if (this.justPressed[code]) {
            this.justPressed[code] = false;
            return true;
        }
        return controllerPressed;
    }

    /** True for exactly one frame after a key, click or pad button said "continue". */
    _readContinueIntent() {
        // Poll unconditionally: the pad edge memory must advance every frame.
        const gamepadPressed = this._gamepadContinue?.wasPressed() === true;
        const pressed = this._continueIntent || gamepadPressed;
        this._continueIntent = false;
        return pressed;
    }

    /** Drops a pending continue so a board can open without consuming the press that closed the last one. */
    clearContinueIntent() {
        this._continueIntent = false;
        this._gamepadContinue?.clearInputState();
    }

    clearJustPressed() {
        this.justPressed = {};
    }

    clearInputState(_reason = 'manual') {
        // Optional: tests build InputManager from its prototype without the constructor.
        this._gamepadPause?.clearInputState();
        this.clearContinueIntent();
        this.keys = {};
        this.justPressed = {};
        for (const source of this._playerSources.values()) {
            source.clearInputState?.();
        }
    }

    _resetInput(inputObj) {
        inputObj.pitchUp = false;
        inputObj.pitchDown = false;
        inputObj.yawLeft = false;
        inputObj.yawRight = false;
        inputObj.rollLeft = false;
        inputObj.rollRight = false;
        inputObj.boost = false;
        inputObj.boostPressed = false;
        inputObj.slowMo = false;
        inputObj.slowMoPressed = false;
        inputObj.cameraSwitch = false;
        inputObj.dropItem = false;
        inputObj.useItem = false;
        inputObj.shootItem = false;
        inputObj.shootRocket = false;
        inputObj.shootMG = false;
        inputObj.nextItem = false;
    }

    _isActionDown(primaryCode, secondaryCode = '') {
        if (this.isDown(primaryCode)) {
            return true;
        }
        return !!secondaryCode && this.isDown(secondaryCode);
    }

    _wasActionPressed(primaryCode, secondaryCode = '') {
        let pressed = this.wasPressed(primaryCode);
        if (secondaryCode && secondaryCode !== primaryCode) {
            pressed = this.wasPressed(secondaryCode) || pressed;
        }
        return pressed;
    }

    wasGlobalActionPressed(actionKey) {
        const keyMap = this.bindings?.GLOBAL;
        if (!keyMap) return false;
        const code = keyMap[actionKey];
        if (!code) return false;
        return this._wasActionPressed(code);
    }

    /**
     * Assigns a PlayerInputSource for a given player slot.
     * When assigned, getPlayerInput() delegates to the source's poll() method.
     * @param {number} playerIndex
     * @param {import('./input/PlayerInputSource.js').PlayerInputSource} source
     */
    setPlayerSource(playerIndex, source) {
        const existing = this._playerSources.get(playerIndex);
        if (existing && existing !== source) {
            existing.unbind();
        }
        if (source) {
            source.bind(playerIndex);
            this._playerSources.set(playerIndex, source);
        } else {
            this._playerSources.delete(playerIndex);
        }
    }

    /**
     * Returns the PlayerInputSource for a given slot, or null.
     * @param {number} playerIndex
     * @returns {import('./input/PlayerInputSource.js').PlayerInputSource|null}
     */
    getPlayerSource(playerIndex) {
        return this._playerSources.get(playerIndex) || null;
    }

    /**
     * Removes and disposes all assigned PlayerInputSources.
     */
    clearPlayerSources() {
        for (const source of this._playerSources.values()) {
            source.dispose();
        }
        this._playerSources.clear();
    }

    getKeyboardInput(playerIndex, options = {}) {
        const includeSecondaryBindings = !!options.includeSecondaryBindings && playerIndex === 0;
        const keyMap = this.bindings[`PLAYER_${playerIndex + 1}`] || this.bindings.PLAYER_2;
        const altKeyMap = includeSecondaryBindings ? this.bindings.PLAYER_2 : null;

        // Reset reused object
        this._resetInput(this._reuseInput);

        this._reuseInput.pitchUp = this._isActionDown(keyMap.UP, altKeyMap?.UP || '');
        this._reuseInput.pitchDown = this._isActionDown(keyMap.DOWN, altKeyMap?.DOWN || '');
        this._reuseInput.yawLeft = this._isActionDown(keyMap.LEFT, altKeyMap?.LEFT || '');
        this._reuseInput.yawRight = this._isActionDown(keyMap.RIGHT, altKeyMap?.RIGHT || '');
        this._reuseInput.rollLeft = this._isActionDown(keyMap.ROLL_LEFT, altKeyMap?.ROLL_LEFT || '');
        this._reuseInput.rollRight = this._isActionDown(keyMap.ROLL_RIGHT, altKeyMap?.ROLL_RIGHT || '');
        this._reuseInput.boost = this._isActionDown(keyMap.BOOST, altKeyMap?.BOOST || '');
        this._reuseInput.boostPressed = this._wasActionPressed(keyMap.BOOST, altKeyMap?.BOOST || '');
        this._reuseInput.slowMo = this._isActionDown(keyMap.SLOWMO, altKeyMap?.SLOWMO || '');
        this._reuseInput.slowMoPressed = this._wasActionPressed(keyMap.SLOWMO, altKeyMap?.SLOWMO || '');
        this._reuseInput.cameraSwitch = this._wasActionPressed(keyMap.CAMERA, altKeyMap?.CAMERA || '');
        this._reuseInput.useItem = this._wasActionPressed(keyMap.USE_ITEM, altKeyMap?.USE_ITEM || '');
        // The shoot key fires the next queued rocket; every item action runs through USE_ITEM.
        this._reuseInput.shootRocket = this._wasActionPressed(keyMap.SHOOT, altKeyMap?.SHOOT || '');
        this._reuseInput.shootMG = this._isActionDown(keyMap.SHOOT_MG, altKeyMap?.SHOOT_MG || '');
        this._reuseInput.nextItem = this._wasActionPressed(keyMap.NEXT_ITEM, altKeyMap?.NEXT_ITEM || '');

        return this._reuseInput;
    }

    getPlayerInput(playerIndex, options = {}) {
        // Delegate to assigned PlayerInputSource if available
        const source = this._playerSources.get(playerIndex);
        if (source) {
            // Options carry the fixed step of the caller: a source that integrates over
            // time (the network guest ramp) must never read a clock of its own.
            const polled = source.poll(options);
            if (polled) return polled;
        }

        // Fallback: keyboard bindings (original behavior)
        return this.getKeyboardInput(playerIndex, options);
    }

    dispose() {
        this.clearPlayerSources();
        if (this._onKeyDown) {
            window.removeEventListener('keydown', this._onKeyDown);
            this._onKeyDown = null;
        }
        if (this._onKeyUp) {
            window.removeEventListener('keyup', this._onKeyUp);
            this._onKeyUp = null;
        }
        if (this._onMouseDown) {
            window.removeEventListener('mousedown', this._onMouseDown);
            this._onMouseDown = null;
        }
        if (this._onWindowBlur) {
            window.removeEventListener('blur', this._onWindowBlur);
            this._onWindowBlur = null;
        }
        if (this._onWindowFocus) {
            window.removeEventListener('focus', this._onWindowFocus);
            this._onWindowFocus = null;
        }
        if (this._onVisibilityChange) {
            this._document?.removeEventListener?.('visibilitychange', this._onVisibilityChange);
            this._onVisibilityChange = null;
        }
        this._document = null;
        this.keys = {};
        this.justPressed = {};
    }
}
