// ============================================
// GameModeContract.js - abstract base class for game mode strategies
// ============================================
//
// V84 / 84.3.1: Added unified lifecycle hooks for kernel-driven session orchestration.

export const GAME_MODE_CONTRACT_VERSION = 'game-mode-contract.v1';

export class GameModeContract {
    /** @returns {string} */
    get modeType() { throw new Error('abstract: modeType'); }
    getPickupModeType() { return this.modeType; }
    getCombatProfile() { return ''; }
    isEndlessParcours() { return false; }
    hasCombatHud() { return this.modeType === 'HUNT'; }

    // --- Lifecycle (V84 / 84.3.1) ---

    /**
     * bootstrap – called once when the mode session starts (after kernel boot).
     * Override to initialise mode-specific state.
     *
     * @param {{ kernel, session, settings, runtimeConfig }} context
     */
    bootstrap(context) { void context; }

    /**
     * cleanup – called once when the mode session ends (before kernel dispose).
     * Override to tear down mode-specific state.
     *
     * @param {{ kernel, session, roundResults }} context
     */
    cleanup(context) { void context; }

    // --- Health & Damage ---
    resetPlayerHealth(player, config) { void player; void config; }
    applyDamage(player, amount, options, config) { void player; void amount; void options; void config; return { applied: 0, absorbedByShield: 0, remainingHp: 0, isDead: false }; }
    applyHealing(player, amount, config) { void player; void amount; void config; return { healed: 0, hp: 0 }; }
    resolveCollisionDamage(cause, config) { void cause; void config; return 1; }
    resolveCollisionCooldown(cause, config) { void cause; void config; return 0.5; }
    grantShield(player, config) { void player; void config; return 0; }
    updateHealthRegen(player, dt, config, nowSeconds) { void player; void dt; void config; void nowSeconds; }

    // --- Collision Response ---
    handleWallCollision(player, arenaCollision, entityManager) { void player; void arenaCollision; void entityManager; return false; }
    handleTrailCollision(player, collision, trailCause, sourcePlayer, entityManager) { void player; void collision; void trailCause; void sourcePlayer; void entityManager; return false; }
    handlePlayerCrash(player, otherPlayer, crashNormal, entityManager) { void player; void otherPlayer; void crashNormal; void entityManager; return false; }

    // --- Actions ---
    requiresShootItemIndex() { return false; }
    hasMachineGun() { return false; }

    // --- Projectiles ---
    resolveRocketProjectileParams(type, config) { void type; void config; return null; }

    // --- Spawning ---
    isRespawnEnabled(config) { void config; return false; }
    // Respawn rules a mode supplies for parcours routes that author none, e.g. in an Arcade sector.
    getParcoursRespawnFallback() { return null; }
    filterSpawnableTypes(typeKeys, powerupTypes, huntModeActive) { void powerupTypes; void huntModeActive; return typeKeys; }
    // Jede konkrete Strategie setzt this._random aus dem gesetzten Runtime-Wuerfel und
    // ueberschreibt diese Methode. Die Basis darf trotzdem nicht auf den globalen Zufall
    // ausweichen: ein vierter Modus wuerde sonst eine nicht reproduzierbare Auswahl erben,
    // ohne dass es auffaellt. Ohne Wuerfel entscheidet ein konstanter Wurf.
    resolveSpawnType(spawnableTypes, config) {
        void config;
        if (!Array.isArray(spawnableTypes) || spawnableTypes.length === 0) return undefined;
        const roll = typeof this._random === 'function' ? Number(this._random()) : 0.5;
        const index = Math.floor((Number.isFinite(roll) ? roll : 0.5) * spawnableTypes.length);
        return spawnableTypes[Math.min(Math.max(index, 0), spawnableTypes.length - 1)];
    }

    // --- Features ---
    hasScoring() { return false; }
    hasDamageEvents() { return false; }
    hasDestructibleTrails() { return false; }
    isHudVisible() { return false; }
}
