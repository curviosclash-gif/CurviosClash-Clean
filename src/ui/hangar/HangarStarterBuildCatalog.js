import { normalizeHangarBuild } from './HangarBuildDraftState.js';

export const HANGAR_STARTER_BUILDS = Object.freeze([
    Object.freeze({ id: 'sprinter', label: 'Sprinter', description: 'Tempo und geringes Gewicht' }),
    Object.freeze({ id: 'turn_fighter', label: 'Kurvenjäger', description: 'Maximale Kontrolle' }),
    Object.freeze({ id: 'tank', label: 'Tank', description: 'Struktur und Schutz' }),
    Object.freeze({ id: 'efficient', label: 'Energiesparer', description: 'Wenig Energie und Hitze' }),
]);

const SLOT_PRESETS = Object.freeze({
    sprinter: Object.freeze({
        core: 'core_swift_t1', nose: 'nose_t1', wing_left: 'wing_kestrel_t1', wing_right: 'wing_kestrel_t1',
        engine_left: 'engine_t1', engine_right: 'engine_t1', utility: null,
    }),
    turn_fighter: Object.freeze({
        core: 'core_swift_t1', nose: 'nose_razor_t1', wing_left: 'wing_t1', wing_right: 'wing_t1',
        engine_left: 'engine_eco_t1', engine_right: 'engine_eco_t1', utility: null,
    }),
    tank: Object.freeze({
        core: 'core_t1', nose: 'nose_t1', wing_left: 'wing_t1', wing_right: 'wing_t1',
        engine_left: 'engine_t1', engine_right: 'engine_t1', utility: 'utility_t1',
    }),
    efficient: Object.freeze({
        core: 'core_t1', nose: 'nose_t1', wing_left: 'wing_t1', wing_right: 'wing_t1',
        engine_left: 'engine_eco_t1', engine_right: 'engine_eco_t1', utility: null,
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
