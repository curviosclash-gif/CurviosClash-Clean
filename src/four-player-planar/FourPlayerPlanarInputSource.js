import { resolveInventoryActionAvailability } from '../shared/contracts/GameplayActionAvailabilityContract.js';
import {
    FOUR_PLAYER_PLANAR_KEY_BINDINGS,
    FOUR_PLAYER_PLANAR_MODES,
} from './FourPlayerPlanarContract.js';

function resetInput(input) {
    input.pitchAxis = 0;
    input.yawAxis = 0;
    input.rollAxis = 0;
    input.pitchUp = false;
    input.pitchDown = false;
    input.yawLeft = false;
    input.yawRight = false;
    input.rollLeft = false;
    input.rollRight = false;
    input.boost = false;
    input.boostPressed = false;
    input.cameraSwitch = false;
    input.dropItem = false;
    input.useItem = false;
    input.shootItem = false;
    input.shootMG = false;
    input.nextItem = false;
    return input;
}

export function resolvePreferredFourPlayerPlanarAction(availability, mode = FOUR_PLAYER_PLANAR_MODES.CLASSIC) {
    if (!availability.hasItem) return { useItem: false, shootItem: false };

    const preferShoot = mode === FOUR_PLAYER_PLANAR_MODES.HUNT;
    if (preferShoot && availability.canShootNow) return { useItem: false, shootItem: true };
    if (!preferShoot && availability.canUseNow) return { useItem: true, shootItem: false };
    if (availability.canUseNow) return { useItem: true, shootItem: false };
    if (availability.canShootNow) return { useItem: false, shootItem: true };
    return { useItem: false, shootItem: false };
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
} = {}) {
    const binding = FOUR_PLAYER_PLANAR_KEY_BINDINGS[playerIndex];
    if (!inputManager || !binding) return null;
    const output = resetInput({});

    return {
        type: 'four-player-planar-keyboard',
        playerIndex: -1,
        active: false,
        bind(index) {
            this.playerIndex = index;
            this.active = true;
        },
        unbind() {
            this.playerIndex = -1;
            this.active = false;
            resetInput(output);
        },
        clearInputState() {
            resetInput(output);
        },
        poll() {
            resetInput(output);
            if (!this.active) return output;
            output.yawLeft = inputManager.isDown(binding.left);
            output.yawRight = inputManager.isDown(binding.right);
            output.yawAxis = (output.yawLeft ? 1 : 0) - (output.yawRight ? 1 : 0);
            if (inputManager.wasPressed(binding.action)) {
                const action = resolveFourPlayerPlanarContextAction(
                    typeof getPlayer === 'function' ? getPlayer() : null,
                    typeof getMode === 'function' ? getMode() : FOUR_PLAYER_PLANAR_MODES.CLASSIC
                );
                output.useItem = action.useItem;
                output.shootItem = action.shootItem;
            }
            return output;
        },
        dispose() {
            this.unbind();
        },
    };
}
