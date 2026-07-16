import { GENERATED_LOCAL_MAPS } from '../../../entities/GeneratedLocalMaps.js';

export function createGeneratedMapPresets(generatedLocalMaps = GENERATED_LOCAL_MAPS) {
    return Object.freeze({ ...generatedLocalMaps });
}

export const MAP_PRESETS_GENERATED = createGeneratedMapPresets();
