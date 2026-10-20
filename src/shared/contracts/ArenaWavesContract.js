import {
    DEFAULT_FIGHT_MACHINE_GUN_ID,
    FIGHT_MACHINE_GUN_MODELS,
} from './FightMachineGunContract.js';
import { normalizeArcadeMachineGunId } from './ArcadeMachineGunContract.js';
import { normalizeArcadeBotAggressiveness } from './ArcadeBotAggressionContract.js';
import { MAP_PROFILE_SIZE_CLASSES, classifyMapSize } from './MapProfileContract.js';

export const ARENA_WAVES_RUN_TYPE = 'arena_waves';
export const ARENA_WAVES_COMBAT_PROFILE = 'hunt';
export const ARENA_WAVES_BOT_CAPACITY = 24;
export const ARENA_WAVES_WAVES_PER_MAP = 2;
// v3: timed waves join living ones (user decision 2026-10-19), so v2 scores rank separately.
export const ARENA_WAVES_RULE_VERSION = 'arena-waves-rules.v3';
// Every tick brings the next wave while the arena is below its active bot limit; an arena is
// won once ARENA_WAVES_WAVES_PER_MAP waves are fully cleared, whichever waves those are.
export const ARENA_WAVES_INTERVAL_SECONDS = 30;
// A wave tick only fills the arena up to this many active bots.
// "Very small" is the map picker's small class (MapProfileContract footprint) of the map size.
export const ARENA_WAVES_ACTIVE_BOT_LIMIT = 12;
export const ARENA_WAVES_SMALL_MAP_ACTIVE_BOT_LIMIT = 8;
// An emptied arena shortens the rest of the wave timer to this window; every skipped second
// scores twice the survival rate, so clearing fast beats waiting out the interval.
export const ARENA_WAVES_CLEAR_REMAINDER_SECONDS = 5;
export const ARENA_WAVES_FAST_CLEAR_POINTS_PER_SECOND = 10;
export const ARENA_WAVES_MAPS = Object.freeze([
    'notre_dame_arena', 'notre_dame_fire_arena', 'eiffel_tower_siege',
    'burg_falkenwacht_arena', 'reactor_site',
]);
export const ARENA_WAVES_MAP_MULTIPLIERS = Object.freeze([
    Object.freeze({ hp: 1, damage: 1 }), Object.freeze({ hp: 1.1, damage: 1.05 }),
    Object.freeze({ hp: 1.2, damage: 1.1 }), Object.freeze({ hp: 1.3, damage: 1.15 }),
    Object.freeze({ hp: 1.4, damage: 1.2 }),
]);
export const ARENA_WAVES_UPGRADE_IDS = Object.freeze(['speed', 'max_hp', 'pickup', 'mg_tuning', 'machine_gun', 'supply']);
// These names deliberately map to registered HUNT pickups.  Do not expose a
// cosmetic supply choice which cannot actually be spawned by PowerupManager.
export const ARENA_WAVES_SUPPLY_CHOICES = Object.freeze(['supply:shield', 'supply:rocket', 'supply:health', 'supply:thick']);
export const ARENA_WAVES_SUPPLY_PICKUPS = Object.freeze({
    'supply:shield': 'SHIELD',
    'supply:rocket': 'ROCKET_MEDIUM',
    'supply:health': 'HEALTH',
    'supply:thick': 'THICK',
});

const WAVE_ROWS = Object.freeze([
    null,
    Object.freeze({ count: 2, difficulty: 'EASY', hp: 1, damage: 1, elite: false }),
    Object.freeze({ count: 3, difficulty: 'EASY', hp: 1.1, damage: 1.05, elite: false }),
    Object.freeze({ count: 4, difficulty: 'NORMAL', hp: 1.2, damage: 1.1, elite: false }),
    Object.freeze({ count: 5, difficulty: 'NORMAL', hp: 1.3, damage: 1.15, elite: false }),
    Object.freeze({ count: 6, difficulty: 'HARD', hp: 1.4, damage: 1.2, elite: true }),
    Object.freeze({ count: 8, difficulty: 'HARD', hp: 1.5, damage: 1.25, elite: false }),
    Object.freeze({ count: 10, difficulty: 'HARD', hp: 1.6, damage: 1.3, elite: false }),
    Object.freeze({ count: 12, difficulty: 'HARD', hp: 1.7, damage: 1.35, elite: true }),
]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function isArenaWavesRunType(value) { return String(value || '').trim().toLowerCase() === ARENA_WAVES_RUN_TYPE; }
export function isArenaWavesConfig(config) { return config?.arcade?.enabled === true && isArenaWavesRunType(config?.arcade?.runType); }
export function normalizeArenaWavesCombatProfile(value, runType) {
    return isArenaWavesRunType(runType) && String(value || '').trim().toLowerCase() === ARENA_WAVES_COMBAT_PROFILE
        ? ARENA_WAVES_COMBAT_PROFILE : '';
}
export function resolveArenaWavesMap(index) { return ARENA_WAVES_MAPS[clamp(Math.trunc(number(index)), 0, ARENA_WAVES_MAPS.length - 1)]; }
/** A map without a readable size keeps the regular limit; only a known small footprint lowers it. */
export function resolveArenaWavesActiveBotLimit(mapSize) {
    return Array.isArray(mapSize) && classifyMapSize(mapSize) === MAP_PROFILE_SIZE_CLASSES.SMALL
        ? ARENA_WAVES_SMALL_MAP_ACTIVE_BOT_LIMIT : ARENA_WAVES_ACTIVE_BOT_LIMIT;
}
export function resolveArenaWavesMapMultipliers(index) { return ARENA_WAVES_MAP_MULTIPLIERS[clamp(Math.trunc(number(index)), 0, ARENA_WAVES_MAP_MULTIPLIERS.length - 1)]; }
export function resolveArenaWavesProfile(wave) {
    const ordinal = Math.max(1, Math.trunc(number(wave, 1)));
    const base = WAVE_ROWS[ordinal] || { count: 12, difficulty: 'HARD', hp: 1.8, damage: Math.min(1.8, 1 + 0.05 * (ordinal - 1)), elite: ordinal >= 5 && (ordinal - 5) % 3 === 0 };
    return Object.freeze({ wave: ordinal, ...base, elite: base.elite === true, eliteSlot: base.elite === true ? Math.max(0, base.count - 1) : -1 });
}
// Regular wave bots rotate through these roles; the elite slot of an elite wave drives as 'elite'.
export const ARENA_WAVES_BOT_ROLES = Object.freeze(['pursuer', 'flanker', 'interceptor']);
export function resolveArenaWavesBotRole(index, eliteSlot) {
    if (Number.isInteger(eliteSlot) && index === eliteSlot) return 'elite';
    return ARENA_WAVES_BOT_ROLES[Math.max(0, Math.trunc(Number(index) || 0)) % ARENA_WAVES_BOT_ROLES.length];
}
export function resolveArenaWavesAggression(mapIndex, wave) {
    return normalizeArcadeBotAggressiveness(0.50 + 0.08 * Math.max(0, Math.trunc(number(mapIndex))) + 0.05 * (Math.max(1, Math.trunc(number(wave, 1))) - 1));
}
export function createArenaWavesUpgrades(source = null) {
    const input = source && typeof source === 'object' ? source : {};
    return { speed: clamp(number(input.speed), 0, 20), maxHp: clamp(number(input.maxHp), 0, 48), pickup: clamp(number(input.pickup, 1), 1, 1.75), mgTuning: clamp(number(input.mgTuning), 0, 5), machineGunId: normalizeArcadeMachineGunId(input.machineGunId) };
}
export function effectiveArenaWavesChoices(upgrades, activeModel = DEFAULT_FIGHT_MACHINE_GUN_ID) {
    const u = createArenaWavesUpgrades(upgrades);
    const choices = [];
    if (u.speed < 20) choices.push('speed');
    if (u.maxHp < 48) choices.push('max_hp');
    if (u.pickup < 1.75) choices.push('pickup');
    if (u.mgTuning < 5) choices.push('mg_tuning');
    for (const model of FIGHT_MACHINE_GUN_MODELS) if (model.id !== normalizeArcadeMachineGunId(activeModel)) choices.push(`machine_gun:${model.id}`);
    return choices;
}
function seedStep(value) { return (Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0); }
export function resolveArenaWavesChoices(upgrades, activeModel, seed = 1, intermission = 0) {
    const pool = effectiveArenaWavesChoices(upgrades, activeModel);
    for (const supply of ARENA_WAVES_SUPPLY_CHOICES) pool.push(supply);
    let state = seedStep((Number(seed) >>> 0) ^ Math.imul(Math.max(0, Math.trunc(number(intermission))), 0x9e3779b9));
    for (let index = pool.length - 1; index > 0; index -= 1) {
        state = seedStep(state + index);
        const swap = state % (index + 1);
        [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    return pool.slice(0, 4);
}
export function resolveArenaWavesSupplyPickup(choiceId) {
    return ARENA_WAVES_SUPPLY_PICKUPS[String(choiceId || '')] || null;
}
export function applyArenaWavesChoice(upgrades, choiceId) {
    const next = createArenaWavesUpgrades(upgrades);
    const choice = String(choiceId || '');
    if (choice === 'speed') next.speed = clamp(next.speed + 4, 0, 20);
    else if (choice === 'max_hp') next.maxHp = clamp(next.maxHp + 12, 0, 48);
    else if (choice === 'pickup') next.pickup = clamp(Math.round(next.pickup * 1.15 * 100) / 100, 1, 1.75);
    else if (choice === 'mg_tuning') next.mgTuning = clamp(next.mgTuning + 1, 0, 5);
    else if (choice.startsWith('machine_gun:')) next.machineGunId = normalizeArcadeMachineGunId(choice.slice(12));
    return next;
}
export function calculateArenaWavesScore({ survivalSeconds = 0, regularKills = 0, eliteKills = 0, completedWaves = [], fastClearSeconds = 0 } = {}) {
    const cleared = Array.isArray(completedWaves) ? completedWaves.length : 0;
    // The k-th cleared wave of an arena scores 500 * k, whichever wave number it had: stalling for
    // late (possibly one-bot) waves earns no more than clearing waves 1 and 2.
    return Math.floor(Math.max(0, number(survivalSeconds)))*5 + Math.max(0, Math.trunc(number(regularKills)))*250 + Math.max(0, Math.trunc(number(eliteKills)))*900 + 500 * cleared * (cleared + 1) / 2
        + Math.floor(Math.max(0, number(fastClearSeconds))) * ARENA_WAVES_FAST_CLEAR_POINTS_PER_SECOND;
}
export function applyArenaWavesMachineGunTuning(config = {}, tuning = 0) {
    const level = clamp(Math.trunc(number(tuning)), 0, 5);
    if (!level) return config;
    return { ...config, DAMAGE: number(config.DAMAGE, 0) * (1 + level * 0.06), COOLING_PER_SECOND: number(config.COOLING_PER_SECOND, 22) * (1 + level * 0.08) };
}
