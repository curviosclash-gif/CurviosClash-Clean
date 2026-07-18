import { TOUCH_CONTROL_MODES, TouchInputSource } from './TouchInputSource.js';
import { normalizeMobileClassicControlSettings } from '../shared/contracts/MobileClassicControlsContract.js';

const GAMEPAD_DEADZONE = 0.15;
const MOUSE_STEERING_DEADZONE = 0.08;
const GAMEPAD_MAPPING = Object.freeze({
    pitchAxis: 1,
    yawAxis: 0,
    rollAxis: 2,
    fireButton: 7,
    boostButton: 0,
    shootMGButton: 6,
    nextItemButton: 3,
    useItemButton: 2,
    cameraButton: 1,
});

function isMobileClassicTarget(game = null) {
    const doc = typeof document !== 'undefined' ? document : null;
    return game?._mobileClassicAppTarget === true
        || doc?.documentElement?.dataset?.appTarget === 'mobile-classic';
}

function isMobileArcadeTarget(game = null) {
    const doc = typeof document !== 'undefined' ? document : null;
    return game?._mobileArcadeAppTarget === true
        || doc?.documentElement?.dataset?.appTarget === 'mobile-arcade';
}

function isMobileArcadeMode(game = null) {
    const modePath = String(game?.settings?.localSettings?.modePath || '').trim().toLowerCase();
    const doc = typeof document !== 'undefined' ? document : null;
    return modePath === 'arcade'
        || doc?.documentElement?.dataset?.mobileModePath === 'arcade';
}

function createKeyboardInputSource(inputManager, includeSecondaryBindings = false, options = {}) {
    const keyboardPlayerIndex = Number.isInteger(options.keyboardPlayerIndex)
        ? Math.max(0, options.keyboardPlayerIndex)
        : null;
    return {
        type: 'keyboard',
        playerIndex: -1,
        active: false,
        bind(playerIndex) {
            this.playerIndex = playerIndex;
            this.active = true;
        },
        unbind() {
            this.playerIndex = -1;
            this.active = false;
        },
        poll() {
            if (!inputManager || this.playerIndex < 0) return null;
            const inputPlayerIndex = keyboardPlayerIndex ?? this.playerIndex;
            return inputManager.getKeyboardInput(inputPlayerIndex, { includeSecondaryBindings });
        },
        dispose() {
            this.unbind();
        },
    };
}

function createGamepadInputSource(gamepadIndex = 0) {
    return {
        type: 'gamepad',
        playerIndex: -1,
        active: false,
        gamepadIndex,
        deadzone: GAMEPAD_DEADZONE,
        _prevButtons: {},
        bind(playerIndex) {
            this.playerIndex = playerIndex;
            this.active = true;
        },
        unbind() {
            this.playerIndex = -1;
            this.active = false;
        },
        _getGamepad() {
            if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
            return navigator.getGamepads()[this.gamepadIndex] || null;
        },
        isConnected() {
            return !!this._getGamepad();
        },
        _axis(value) {
            return Math.abs(value) >= this.deadzone ? value : 0;
        },
        _buttonDown(gamepad, buttonIndex) {
            if (!gamepad || buttonIndex < 0 || buttonIndex >= gamepad.buttons.length) return false;
            return gamepad.buttons[buttonIndex].pressed === true;
        },
        _buttonPressed(gamepad, buttonIndex) {
            const down = this._buttonDown(gamepad, buttonIndex);
            const wasDown = !!this._prevButtons[buttonIndex];
            this._prevButtons[buttonIndex] = down;
            return down && !wasDown;
        },
        poll() {
            const gamepad = this._getGamepad();
            if (!gamepad) {
                return null;
            }

            const pitch = this._axis(gamepad.axes[GAMEPAD_MAPPING.pitchAxis] || 0);
            const yaw = this._axis(gamepad.axes[GAMEPAD_MAPPING.yawAxis] || 0);
            const roll = this._axis(gamepad.axes[GAMEPAD_MAPPING.rollAxis] || 0);

            return {
                pitchUp: pitch < -this.deadzone,
                pitchDown: pitch > this.deadzone,
                yawLeft: yaw < -this.deadzone,
                yawRight: yaw > this.deadzone,
                rollLeft: roll < -this.deadzone,
                rollRight: roll > this.deadzone,
                pitchAxis: -pitch,
                yawAxis: -yaw,
                rollAxis: -roll,
                boost: this._buttonDown(gamepad, GAMEPAD_MAPPING.boostButton),
                boostPressed: this._buttonPressed(gamepad, GAMEPAD_MAPPING.boostButton),
                cameraSwitch: this._buttonPressed(gamepad, GAMEPAD_MAPPING.cameraButton),
                dropItem: false,
                useItem: this._buttonPressed(gamepad, GAMEPAD_MAPPING.useItemButton),
                shootItem: this._buttonPressed(gamepad, GAMEPAD_MAPPING.fireButton),
                shootMG: this._buttonDown(gamepad, GAMEPAD_MAPPING.shootMGButton),
                nextItem: this._buttonPressed(gamepad, GAMEPAD_MAPPING.nextItemButton),
            };
        },
        dispose() {
            this._prevButtons = {};
            this.unbind();
        },
    };
}

function normalizeMouseSteeringAxis(value) {
    const clamped = Math.max(-1, Math.min(1, Number(value) || 0));
    const magnitude = Math.abs(clamped);
    if (magnitude <= MOUSE_STEERING_DEADZONE) return 0;
    return Math.sign(clamped) * ((magnitude - MOUSE_STEERING_DEADZONE) / (1 - MOUSE_STEERING_DEADZONE));
}

export function createMouseSteeringInputSource(inputManager, includeSecondaryBindings = false, options = {}) {
    const keyboardPlayerIndex = Number.isInteger(options.keyboardPlayerIndex)
        ? Math.max(0, options.keyboardPlayerIndex)
        : null;
    const output = {};
    let target = null;
    let pointerActive = false;
    let pitchAxis = 0;
    let yawAxis = 0;

    const resetPointer = () => {
        pointerActive = false;
        pitchAxis = 0;
        yawAxis = 0;
    };
    const handlePointerMove = (event) => {
        if (event?.pointerType === 'touch') return;
        const rect = target?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            resetPointer();
            return;
        }
        pointerActive = true;
        yawAxis = normalizeMouseSteeringAxis((rect.left + rect.width / 2 - event.clientX) / (rect.width / 2));
        pitchAxis = normalizeMouseSteeringAxis((rect.top + rect.height / 2 - event.clientY) / (rect.height / 2));
    };

    return {
        type: 'mouse',
        playerIndex: -1,
        active: false,
        bind(playerIndex) {
            this.unbind();
            this.playerIndex = playerIndex;
            this.active = true;
            target = options.target || globalThis.document?.getElementById?.('game-canvas');
            target?.addEventListener?.('pointermove', handlePointerMove);
            target?.addEventListener?.('pointerleave', resetPointer);
            globalThis.window?.addEventListener?.('blur', resetPointer);
        },
        unbind() {
            target?.removeEventListener?.('pointermove', handlePointerMove);
            target?.removeEventListener?.('pointerleave', resetPointer);
            globalThis.window?.removeEventListener?.('blur', resetPointer);
            target = null;
            resetPointer();
            this.playerIndex = -1;
            this.active = false;
        },
        poll() {
            if (!inputManager || this.playerIndex < 0) return null;
            const inputPlayerIndex = keyboardPlayerIndex ?? this.playerIndex;
            const keyboardInput = inputManager.getKeyboardInput(inputPlayerIndex, { includeSecondaryBindings });
            if (!pointerActive) return keyboardInput;
            Object.assign(output, keyboardInput);
            output.pitchAxis = pitchAxis;
            output.yawAxis = yawAxis;
            return output;
        },
        dispose() {
            this.unbind();
        },
    };
}

function createGamepadWithTouchFallback(gamepadSource, touchSource) {
    let touchUiCreated = false;
    let touchActive = false;

    function setTouchActive(active) {
        if (active === touchActive) return;
        if (active) {
            if (!touchUiCreated) {
                touchSource.createUI();
                touchUiCreated = true;
            }
            touchSource.onMatchStart();
        } else {
            touchSource.onMatchEnd();
        }
        touchActive = active;
    }

    return {
        type: 'gamepad',
        playerIndex: -1,
        active: false,
        bind(playerIndex) {
            this.playerIndex = playerIndex;
            this.active = true;
            gamepadSource.bind(playerIndex);
            touchSource.bind(playerIndex);
        },
        unbind() {
            setTouchActive(false);
            gamepadSource.unbind();
            touchSource.unbind();
            this.playerIndex = -1;
            this.active = false;
        },
        poll() {
            const gamepadInput = gamepadSource.poll();
            setTouchActive(!gamepadInput);
            return gamepadInput || touchSource.poll();
        },
        clearInputState() {
            touchSource.clearInputState?.();
        },
        dispose() {
            setTouchActive(false);
            gamepadSource.dispose();
            touchSource.dispose();
            this.playerIndex = -1;
            this.active = false;
        },
    };
}

export function createPreferredMatchInputSource({
    inputManager,
    playerIndex,
    localHumanCount,
    inputDeviceIndex = playerIndex,
    game = null,
    getMatchRuntimeProjection = null,
}) {
    if (!inputManager) return null;

    const resolvedInputDeviceIndex = Number.isInteger(inputDeviceIndex)
        ? Math.max(0, inputDeviceIndex)
        : Math.max(0, Number(inputDeviceIndex) || 0);
    const touchAvailable = resolvedInputDeviceIndex === 0 && TouchInputSource.isAvailable();
    const mobileClassic = touchAvailable && isMobileClassicTarget(game);
    const mobileArcade = touchAvailable && isMobileArcadeTarget(game);
    const mobileArcadeMode = mobileArcade || (mobileClassic && isMobileArcadeMode(game));
    const createTouchSource = () => new TouchInputSource({
        game,
        playerIndex,
        getMatchRuntimeProjection,
        controlMode: (mobileClassic || mobileArcade) ? TOUCH_CONTROL_MODES.TILT : TOUCH_CONTROL_MODES.JOYSTICK,
        includePauseButton: mobileClassic || mobileArcadeMode,
        mobileControls: normalizeMobileClassicControlSettings(game?.settings?.localSettings?.mobileControls),
    });
    if (resolvedInputDeviceIndex === 0
        && !touchAvailable
        && game?.settings?.localSettings?.mouseSteering === true) {
        return createMouseSteeringInputSource(
            inputManager,
            localHumanCount === 1,
            { keyboardPlayerIndex: 0 }
        );
    }
    const gamepadSource = createGamepadInputSource(resolvedInputDeviceIndex);
    if (gamepadSource.isConnected()) {
        return touchAvailable
            ? createGamepadWithTouchFallback(gamepadSource, createTouchSource())
            : gamepadSource;
    }
    gamepadSource.dispose();

    if (touchAvailable) {
        const touchSource = createTouchSource();
        touchSource.createUI();
        touchSource.onMatchStart();
        return touchSource;
    }

    return createKeyboardInputSource(
        inputManager,
        resolvedInputDeviceIndex === 0 && localHumanCount === 1,
        { keyboardPlayerIndex: resolvedInputDeviceIndex }
    );
}
