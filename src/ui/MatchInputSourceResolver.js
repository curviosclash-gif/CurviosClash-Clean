import { createGamepadInputSource, mergeGamepadWithKeyboard } from '../shared/input/GamepadInputSource.js';
import { isGamepadInputEnabled, resolveSplitscreenInputDevice } from '../shared/contracts/GamepadControlsContract.js';
import { TOUCH_CONTROL_MODES, TouchInputSource } from './TouchInputSource.js';
import { normalizeMobileClassicControlSettings } from '../shared/contracts/MobileClassicControlsContract.js';
import { applyAxisDeadzone } from '../shared/utils/InputAxisOps.js';

const MOUSE_STEERING_DEADZONE = 0.08;
const DISCONNECTED_CONTROLLER_INPUT = Object.freeze({
    pitchAxis: 0, yawAxis: 0, rollAxis: 0,
    pitchUp: false, pitchDown: false, yawLeft: false, yawRight: false, rollLeft: false, rollRight: false,
    boost: false, boostPressed: false, slowMo: false, slowMoPressed: false, cameraSwitch: false,
    useItem: false, nextItem: false, shootMG: false, shootRocket: false, shootItem: false, dropItem: false,
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

function normalizeMouseSteeringAxis(value) {
    return applyAxisDeadzone(value, MOUSE_STEERING_DEADZONE);
}

export function createMouseSteeringInputSource(inputManager, includeSecondaryBindings = false, options = {}) {
    const keyboardPlayerIndex = Number.isInteger(options.keyboardPlayerIndex)
        ? Math.max(0, options.keyboardPlayerIndex)
        : null;
    const output = {};
    let target = null;
    let previousCursor = '';
    let pointerActive = false;
    let pitchAxis = 0;
    let yawAxis = 0;
    let mgDown = false;
    let mgPressed = false;
    let rocketPressed = false;
    let useItemPressed = false;
    let itemScrollPending = false;

    const resetPointer = () => {
        pointerActive = false;
        pitchAxis = 0;
        yawAxis = 0;
        mgDown = false;
        mgPressed = false;
        rocketPressed = false;
        useItemPressed = false;
        itemScrollPending = false;
    };
    const handleMouseDown = (event) => {
        if (event.button === 2) {
            mgDown = true;
            mgPressed = true;
        } else if (event.button === 1) {
            rocketPressed = true;
        } else if (event.button === 0) {
            useItemPressed = true;
        } else return;
        event.preventDefault();
    };
    const handleMouseUp = (event) => {
        if (event.button === 2) mgDown = false;
    };
    const handleWheel = (event) => {
        if (!event.deltaY) return;
        itemScrollPending = true;
        event.preventDefault();
    };
    const handleContextMenu = (event) => event.preventDefault();
    const handleAuxClick = (event) => {
        if (event.button === 1) event.preventDefault();
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
            if (target?.style) {
                previousCursor = target.style.cursor;
                // Keep the cursor visible on the separate menu and pause overlays.
                target.style.cursor = 'none';
            }
            target?.addEventListener?.('pointermove', handlePointerMove);
            target?.addEventListener?.('pointerleave', resetPointer);
            target?.addEventListener?.('mousedown', handleMouseDown);
            target?.addEventListener?.('mouseup', handleMouseUp);
            target?.addEventListener?.('auxclick', handleAuxClick);
            target?.addEventListener?.('contextmenu', handleContextMenu);
            target?.addEventListener?.('wheel', handleWheel, { passive: false });
            globalThis.window?.addEventListener?.('blur', resetPointer);
        },
        unbind() {
            target?.removeEventListener?.('pointermove', handlePointerMove);
            target?.removeEventListener?.('pointerleave', resetPointer);
            target?.removeEventListener?.('mousedown', handleMouseDown);
            target?.removeEventListener?.('mouseup', handleMouseUp);
            target?.removeEventListener?.('auxclick', handleAuxClick);
            target?.removeEventListener?.('contextmenu', handleContextMenu);
            target?.removeEventListener?.('wheel', handleWheel);
            globalThis.window?.removeEventListener?.('blur', resetPointer);
            if (target?.style) target.style.cursor = previousCursor;
            target = null;
            resetPointer();
            this.playerIndex = -1;
            this.active = false;
        },
        poll() {
            if (!inputManager || this.playerIndex < 0) return null;
            const inputPlayerIndex = keyboardPlayerIndex ?? this.playerIndex;
            const keyboardInput = inputManager.getKeyboardInput(inputPlayerIndex, { includeSecondaryBindings });
            if (!pointerActive && !mgDown && !mgPressed && !rocketPressed && !useItemPressed && !itemScrollPending) return keyboardInput;
            Object.assign(output, keyboardInput);
            if (pointerActive) {
                output.pitchAxis = pitchAxis;
                output.yawAxis = yawAxis;
            }
            output.shootMG = !!keyboardInput.shootMG || mgDown || mgPressed;
            output.shootItem = !!keyboardInput.shootItem;
            output.shootRocket = !!keyboardInput.shootRocket || rocketPressed;
            output.useItem = !!keyboardInput.useItem || useItemPressed;
            output.nextItem = !!keyboardInput.nextItem || itemScrollPending;
            mgPressed = false;
            rocketPressed = false;
            useItemPressed = false;
            itemScrollPending = false;
            return output;
        },
        clearInputState: resetPointer,
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
    assignedInputDevice = null,
    game = null,
    getMatchRuntimeProjection = null,
}) {
    if (!inputManager) return null;

    const resolvedInputDeviceIndex = Number.isInteger(inputDeviceIndex)
        ? Math.max(0, inputDeviceIndex)
        : Math.max(0, Number(inputDeviceIndex) || 0);
    const assignedDevice = assignedInputDevice || (localHumanCount === 2
        ? resolveSplitscreenInputDevice(game?.settings?.controls?.SPLITSCREEN?.layout, resolvedInputDeviceIndex)
        : null);
    if (assignedDevice?.type === 'keyboard') {
        return createKeyboardInputSource(inputManager, false, { keyboardPlayerIndex: Math.min(resolvedInputDeviceIndex, 1) });
    }
    const gamepadEnabled = () => isGamepadInputEnabled(game?.settings?.controls);
    if (assignedDevice?.type === 'gamepad') {
        const controlKey = `GAMEPAD_${assignedDevice.gamepadIndex + 1}`;
        const source = createGamepadInputSource(assignedDevice.gamepadIndex, () => game?.settings?.controls?.[controlKey], gamepadEnabled);
        const poll = source.poll.bind(source);
        const threePlayerAssignment = localHumanCount === 3 && assignedInputDevice?.type === 'gamepad';
        // Three-player slots must never share the two available keyboard bindings.
        source.poll = () => poll() || (threePlayerAssignment || gamepadEnabled() ? DISCONNECTED_CONTROLLER_INPUT : null);
        return source;
    }
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
    const gamepadSource = createGamepadInputSource(resolvedInputDeviceIndex, () => game?.settings?.controls?.[`GAMEPAD_${resolvedInputDeviceIndex + 1}`], gamepadEnabled);
    if (!touchAvailable) {
        const keyboardSource = createKeyboardInputSource(inputManager, resolvedInputDeviceIndex === 0 && localHumanCount === 1, { keyboardPlayerIndex: resolvedInputDeviceIndex });
        const mergedInput = {};
        return {
            playerIndex: -1, active: false, gamepadIndex: resolvedInputDeviceIndex,
            get type() { return gamepadSource.isConnected() ? 'gamepad' : 'keyboard'; },
            bind(index) { this.playerIndex = index; this.active = true; gamepadSource.bind(index); keyboardSource.bind(index); },
            unbind() { this.playerIndex = -1; this.active = false; gamepadSource.unbind(); keyboardSource.unbind(); },
            poll() {
                const pad = gamepadSource.poll();
                const keys = keyboardSource.poll();
                return pad && keys ? mergeGamepadWithKeyboard(pad, keys, mergedInput) : (pad || keys);
            },
            clearInputState() { gamepadSource.clearInputState(); },
            dispose() { this.unbind(); gamepadSource.dispose(); keyboardSource.dispose(); },
        };
    }
    if (gamepadSource.isConnected()) return createGamepadWithTouchFallback(gamepadSource, createTouchSource());
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
