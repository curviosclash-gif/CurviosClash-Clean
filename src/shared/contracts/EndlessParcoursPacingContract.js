// One course clock for generated areas, difficulty and flight objectives.
export const ENDLESS_PARCOURS_AREA_METERS = 600;

export function resolveEndlessAreaBlock(station, introEndStation = 120) {
    const distance = Math.max(0, (Number(station) || 0) - (Number(introEndStation) || 0));
    return Math.floor((distance + 1e-7) / ENDLESS_PARCOURS_AREA_METERS);
}

export function resolveEndlessAreaTier(areaBlock) {
    const block = Math.max(0, Math.floor(Number(areaBlock) || 0));
    return block >= 15 ? 4 : block >= 8 ? 3 : block >= 3 ? 2 : 1;
}

export function resolveEndlessAreaThreat(areaBlock) {
    return ['INTRO', 'EASY', 'NORMAL', 'HARD', 'ONSLAUGHT'][resolveEndlessAreaTier(areaBlock)];
}
