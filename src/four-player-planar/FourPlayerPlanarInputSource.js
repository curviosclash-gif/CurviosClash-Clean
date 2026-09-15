import { resolveInventoryActionAvailability } from '../shared/contracts/GameplayActionAvailabilityContract.js';
import { createGamepadInputSource } from '../shared/input/GamepadInputSource.js';
import { isGamepadInputEnabled } from '../shared/contracts/GamepadControlsContract.js';
import {
    FOUR_PLAYER_PLANAR_KEY_BINDINGS,
    FOUR_PLAYER_PLANAR_MODES,
    FOUR_PLAYER_PLANAR_ROLL_BINDINGS,
} from './FourPlayerPlanarContract.js';

function resetInput(input) {
    // Keys are digital: the axes stay undefined so the booleans go through the
    // steering ramp like every other keyboard source.
    input.pitchAxis = undefined;
    input.yawAxis = undefined;
    input.rollAxis = undefined;
    input.pitchUp = false;
    input.pitchDown = false;
    input.yawLeft = false;
    input.yawRight = false;
    input.rollLeft = false;
    input.rollRight = false;
    input.boost = false;
    input.boostPressed = false;
    input.slowMo = false;
    input.slowMoPressed = false;
    input.cameraSwitch = false;
    input.dropItem = false;
    input.useItem = false;
    input.shootItem = false;
    input.shootRocket = false;
    input.shootMG = false;
    input.nextItem = false;
    return input;
}

export function resolvePreferredFourPlayerPlanarAction(availability, mode = FOUR_PLAYER_PLANAR_MODES.CLASSIC) {
    const none = { useItem: false, shootItem: false, shootRocket: false };
    if (!availability.hasItem && !availability.hasRocket) return none;

    // One context key: Hunt reaches for the next rocket first, other modes for the selected item.
    const rocket = { useItem: false, shootItem: false, shootRocket: true };
    const item = { useItem: true, shootItem: false, shootRocket: false };
    if (mode === FOUR_PLAYER_PLANAR_MODES.HUNT && availability.canShootRocketNow) return rocket;
    if (availability.canUseNow) return item;
    if (availability.canShootRocketNow) return rocket;
    return none;
}

export function resolveFourPlayerPlanarContextAction(player, mode = FOUR_PLAYER_PLANAR_MODES.CLASSIC) {
    const modeType = mode === FOUR_PLAYER_PLANAR_MODES.HUNT ? 'HUNT' : 'CLASSIC';
    return resolvePreferredFourPlayerPlanarAction(
        resolveInventoryActionAvailability({ player, modeType }),
        mode
    );
}

export function createFourPlayerPlanarInputSource({
    inputManager,
    playerIndex,
    getPlayer,
    getMode,
    rollBinding = null,
} = {}) {
    const binding = FOUR_PLAYER_PLANAR_KEY_BINDINGS[playerIndex];
    const resolvedRollBinding = rollBinding || FOUR_PLAYER_PLANAR_ROLL_BINDINGS[playerIndex];
    if (!inputManager || !binding || !resolvedRollBinding) return null;
    const output = resetInput({});
    const gamepad = createGamepadInputSource(
        playerIndex,
        () => inputManager.gamepadControls?.[`GAMEPAD_${playerIndex + 1}`],
        () => isGamepadInputEnabled(inputManager.gamepadControls)
    );

    return {
        type: 'four-player-planar-keyboard',
        playerIndex: -1,
        active: false,
        bind(index) {
            gamepad.bind(index);
            this.playerIndex = index;
            this.active = true;
        },
        unbind() {
            gamepad.unbind();
            this.playerIndex = -1;
            this.active = false;
            resetInput(output);
        },
        clearInputState() {
            gamepad.clearInputState();
            resetInput(output);
        },
        poll() {
            resetInput(output);
            if (!this.active) return output;
            const controllerInput = gamepad.poll();
            output.yawLeft = inputManager.isDown(binding.left);
            output.yawRight = inputManager.isDown(binding.right);
            output.rollLeft = inputManager.isDown(resolvedRollBinding.left);
            output.rollRight = inputManager.isDown(resolvedRollBinding.right);
            if (controllerInput) {
                output.yawLeft = controllerInput.yawLeft; output.yawRight = controllerInput.yawRight;
                output.yawAxis = controllerInput.yawAxis;
                output.rollLeft = controllerInput.rollLeft; output.rollRight = controllerInput.rollRight;
                output.rollAxis = controllerInput.rollAxis;
            }
            if (inputManager.wasPressed(binding.action) || controllerInput?.useItem || controllerInput?.shootRocket) {
                const action = resolveFourPlayerPlanarContextAction(
                    typeof getPlayer === 'function' ? getPlayer() : null,
                    typeof getMode === 'function' ? getMode() : FOUR_PLAYER_PLANAR_MODES.CLASSIC
                );
                output.useItem = action.useItem;
                output.shootItem = action.shootItem;
                output.shootRocket = action.shootRocket;
            }
            return output;
        },
        dispose() {
            gamepad.dispose();
            this.unbind();
        },
    };
}
