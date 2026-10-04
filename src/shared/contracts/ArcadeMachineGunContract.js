import {
    ARCADE_MG_AIM_MAX_BONUS,
    ARCADE_MG_DAMAGE_PER_LEVEL,
    ARCADE_MG_LEVEL_CURVE_BASE,
    ARCADE_MG_RATE_MAX_BONUS,
    ARCADE_MG_UNLOCK_LEVEL_INTERVAL,
    ARCADE_WEAPON_LEVEL_COST_BASE_XP,
    ARCADE_WEAPON_LEVEL_COST_EXPONENT,
    resolveArcadeVehicleBaseStats,
} from './ArcadeVehicleBalanceContract.js';
import { spendArcadeVehicleXp } from './ArcadeVehicleBuildContract.js';
import {
    DEFAULT_FIGHT_MACHINE_GUN_ID,
    FIGHT_MACHINE_GUN_MODELS,
    resolveFightMachineGunConfig,
} from './FightMachineGunContract.js';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const model = (id, label, role, strength, weakness, modifiers, tracerColor, shotFx) => Object.freeze({
    id, label, role, strength, weakness, modifiers: Object.freeze(modifiers), tracerColor,
    shotFx: Object.freeze(shotFx),
});
const fightFx = (id) => FIGHT_MACHINE_GUN_MODELS.find((entry) => entry.id === id).shotFx;

// The first four keep their existing shot effects. These factors are calibrated
// against the real five-second OverheatGunSystem + MGHitResolver test.
export const ARCADE_MACHINE_GUN_MODELS = Object.freeze([
    model('vector_m7', 'Vektor M7', 'Ausgewogen', 'Ausgewogene Werte', 'Keine Spezialisierung',
        {}, 0x8ad5ff, fightFx('vector_m7')),
    model('raptor_r9', 'Raptor R9', 'Schnellfeuer', '+43 % Feuerrate', 'Weniger Schaden je Schuss, mehr Hitze',
        { cooldown: 0.7, damage: 0.75, overheat: 0.74 }, 0x73ffb2, fightFx('raptor_r9')),
    model('bastion_h3', 'Bastion H3', 'Schwer', '+55 % Schaden je Schuss', 'Langsamere Feuerrate',
        { cooldown: 1.54, damage: 1.55, overheat: 1.58 }, 0xffa45f, fightFx('bastion_h3')),
    model('lance_p4', 'Lanze P4', 'Präzision', '+45 % Reichweite, geringer Schadensabfall', 'Langsamer, kleinere Zielhilfe',
        { cooldown: 1.54, damage: 0.92, overheat: 1.02, range: 1.45, minFalloff: 1.6, aimAssist: 0.75 },
        0xd49cff, fightFx('lance_p4')),
    model('swarm_s2', 'Schwarm S2', 'Zielsuche', '+60 % Zielhilfe-Kegel, hält Ziele länger', '−15 % Schaden, −20 % Reichweite',
        { damage: 0.85, overheat: 0.84, range: 0.8, aimAssist: 1.6, aimHold: 1.5 },
        0x77e8ff, { ...fightFx('raptor_r9'), style: 'pulse-train' }),
    model('ember_g5', 'Glut G5', 'Dauerfeuer', 'Überhitzt kaum', '−15 % Schaden, langsameres Feuer und Abkühlen nach Überhitzung',
        { cooldown: 2.55, damage: 0.85, overheat: 0.4, lockout: 1.6 },
        0xff6647, { ...fightFx('bastion_h3'), style: 'heavy-slug' }),
    model('pulse_p3', 'Puls P3', 'Salven', 'Drei starke Schüsse je Stoß, schnelle Kühlung', 'Pause zwischen den Stößen',
        { damage: 1.6, overheat: 2.1, cooling: 1.5, burstSize: 3, burstInterval: 0.6, burstPause: 6.25 },
        0xbbb2ff, { ...fightFx('raptor_r9'), style: 'pulse-train' }),
]);
export const ARCADE_MACHINE_GUN_IDS = Object.freeze(ARCADE_MACHINE_GUN_MODELS.map((entry) => entry.id));
const MODEL_BY_ID = new Map(ARCADE_MACHINE_GUN_MODELS.map((entry) => [entry.id, entry]));

export function normalizeArcadeMachineGunId(value) {
    const id = String(value || '').trim().toLowerCase();
    return MODEL_BY_ID.has(id) ? id : DEFAULT_FIGHT_MACHINE_GUN_ID;
}

export function resolveAnyMachineGunModel(value) {
    return MODEL_BY_ID.get(normalizeArcadeMachineGunId(value));
}

export function normalizeArcadeWeaponLevel(value) {
    const n = Number(value);
    return Number.isNaN(n) ? 1 : Math.max(1, Math.min(MAX_SAFE, Math.floor(n)));
}

export function resolveArcadeOwnedMachineGuns(vehicleId, level) {
    const owned = [...resolveArcadeVehicleBaseStats(vehicleId).startMachineGuns];
    const unlocks = Math.floor(normalizeArcadeWeaponLevel(level) / ARCADE_MG_UNLOCK_LEVEL_INTERVAL);
    for (const id of ARCADE_MACHINE_GUN_IDS) {
        if (owned.length >= 2 + unlocks) break;
        if (!owned.includes(id)) owned.push(id);
    }
    return owned;
}

export function resolveArcadeMachineGunUnlockLevel(vehicleId, id) {
    const normalized = normalizeArcadeMachineGunId(id);
    if (normalized !== id) return null;
    const starts = resolveArcadeVehicleBaseStats(vehicleId).startMachineGuns;
    if (starts.includes(id)) return 1;
    let ordinal = 0;
    for (const entry of ARCADE_MACHINE_GUN_IDS) {
        if (starts.includes(entry)) continue;
        ordinal += 1;
        if (entry === id) return ordinal * ARCADE_MG_UNLOCK_LEVEL_INTERVAL;
    }
    return null;
}

export function normalizeArcadeWeaponProfileFields(profile) {
    const source = profile && typeof profile === 'object' ? profile : {};
    const vehicleId = String(source.vehicleId || 'ship5');
    const owned = resolveArcadeOwnedMachineGuns(vehicleId, source.level);
    const candidate = normalizeArcadeMachineGunId(source.selectedMachineGunId);
    return {
        mgLevel: normalizeArcadeWeaponLevel(source.mgLevel),
        rocketLevel: normalizeArcadeWeaponLevel(source.rocketLevel),
        shieldLevel: normalizeArcadeWeaponLevel(source.shieldLevel),
        selectedMachineGunId: owned.includes(candidate) ? candidate : owned[0],
    };
}

export function resolveArcadeMachineGunLevelEffects(level) {
    const n = normalizeArcadeWeaponLevel(level);
    const gain = Math.min(ARCADE_MG_RATE_MAX_BONUS, 1 - Math.pow(ARCADE_MG_LEVEL_CURVE_BASE, n - 1));
    return Object.freeze({
        damage: ARCADE_MG_DAMAGE_PER_LEVEL * (n - 1),
        rate: gain,
        range: gain,
        aim: Math.min(ARCADE_MG_AIM_MAX_BONUS, gain * ARCADE_MG_AIM_MAX_BONUS),
    });
}

export function arcadeWeaponLevelCostXp(nextLevel) {
    const n = normalizeArcadeWeaponLevel(nextLevel);
    if (n <= 1) return 0;
    return Math.min(MAX_SAFE, Math.round(ARCADE_WEAPON_LEVEL_COST_BASE_XP
        * Math.pow(n - 1, ARCADE_WEAPON_LEVEL_COST_EXPONENT)));
}

export function evaluateArcadeWeaponLevelPurchase(profile, kind) {
    const field = { mg: 'mgLevel', rocket: 'rocketLevel', shield: 'shieldLevel' }[kind];
    if (!field) return { ok: false, reason: 'invalid_kind', cost: 0, next: null };
    const current = normalizeArcadeWeaponLevel(profile?.[field]);
    if (current >= MAX_SAFE) return { ok: false, reason: 'max_level', cost: 0, next: null };
    const cost = arcadeWeaponLevelCostXp(current + 1);
    return spendArcadeVehicleXp(profile, cost, { [field]: current + 1 });
}

export function selectArcadeMachineGun(profile, id) {
    const normalized = normalizeArcadeMachineGunId(id);
    const owned = resolveArcadeOwnedMachineGuns(profile?.vehicleId, profile?.level);
    if (normalized !== id || !owned.includes(normalized)) {
        return { ok: false, reason: 'not_owned', next: null };
    }
    return { ok: true, reason: 'ok', next: { ...profile, selectedMachineGunId: normalized } };
}

export function resolvePlayerMachineGunId(player) {
    return normalizeArcadeMachineGunId(player?.arenaWavesLoadout?.machineGunId
        || player?.arcadeWeaponLoadout?.machineGunId || player?.fightLoadout?.machineGunId);
}

/** Pure Arcade gun values; nose range and Arena tuning are applied by MGConfigResolver. */
export function resolveArcadeMachineGunConfig(baseMg, machineGunId, level = 1) {
    const source = baseMg || {};
    const gun = resolveAnyMachineGunModel(machineGunId);
    const m = gun.modifiers;
    const effects = resolveArcadeMachineGunLevelEffects(level);
    const gain = 1 + effects.rate;
    const aim = 1 + effects.aim;
    const visual = resolveFightMachineGunConfig(source, FIGHT_MACHINE_GUN_MODELS.some((entry) => entry.id === gun.id)
        ? gun.id : DEFAULT_FIGHT_MACHINE_GUN_ID);
    const numeric = (key, fallback) => Math.max(0.01, Number(source[key] || fallback));
    const scaled = (key, fallback, factor) => numeric(key, fallback) * (factor || 1);
    return {
        ...visual,
        DAMAGE: scaled('DAMAGE', 7.75, m.damage),
        COOLDOWN: scaled('COOLDOWN', 0.08, m.cooldown) / gain,
        OVERHEAT_PER_SHOT: scaled('OVERHEAT_PER_SHOT', 9, m.overheat) / gain,
        RANGE: scaled('RANGE', 152, m.range) * gain,
        MIN_FALLOFF: Math.min(1, scaled('MIN_FALLOFF', 0.5, m.minFalloff)),
        COOLING_PER_SECOND: scaled('COOLING_PER_SECOND', 20, m.cooling),
        LOCKOUT_SECONDS: scaled('LOCKOUT_SECONDS', 0.75, m.lockout),
        HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG: scaled('HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG', 19.2, m.aimAssist) * aim,
        HUMAN_AIM_ASSIST_RELEASE_ANGLE_DEG: scaled('HUMAN_AIM_ASSIST_RELEASE_ANGLE_DEG', 28.8, m.aimAssist) * aim,
        HUMAN_AIM_ASSIST_LOCK_SECONDS: scaled('HUMAN_AIM_ASSIST_LOCK_SECONDS', 0.4, m.aimHold) * aim,
        TRACER_COLOR: gun.tracerColor,
        TRACER_STYLE: gun.shotFx.style,
        TRACER_BEAM_RADIUS: scaled('TRACER_BEAM_RADIUS', 0.16, gun.shotFx.beamRadius),
        TRACER_BULLET_RADIUS: scaled('TRACER_BULLET_RADIUS', 0.42, gun.shotFx.bulletRadius),
        TRACER_DURATION_SECONDS: gun.shotFx.durationSeconds,
        TRACER_STREAK_FRACTION: gun.shotFx.streakFraction,
        TRACER_SEGMENT_COUNT: gun.shotFx.segmentCount,
        TRACER_MUZZLE_SCALE: gun.shotFx.muzzleScale,
        MACHINE_GUN_ID: gun.id,
        FIRE_MODE: m.burstSize ? 'burst' : 'arcade',
        BURST_SIZE: m.burstSize || 0,
        BURST_INTERVAL: m.burstSize ? scaled('COOLDOWN', 0.08, m.burstInterval) / gain : 0,
        BURST_PAUSE: m.burstSize ? scaled('COOLDOWN', 0.08, m.burstPause) / gain : 0,
    };
}

export function describeArcadeMachineGunRelative(id, level = 1) {
    const base = { DAMAGE: 7.75, COOLDOWN: 0.08, OVERHEAT_PER_SHOT: 9, RANGE: 152,
        MIN_FALLOFF: 0.5, COOLING_PER_SECOND: 20, LOCKOUT_SECONDS: 0.75,
        HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG: 19.2, HUMAN_AIM_ASSIST_RELEASE_ANGLE_DEG: 28.8,
        HUMAN_AIM_ASSIST_LOCK_SECONDS: 0.4 };
    const gun = resolveArcadeMachineGunConfig(base, id, level);
    const reference = resolveArcadeMachineGunConfig(base, 'vector_m7', 1);
    return {
        damagePct: 100 * gun.DAMAGE * (1 + resolveArcadeMachineGunLevelEffects(level).damage / 100) / reference.DAMAGE,
        ratePct: 100 * reference.COOLDOWN / gun.COOLDOWN,
        rangePct: 100 * gun.RANGE / reference.RANGE,
        aimPct: 100 * gun.HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG / reference.HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG,
    };
}
