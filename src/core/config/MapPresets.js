import { MAP_PRESETS_BASE } from './maps/MapPresetsBase.js';
import { MAP_PRESETS_EXPERT } from './maps/MapPresetsExpert.js';
import { MAP_PRESETS_GENERATED } from './maps/MapPresetsGenerated.js';

export const MAP_PRESETS = {
    ...MAP_PRESETS_BASE,
    ...MAP_PRESETS_EXPERT,
    ...MAP_PRESETS_GENERATED,
};

