import { normalizeHangarBuild } from './HangarBuildDraftState.js';

export const HANGAR_STARTER_BUILDS = Object.freeze([
    Object.freeze({ id: 'sprinter', label: 'Sprinter', description: 'Tempo und geringes Gewicht' }),
    Object.freeze({ id: 'turn_fighter', label: 'Kurvenjäger', description: 'Maximale Kontrolle' }),
    Object.freeze({ id: 'tank', label: 'Tank', description: 'Struktur und Schutz' }),
    Object.freeze({ id: 'efficient', label: 'Energiesparer', description: 'Wenig Energie und Hitze' }),
]);

const SLOT_PRESETS = Object.freeze({
    sprinter: Object.freeze({
        core: 'stone_blue_t1', nose: 'stone_blue_t1', wing_left: 'stone_green_t1', wing_right: 'stone_green_t1',
        engine_left: 'stone_cyan_t1', engine_right: 'stone_cyan_t1', utility: null,
    }),
    turn_fighter: Object.freeze({
        core: 'stone_green_t1', nose: 'stone_green_t1', wing_left: 'stone_blue_t1', wing_right: 'stone_blue_t1',
        engine_left: 'stone_cyan_t1', engine_right: 'stone_cyan_t1', utility: null,
    }),
    tank: Object.freeze({
        core: 'stone_gold_t1', nose: 'stone_gold_t1', wing_left: 'stone_green_t1', wing_right: 'stone_green_t1',
        engine_left: 'stone_cyan_t1', engine_right: 'stone_cyan_t1', utility: 'stone_violet_t1',
    }),
    efficient: Object.freeze({
        core: 'stone_cyan_t1', nose: 'stone_cyan_t1', wing_left: 'stone_green_t1', wing_right: 'stone_green_t1',
        engine_left: 'stone_blue_t1', engine_right: 'stone_blue_t1', utility: null,
    }),
});

export function createHangarStarterBuild(build, presetId, level = 1) {
    const preset = HANGAR_STARTER_BUILDS.find((entry) => entry.id === presetId);
    const slots = SLOT_PRESETS[presetId];
    if (!preset || !slots) return null;
    const nextSlots = { ...slots };
    if (presetId === 'tank' && Number(level) < 5) nextSlots.utility = null;
    return normalizeHangarBuild({
        ...build,
        name: `${preset.label} Build`,
        slots: nextSlots,
        tags: [...new Set([...(build?.tags || []), 'starter', preset.id])],
    });
}
