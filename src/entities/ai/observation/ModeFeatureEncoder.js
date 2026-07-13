// ============================================
// ModeFeatureEncoder.js - stable mode ID features for bot observations
// ============================================

import {
    MODE_ID_CLASSIC,
    MODE_ID_HUNT,
    encodeModeId,
} from '../../../shared/contracts/EntityModeContract.js';
export { MODE_ID_CLASSIC, MODE_ID_HUNT, encodeModeId };

export function writeModeFeatures(mode, target = [0, 0, 0], offset = 0) {
    const modeId = encodeModeId(mode);
    target[offset] = modeId;
    target[offset + 1] = modeId === MODE_ID_CLASSIC ? 1 : 0;
    target[offset + 2] = modeId === MODE_ID_HUNT ? 1 : 0;
    return target;
}
