import { ThreePlayerSplitModule } from '../../four-player-planar/ThreePlayerSplitModule.js';
import { ThreePlayerSplitHudView } from '../../ui/four-player-planar/ThreePlayerSplitHudView.js';
import { ThreePlayerSplitSetupView } from '../../ui/four-player-planar/ThreePlayerSplitSetupView.js';
import { CONFIG } from '../../core/Config.js';

export function createThreePlayerSplitModule({ runtimePort, documentRef = globalThis.document }) {
    return new ThreePlayerSplitModule({
        runtimePort,
        setupView: new ThreePlayerSplitSetupView({ documentRef }),
        hudView: new ThreePlayerSplitHudView({ documentRef }),
        mapDefinitions: CONFIG.MAPS,
    });
}
