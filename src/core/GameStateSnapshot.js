// ============================================

import { createHuntNetworkState } from '../hunt/HuntNetworkState.js';
import { isRocketTierType } from '../hunt/RocketPickupSystem.js';
import { ROCKET_THREAT_SOURCES, resolveRocketThreatSource } from '../entities/systems/projectile/RocketThreatTracker.js';
import { normalizeTeamId } from '../shared/contracts/TeamCombatContract.js';
// GameStateSnapshot.js - serializable game state for network transport
// ============================================

/**
 * Creates a JSON-serializable snapshot of the current game state.
 * Used for:
 * - Host → Client state synchronization (10/s)
 * - Replay recording
 * - Checksum verification
 */

export function createGameStateSnapshot(entityManager, roundState) {
    const players = [];
    const allPlayers = entityManager?.players || [];

    for (let i = 0; i < allPlayers.length; i++) {
        const p = allPlayers[i];
        players.push(serializePlayer(p));
    }

    const projectiles = [];
    const allProjectiles = entityManager?.projectiles || [];
    for (let i = 0; i < allProjectiles.length; i++) {
        const proj = allProjectiles[i];
        if (!proj || proj.active === false) continue;
        const serializedProjectile = {
            id: proj.id || proj.traversalId || i,
            pos: vecToArray(proj.position),
            vel: vecToArray(proj.velocity),
            owner: proj.ownerIndex ?? proj.owner?.index ?? -1,
            type: proj.type || 'mg',
            ttl: toFiniteNumber(proj.ttl, 0),
            radius: toFiniteNumber(proj.radius, 0),
        };
        if (proj.guidedActive === true) serializedProjectile.guided = true;
        if (proj.type === 'HYDRA_FIREBALL') serializedProjectile.visualScale = proj.visualScale;
        if (proj.environmentProjectile === true || proj.zoneProjectile === true) {
            serializedProjectile.environmentProjectile = proj.environmentProjectile === true;
            serializedProjectile.targetPlayerIndex = Number.isInteger(proj.targetPlayerIndex) ? proj.targetPlayerIndex : -1;
            serializedProjectile.zoneProjectile = proj.zoneProjectile === true;
        }
        appendRocketThreatFields(serializedProjectile, proj);
        projectiles.push(serializedProjectile);
    }

    const powerups = [];
    const allPowerups = entityManager?.powerups || entityManager?.powerupManager?.items || [];
    for (let i = 0; i < allPowerups.length; i++) {
        const pu = allPowerups[i];
        if (!pu || pu.active === false) continue;
        powerups.push({
            id: pu.id || pu.networkId || i,
            pos: [
                toFiniteNumber(pu.position?.x ?? pu.mesh?.position?.x, 0),
                toFiniteNumber(pu.baseY ?? pu.position?.y ?? pu.mesh?.position?.y, 0),
                toFiniteNumber(pu.position?.z ?? pu.mesh?.position?.z, 0),
            ],
            type: pu.type || '',
            visible: pu.mesh?.visible !== false,
            telegraphRemaining: toFiniteNumber(pu.telegraphRemaining, 0),
        });
    }
    const turrets = entityManager?._staticTurretSystem?.createNetworkSnapshot?.() || [];

    return {
        frame: roundState?.frame ?? 0,
        players,
        projectiles,
        powerups,
        turrets,
        repairDrones: entityManager?._repairDroneSystem?.serializeNetworkState?.() || null,
        globalFog: entityManager?.getGlobalFogState?.() || { active: false, remainingSeconds: 0, visibilityRange: 0 },
        mapElapsedSeconds: toFiniteNumber(entityManager?.arena?.glbAnimationElapsedSeconds, 0),
        dandelionSeeds: entityManager?.arena?.serializeDandelionSeeds?.() || null,
        fight: createHuntNetworkState(entityManager),
        roundState: roundState ? {
            round: roundState.round ?? 0,
            timeRemaining: roundState.timeRemaining ?? 0,
            scores: roundState.scores || [],
        } : null,
    };
}

/**
 * Adds the rocket warning fields to a serialized projectile.
 *
 * Both fields are optional on the wire, so an older host stays readable and a snapshot
 * only grows for the rockets that actually chase somebody: `lockedPlayerIndex` appears
 * for rocket tier projectiles with a lock, `threatSource` only when the source is not a
 * player - a replica resolves `owner` among the players and would otherwise mistake a
 * turret rocket for a player rocket.
 */
function appendRocketThreatFields(serialized, projectile) {
    if (!isRocketTierType(serialized.type)) return;
    const lockedPlayerIndex = Number(projectile.lockedPlayerIndex);
    if (!Number.isInteger(lockedPlayerIndex) || lockedPlayerIndex < 0) return;
    serialized.lockedPlayerIndex = lockedPlayerIndex;
    const threatSource = resolveRocketThreatSource(projectile);
    if (threatSource !== ROCKET_THREAT_SOURCES.PLAYER) serialized.threatSource = threatSource;
}

export function serializePlayer(player) {
    if (!player) return null;
    return {
        id: player.id || `p-${player.index}`,
        index: player.index ?? 0,
        isBot: !!player.isBot,
        teamId: normalizeTeamId(player.teamId),
        alive: !!player.alive,
        // Lets a network replica replay the death explosion for a cause it could not
        // resolve itself (e.g. a rocket hit only the host simulates) - see StateReconciler.
        deathCause: typeof player.lastDeathCause === 'string' ? player.lastDeathCause : null,
        deathProjectileType: typeof player.lastDeathProjectileType === 'string' ? player.lastDeathProjectileType : null,
        pos: vecToArray(player.position),
        rot: quatToArray(player.quaternion),
        vel: vecToArray(player.velocity),
        // `health` is the established wire key; live Player instances store the value as `hp`.
        health: toFiniteNumber(player.hp ?? player.health, 100),
        score: player.score ?? 0,
        inventory: Array.isArray(player.inventory) ? [...player.inventory] : [],
        rocketInventory: Array.isArray(player.rocketInventory) ? [...player.rocketInventory] : [],
        effects: serializeEffects(player.activeEffects),
        // A replica draws the flame jet but never simulates it: only the host knows whether this
        // tick really burned fuel, so the fact travels as its own field (S4.6). A dead vehicle
        // skips its action phase, so the flag is gated on alive instead of reset on death.
        flameActive: player.alive === true && player.flameActive === true,
        // The railgun charge, so a replica can show how far a held shot is.
        railCharge: player.alive === true ? Math.max(0, toFiniteNumber(player.railCharge, 0)) : 0,
        hasShield: player.hasShield === true,
        shieldHP: toFiniteNumber(player.shieldHP, 0),
        speed: toFiniteNumber(player.speed, 0),
        exclusionZone: serializeExclusionZoneState(player.exclusionZoneState),
    };
}

function serializeExclusionZoneState(state) {
    const phase = ['SAFE', 'GRACE', 'SALVO'].includes(state?.phase) ? state.phase : 'SAFE';
    return {
        phase,
        elapsedSeconds: Math.max(0, toFiniteNumber(state?.elapsedSeconds, 0)),
        countdownSeconds: Math.max(0, Math.ceil(toFiniteNumber(state?.countdownSeconds, 0))),
        stage: typeof state?.stage === 'string' ? state.stage : '',
    };
}

function vecToArray(vec) {
    if (!vec) return [0, 0, 0];
    return [vec.x || 0, vec.y || 0, vec.z || 0];
}

function quatToArray(quat) {
    if (!quat) return [0, 0, 0, 1];
    return [
        toFiniteNumber(quat.x, 0),
        toFiniteNumber(quat.y, 0),
        toFiniteNumber(quat.z, 0),
        toFiniteNumber(quat.w, 1),
    ];
}

function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function serializeEffects(effects) {
    if (!Array.isArray(effects) || effects.length <= 0) return [];
    return effects
        .map((effect) => {
            const type = String(effect?.type || '').trim();
            if (!type) return null;
            const serialized = {
                type,
                remaining: Number(effect?.remaining) || 0,
                sourcePlayerIndex: Number.isInteger(effect?.sourcePlayerIndex)
                    ? effect.sourcePlayerIndex
                    : null,
            };
            // Additive: only the flamethrower carries a tank, and only it needs the number on
            // the client, where the item bar shows fuel instead of the expiry.
            const fuelSeconds = Number(effect?.fuelSeconds);
            if (Number.isFinite(fuelSeconds) && fuelSeconds >= 0) serialized.fuelSeconds = fuelSeconds;
            // The railgun's shots, for the same reason as the tank.
            const shots = Number(effect?.shots);
            if (Number.isFinite(shots) && shots >= 0) serialized.shots = Math.trunc(shots);
            return serialized;
        })
        .filter(Boolean);
}
