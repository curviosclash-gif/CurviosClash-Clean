// The bloom_core preset opens its last ring at this time, and the Arcade escape scenario on
// that map lasts exactly as long. The renderer build keeps this module in the map-presets
// chunk; an import from an Arcade module would tie that chunk back to game-runtime.
export const BLOOM_CORE_FINAL_OPEN_SECONDS = 105;
