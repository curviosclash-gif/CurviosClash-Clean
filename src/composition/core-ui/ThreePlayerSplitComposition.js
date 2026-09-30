import { ThreePlayerSplitModule } from '../../four-player-planar/ThreePlayerSplitModule.js';
import { ThreePlayerSplitHudView } from '../../ui/four-player-planar/ThreePlayerSplitHudView.js';

export function createThreePlayerSplitModule({ runtimePort, documentRef = globalThis.document }) {
    return new ThreePlayerSplitModule({
        runtimePort,
        hudView: new ThreePlayerSplitHudView({ documentRef }),
    });
}
