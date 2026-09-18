import { grantShield } from './HealthSystem.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { formatPlayerDisplayLabel } from '../shared/contracts/PlayerDisplayLabelContract.js';
import { HUNT_WIN_CONDITIONS } from '../shared/contracts/HuntWinConditionContract.js';
import { HUNT_LAST_ALIVE_LIVES } from '../shared/contracts/HuntLivesContract.js';

function getLabel(player) {
    if (!player) return 'Spieler';
    return formatPlayerDisplayLabel(player);
}

function getRespawnConfig(runtimeContext = null) {
    return resolveEntityRuntimeConfig(runtimeContext)?.HUNT?.RESPAWN || {};
}

function resetRespawnInventory(player, respawnConfig) {
    if (!player || respawnConfig?.RESET_INVENTORY === false) return;
    player.inventory.length = 0;
    if (Array.isArray(player.rocketInventory)) player.rocketInventory.length = 0;
    player.selectedItemIndex = 0;

    const startLoadout = Array.isArray(respawnConfig?.START_LOADOUT)
        ? respawnConfig.START_LOADOUT
        : [];
    for (const type of startLoadout) {
        if (typeof type !== 'string' || !type.trim()) continue;
        player.addToInventory(type.trim());
    }
}

function applyRespawnRecovery(player, respawnConfig) {
    if (!player) return;

    const recoveryShieldHp = Math.max(0, Number(respawnConfig?.RECOVERY_SHIELD_HP || 0));
    if (recoveryShieldHp > 0) {
        grantShield(player, player?.entityRuntimeConfig || null);
        player.shieldHP = Math.min(player.maxShieldHp || recoveryShieldHp, recoveryShieldHp);
    }
}

function createVectorFromPlayer(player, values) {
    if (!Array.isArray(values) || values.length < 3) return null;
    const vector = player?.position?.clone?.();
    if (!vector || typeof vector.set !== 'function') return null;
    return vector.set(Number(values[0]) || 0, Number(values[1]) || 0, Number(values[2]) || 0);
}

export class RespawnSystem {
    constructor(runtimeContext) {
        this.runtime = runtimeContext || null;
        this.pendingByPlayer = new Map();
        this.livesRemainingByPlayer = new Map();
    }

    isEnabled() {
        const strategy = this.runtime?.callbacks?.getStrategy?.() || null;
        return strategy?.isRespawnEnabled?.() === true
            || this.runtime?.callbacks?.parcours?.isRespawnEnabled?.() === true;
    }

    reset() {
        this.pendingByPlayer.clear();
        this.livesRemainingByPlayer.clear();
    }

    onPlayerDied(player) {
        if (!player) return false;
        const strategy = this.runtime?.callbacks?.getStrategy?.() || null;
        const huntRespawnEnabled = strategy?.isRespawnEnabled?.() === true;
        const parcoursPlan = this.runtime?.callbacks?.parcours?.takeRespawnPlan?.(player) || null;
        if (!huntRespawnEnabled && !parcoursPlan) return false;
        if (!parcoursPlan && resolveEntityRuntimeConfig(this.runtime)?.HUNT?.WIN_CONDITION === HUNT_WIN_CONDITIONS.LAST_ALIVE) {
            const remaining = Math.max(0, this.getLivesRemainingForPlayer(player) - 1);
            this.livesRemainingByPlayer.set(player.index, remaining);
            if (remaining === 0) {
                this.pendingByPlayer.delete(player.index);
                return false;
            }
        }
        const delaySeconds = Math.max(
            0.1,
            Number(parcoursPlan?.delaySeconds ?? getRespawnConfig(this.runtime)?.DELAY_SECONDS ?? 3) || 3
        );
        this.pendingByPlayer.set(player.index, {
            player,
            remaining: delaySeconds,
            delaySeconds,
            kind: parcoursPlan ? 'parcours' : 'hunt',
            parcoursPlan,
        });
        return true;
    }

    isRespawnPending(player) {
        if (!player) return false;
        return this.pendingByPlayer.has(player.index);
    }

    getLivesRemainingForPlayer(playerOrIndex) {
        const index = Number.isInteger(playerOrIndex) ? playerOrIndex : playerOrIndex?.index;
        if (!Number.isInteger(index)) return 0;
        return this.livesRemainingByPlayer.get(index) ?? HUNT_LAST_ALIVE_LIVES;
    }

    getLivesRemainingByPlayer(players = []) {
        if (resolveEntityRuntimeConfig(this.runtime)?.HUNT?.WIN_CONDITION !== HUNT_WIN_CONDITIONS.LAST_ALIVE) return {};
        const remaining = {};
        for (const player of players) {
            if (player?.entitySlotActive === false || !Number.isInteger(player?.index)) continue;
            remaining[player.index] = this.getLivesRemainingForPlayer(player);
        }
        return remaining;
    }

    getRemainingByPlayer() {
        const snapshot = {};
        for (const [playerIndex, pending] of this.pendingByPlayer) {
            snapshot[playerIndex] = Math.max(0, Number(pending?.remaining) || 0);
        }
        return snapshot;
    }

    getRemainingForPlayer(playerOrIndex) {
        const playerIndex = Number.isInteger(playerOrIndex)
            ? playerOrIndex
            : playerOrIndex?.index;
        if (!Number.isInteger(playerIndex)) return 0;
        return Math.max(0, Number(this.pendingByPlayer.get(playerIndex)?.remaining) || 0);
    }

    getPendingCountForPlayers(players) {
        if (!Array.isArray(players) || players.length === 0) return 0;
        let count = 0;
        for (const player of players) {
            if (player && this.pendingByPlayer.has(player.index)) count++;
        }
        return count;
    }

    update(dt) {
        if (!this.isEnabled()) {
            this.pendingByPlayer.clear();
            return;
        }

        const safeDt = Math.max(0, Number(dt) || 0);
        for (const [playerIndex, pending] of this.pendingByPlayer.entries()) {
            const player = pending?.player;
            // An inactive slot (a guest who left the match) must not come back.
            if (!player || player.alive || player.entitySlotActive === false) {
                this.pendingByPlayer.delete(playerIndex);
                continue;
            }

            pending.remaining -= safeDt;
            if (pending.remaining > 0) continue;

            const respawnConfig = getRespawnConfig(this.runtime);
            const entityRuntimeConfig = resolveEntityRuntimeConfig(this.runtime);
            const parcoursPlan = pending.parcoursPlan || null;
            let spawnPos = createVectorFromPlayer(player, parcoursPlan?.position);
            let spawnDir = createVectorFromPlayer(player, parcoursPlan?.forward);
            if (!spawnPos) {
                const planarSpawnLevel = entityRuntimeConfig.GAMEPLAY.PLANAR_MODE && this.runtime?.spawn?.getPlanarSpawnLevel
                    ? this.runtime.spawn.getPlanarSpawnLevel()
                    : null;
                const minEnemyDistance = Math.max(12, Number(respawnConfig?.MIN_ENEMY_DISTANCE || 18));
                spawnPos = this.runtime.spawn.findSpawnPosition(minEnemyDistance, 12, {
                    planarLevel: planarSpawnLevel,
                    player,
                });
            }
            if (!spawnDir) {
                spawnDir = this.runtime.spawn.findSafeSpawnDirection(spawnPos, player.hitboxRadius, player);
            }
            player.spawn(spawnPos, spawnDir);
            const strategy = this.runtime?.callbacks?.getStrategy?.() || null;
            strategy?.resetPlayerHealth?.(player);
            player.fightLastAttackerIndex = -1;
            player.fightLastThreatSourceIndex = -1;
            player.fightLastThreatAtSeconds = -Infinity;
            player.fightTargetPlayerIndex = -1;
            player.fightTargetLockRemaining = 0;
            player.fightSpawnedAtSeconds = Math.max(0, Number(this.runtime?.callbacks?.getSimulationNowMs?.()) || 0) * 0.001;
            this.runtime?.callbacks?.parcours?.onPlayerSpawn?.(player, {
                reason: parcoursPlan ? 'parcours_respawn' : 'respawn',
            });

            if (!parcoursPlan) {
                resetRespawnInventory(player, respawnConfig);
                applyRespawnRecovery(player, respawnConfig);
            }

            const invulnerability = Math.max(0, Number(respawnConfig?.INVULNERABILITY_SECONDS || 1));
            player.spawnProtectionTimer = Math.max(player.spawnProtectionTimer || 0, invulnerability);
            player.shootCooldown = 0;
            this.runtime?.combat?.resetRespawnCombatState?.(player);

            const recorder = this.runtime?.services?.recorder;
            if (recorder) {
                recorder.markPlayerSpawn(player);
                recorder.logEvent(
                    'RESPAWN',
                    player.index,
                    `kind=${parcoursPlan ? 'parcours' : 'hunt'} delay=${Math.max(0, Number(pending?.delaySeconds) || 0).toFixed(2)} checkpoint=${parcoursPlan?.checkpointId || ''} shield=${Math.round(player.shieldHP || 0)} items=${player.inventory.length}`
                );
            }
            if (!parcoursPlan) {
                this.runtime?.events?.emitHuntFeed(`${getLabel(player)} ist wieder im Kampf`);
            }

            this.pendingByPlayer.delete(playerIndex);
        }
    }
}
