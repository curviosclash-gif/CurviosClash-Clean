import { grantShield } from './HealthSystem.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';

function getLabel(player) {
    if (!player) return 'Spieler';
    return player.isBot ? `Bot ${player.index + 1}` : `P${player.index + 1}`;
}

function getRespawnConfig(runtimeContext = null) {
    return resolveEntityRuntimeConfig(runtimeContext)?.HUNT?.RESPAWN || {};
}

function resetRespawnInventory(player, respawnConfig) {
    if (!player || respawnConfig?.RESET_INVENTORY === false) return;
    player.inventory.length = 0;
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

export class RespawnSystem {
    constructor(runtimeContext) {
        this.runtime = runtimeContext || null;
        this.pendingByPlayer = new Map();
    }

    isEnabled() {
        const strategy = this.runtime?.callbacks?.getStrategy?.() || null;
        return strategy?.isRespawnEnabled() ?? false;
    }

    reset() {
        this.pendingByPlayer.clear();
    }

    onPlayerDied(player) {
        if (!this.isEnabled() || !player) return false;
        const delaySeconds = Math.max(0.1, Number(getRespawnConfig(this.runtime)?.DELAY_SECONDS || 3));
        this.pendingByPlayer.set(player.index, {
            player,
            remaining: delaySeconds,
        });
        return true;
    }

    isRespawnPending(player) {
        if (!player) return false;
        return this.pendingByPlayer.has(player.index);
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
            if (!player || player.alive) {
                this.pendingByPlayer.delete(playerIndex);
                continue;
            }

            pending.remaining -= safeDt;
            if (pending.remaining > 0) continue;

            const respawnConfig = getRespawnConfig(this.runtime);
            const entityRuntimeConfig = resolveEntityRuntimeConfig(this.runtime);
            const planarSpawnLevel = entityRuntimeConfig.GAMEPLAY.PLANAR_MODE && this.runtime?.spawn?.getPlanarSpawnLevel
                ? this.runtime.spawn.getPlanarSpawnLevel()
                : null;
            const minEnemyDistance = Math.max(12, Number(respawnConfig?.MIN_ENEMY_DISTANCE || 18));
            const spawnPos = this.runtime.spawn.findSpawnPosition(minEnemyDistance, 12, {
                planarLevel: planarSpawnLevel,
                player,
            });
            const spawnDir = this.runtime.spawn.findSafeSpawnDirection(spawnPos, player.hitboxRadius);
            player.spawn(spawnPos, spawnDir);
            this.runtime?.callbacks?.parcours?.onPlayerSpawn?.(player, { reason: 'respawn' });

            resetRespawnInventory(player, respawnConfig);
            applyRespawnRecovery(player, respawnConfig);

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
                    `delay=${Math.max(0, Number(respawnConfig?.DELAY_SECONDS || 3)).toFixed(2)} shield=${Math.round(player.shieldHP || 0)} items=${player.inventory.length}`
                );
            }
            this.runtime?.events?.emitHuntFeed(`${getLabel(player)} respawned`);

            this.pendingByPlayer.delete(playerIndex);
        }
    }
}
