import { resolveFightMachineGunConfig } from '../../shared/contracts/FightMachineGunContract.js';
import { applyArenaWavesMachineGunTuning } from '../../shared/contracts/ArenaWavesContract.js';
import { resolveArcadeNoseRange } from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { resolveArcadeMachineGunConfig } from '../../shared/contracts/ArcadeMachineGunContract.js';
import { isArcadeMachineGunMastered } from '../../shared/contracts/ArcadeMilestoneCosmeticContract.js';

function positiveFactor(value) {
    const factor = Number(value);
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** One cached config per player; only fog-dependent RANGE changes on the hot path. */
export function resolvePlayerMachineGunConfig(baseMg, player) {
    const base = baseMg || {};
    const loadout = player?.arcadeWeaponLoadout || null;
    const arena = player?.isBot === true ? null : player?.arenaWavesLoadout || null;
    const fightId = player?.fightLoadout?.machineGunId;
    const damage = positiveFactor(player?.arcadeDamageMultiplier);
    if (!loadout && !arena && damage === 1 && positiveFactor(player?.arcadeRangeMultiplier) === 1) {
        return resolveFightMachineGunConfig(base, fightId);
    }
    const cached = player?._arcadeMgCache;
    if (cached?.base === base && cached.loadout === loadout && cached.arena === arena
        && cached.fightId === fightId && cached.damage === damage) {
        cached.config.RANGE = resolveArcadeNoseRange(cached.config.FALLOFF_RANGE, player);
        return cached.config;
    }
    let config;
    if (loadout) {
        config = resolveArcadeMachineGunConfig(base, arena?.machineGunId || loadout.machineGunId, loadout.mgLevel);
        config.DAMAGE *= positiveFactor(loadout.mgDamagePct ?? 100) / 100;
        config = applyArenaWavesMachineGunTuning(config, arena?.mgTuning);
    } else {
        config = applyArenaWavesMachineGunTuning(
            resolveFightMachineGunConfig(base, arena?.machineGunId || fightId), arena?.mgTuning,
        );
        config.DAMAGE *= damage;
    }
    config.FALLOFF_RANGE = Math.max(10, Number(config.FALLOFF_RANGE || config.RANGE || 95));
    if (isArcadeMachineGunMastered(config.MACHINE_GUN_ID, loadout?.masterCount)) {
        config.TRACER_BEAM_RADIUS *= 1.2; config.TRACER_BULLET_RADIUS *= 1.15; config.TRACER_MUZZLE_SCALE *= 1.25;
    }
    config.RANGE = resolveArcadeNoseRange(config.FALLOFF_RANGE, player);
    if (player) player._arcadeMgCache = { base, loadout, arena, fightId, damage, config };
    return config;
}

/** The neutral path retains the original unmodelled cooling settings. */
export function resolvePlayerMachineGunCooling(baseMg, player) {
    const loadout = player?.arcadeWeaponLoadout;
    const arena = player?.isBot === true ? null : player?.arenaWavesLoadout;
    const damage = positiveFactor(player?.arcadeDamageMultiplier);
    const range = positiveFactor(player?.arcadeRangeMultiplier);
    return loadout || arena || damage !== 1 || range !== 1
        ? resolvePlayerMachineGunConfig(baseMg, player) : baseMg;
}
