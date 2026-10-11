import { applyBotOpenFaceReturn } from './BotOpenFaceReturnOps.js';
import { SoloFlightController } from './SoloFlightController.js';

export class BotFlightSafety {
    constructor() {
        this.byPlayer = new Map();
    }

    reset() {
        this.byPlayer.clear();
    }

    apply(action, dt, player, runtimeContext) {
        if (applyBotOpenFaceReturn(action, player, runtimeContext?.arena)) return action;
        let controller = this.byPlayer.get(player);
        if (!controller) {
            controller = new SoloFlightController();
            this.byPlayer.set(player, controller);
        }
        return controller.update(action, dt, player, runtimeContext);
    }
}
