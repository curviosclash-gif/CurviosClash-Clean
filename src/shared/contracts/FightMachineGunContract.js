export const DEFAULT_FIGHT_MACHINE_GUN_ID = 'vector_m7';

export const FIGHT_MACHINE_GUN_MODELS = Object.freeze([
    Object.freeze({
        id: DEFAULT_FIGHT_MACHINE_GUN_ID,
        label: 'Vektor M7',
        role: 'Ausgewogen',
        description: 'Standard-MG mit ausgewogener Feuerrate, Reichweite und Hitze.',
        modifiers: Object.freeze({}),
        tracerColor: 0x8ad5ff,
        shotFx: Object.freeze({
            style: 'bolt',
            beamRadius: 1,
            bulletRadius: 1,
            durationSeconds: 0.09,
            streakFraction: 0.34,
            segmentCount: 1,
            muzzleScale: 1,
        }),
    }),
    Object.freeze({
        id: 'raptor_r9',
        label: 'Raptor R9',
        role: 'Schnellfeuer',
        description: '30 % schneller, aber 25 % weniger Schaden, 10 % weniger Reichweite und mehr Hitze.',
        modifiers: Object.freeze({ cooldown: 0.7, damage: 0.75, range: 0.9, overheat: 1.25 }),
        tracerColor: 0x73ffb2,
        shotFx: Object.freeze({
            style: 'pulse-train',
            beamRadius: 0.72,
            bulletRadius: 0.68,
            durationSeconds: 0.065,
            streakFraction: 0.2,
            segmentCount: 3,
            muzzleScale: 0.72,
        }),
    }),
    Object.freeze({
        id: 'bastion_h3',
        label: 'Bastion H3',
        role: 'Schwer',
        description: '55 % mehr Schaden, aber 55 % langsamere Feuerrate und mehr Hitze.',
        modifiers: Object.freeze({ cooldown: 1.55, damage: 1.55, overheat: 1.15 }),
        tracerColor: 0xffa45f,
        shotFx: Object.freeze({
            style: 'heavy-slug',
            beamRadius: 1.8,
            bulletRadius: 1.65,
            durationSeconds: 0.145,
            streakFraction: 0.46,
            segmentCount: 1,
            muzzleScale: 1.8,
        }),
    }),
    Object.freeze({
        id: 'lance_p4',
        label: 'Lanze P4',
        role: 'Präzision',
        description: '45 % mehr Reichweite und weniger Schadensabfall, aber 30 % langsamere Feuerrate.',
        modifiers: Object.freeze({ cooldown: 1.3, range: 1.45, minFalloff: 1.6, overheat: 0.9 }),
        tracerColor: 0xd49cff,
        shotFx: Object.freeze({
            style: 'precision-needle',
            beamRadius: 0.46,
            bulletRadius: 0.52,
            durationSeconds: 0.12,
            streakFraction: 1,
            segmentCount: 1,
            muzzleScale: 0.62,
        }),
    }),
]);

/** @type {Map<string, any>} */
const MODEL_BY_ID = new Map(FIGHT_MACHINE_GUN_MODELS.map((model) => [model.id, model]));

export function normalizeFightMachineGunId(value) {
    const id = String(value || '').trim().toLowerCase();
    return MODEL_BY_ID.has(id) ? id : DEFAULT_FIGHT_MACHINE_GUN_ID;
}

export function resolveFightMachineGunModel(value) {
    return MODEL_BY_ID.get(normalizeFightMachineGunId(value));
}

export function resolveFightMachineGunConfig(baseConfig = {}, modelId = DEFAULT_FIGHT_MACHINE_GUN_ID) {
    const model = resolveFightMachineGunModel(modelId);
    const modifiers = model.modifiers;
    const multiply = (key, modifier, fallback) => Math.max(
        0.01,
        Math.round(Number(baseConfig[key] || fallback) * Number(modifier || 1) * 10_000) / 10_000
    );
    return {
        ...baseConfig,
        COOLDOWN: multiply('COOLDOWN', modifiers.cooldown, 0.08),
        DAMAGE: multiply('DAMAGE', modifiers.damage, 9),
        RANGE: multiply('RANGE', modifiers.range, 95),
        OVERHEAT_PER_SHOT: multiply('OVERHEAT_PER_SHOT', modifiers.overheat, 6.5),
        MIN_FALLOFF: Math.min(1, multiply('MIN_FALLOFF', modifiers.minFalloff, 0.5)),
        TRACER_COLOR: model.tracerColor,
        TRACER_STYLE: model.shotFx.style,
        TRACER_BEAM_RADIUS: multiply('TRACER_BEAM_RADIUS', model.shotFx.beamRadius, 0.16),
        TRACER_BULLET_RADIUS: multiply('TRACER_BULLET_RADIUS', model.shotFx.bulletRadius, 0.42),
        TRACER_DURATION_SECONDS: model.shotFx.durationSeconds,
        TRACER_STREAK_FRACTION: model.shotFx.streakFraction,
        TRACER_SEGMENT_COUNT: model.shotFx.segmentCount,
        TRACER_MUZZLE_SCALE: model.shotFx.muzzleScale,
        MACHINE_GUN_ID: model.id,
    };
}
