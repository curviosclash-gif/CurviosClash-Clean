export const DEFAULT_FIGHT_MACHINE_GUN_ID = 'vector_m7';

export const FIGHT_MACHINE_GUN_MODELS = Object.freeze([
    Object.freeze({
        id: DEFAULT_FIGHT_MACHINE_GUN_ID,
        label: 'Vektor M7',
        role: 'Ausgewogen',
        description: 'Standard-MG mit ausgewogener Feuerrate, Reichweite und Hitze.',
        modifiers: Object.freeze({}),
        tracerColor: 0x8ad5ff,
    }),
    Object.freeze({
        id: 'raptor_r9',
        label: 'Raptor R9',
        role: 'Schnellfeuer',
        description: '30 % schneller, aber 25 % weniger Schaden, 10 % weniger Reichweite und mehr Hitze.',
        modifiers: Object.freeze({ cooldown: 0.7, damage: 0.75, range: 0.9, overheat: 1.25 }),
        tracerColor: 0x73ffb2,
    }),
    Object.freeze({
        id: 'bastion_h3',
        label: 'Bastion H3',
        role: 'Schwer',
        description: '55 % mehr Schaden, aber 55 % langsamere Feuerrate und mehr Hitze.',
        modifiers: Object.freeze({ cooldown: 1.55, damage: 1.55, overheat: 1.15 }),
        tracerColor: 0xffa45f,
    }),
    Object.freeze({
        id: 'lance_p4',
        label: 'Lanze P4',
        role: 'Präzision',
        description: '45 % mehr Reichweite und weniger Schadensabfall, aber 30 % langsamere Feuerrate.',
        modifiers: Object.freeze({ cooldown: 1.3, range: 1.45, minFalloff: 1.6, overheat: 0.9 }),
        tracerColor: 0xd49cff,
    }),
]);

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
        MACHINE_GUN_ID: model.id,
    };
}
