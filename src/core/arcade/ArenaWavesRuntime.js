import { trackArcadeColorEvent } from '../../shared/contracts/ArcadeColorProgressContract.js';
import {
    ARENA_WAVES_BOT_CAPACITY,
    ARENA_WAVES_CLEAR_REMAINDER_SECONDS,
    ARENA_WAVES_INTERVAL_SECONDS,
    ARENA_WAVES_MAPS,
    ARENA_WAVES_WAVES_PER_MAP,
    applyArenaWavesChoice,
    calculateArenaWavesScore,
    createArenaWavesUpgrades,
    resolveArenaWavesChoices,
    resolveArenaWavesSupplyPickup,
    resolveArenaWavesActiveBotLimit,
    resolveArenaWavesAggression,
    resolveArenaWavesBotRole,
    resolveArenaWavesMap,
    resolveArenaWavesMapMultipliers,
    resolveArenaWavesProfile,
} from '../../shared/contracts/ArenaWavesContract.js';
import { resolveArcadeRoleAggressiveness, resolveArcadeTierAggressiveness } from '../../shared/contracts/ArcadeBotAggressionContract.js';
import { resolveHigherArcadeBotDifficulty } from '../../entities/directors/ArcadeEncounterCatalog.js';
import { clampArcadeVehicleSpeedMultiplier } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import { XP_REWARD_TABLE } from '../../state/arcade/ArcadeVehicleProfile.js';
import { settleArcadeRunRanking } from '../../state/arcade/ArcadeRunRanking.js';
import {
    awardBoundArcadeVehicleXpInStore,
    bindArcadeVehicleRewards,
} from '../../state/arcade/ArcadeVehicleRewardBinding.js';

const RECORD_KEY = 'curviosclash.arena-waves-records.v2';
const RECORD_VERSION = 'arena-waves-records.v2';
const LEGACY_RECORD_KEY = 'curviosclash.arena-waves-records.v1';
const safe = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function loadRecords(store) {
    const value = store?.loadJsonRecord?.(RECORD_KEY, null);
    const previous = store?.loadJsonRecord?.(LEGACY_RECORD_KEY, null);
    const legacyBestTotal = previous?.version === 'arena-waves-records.v1' ? safe(previous.bestTotal) : 0;
    return value?.version === RECORD_VERSION
        ? { ...value, legacyBestTotal }
        : { version: RECORD_VERSION, lastTotal: 0, bestTotal: 0, legacyBestTotal };
}
function saveRecords(store, records) { store?.saveJsonRecord?.(RECORD_KEY, records); }

/** Dedicated finite Hunt run. It intentionally owns no parcours state. */
export class ArenaWavesRuntime {
    /** getPlayerRewardTarget(playerIndex): own store and plane of a split-screen partner, null for player one. */
    constructor({ now = () => Date.now(), getRecordStore = () => null, getPlayerRewardTarget = (_playerIndex) => null, requestMapTransition = null } = {}) {
        this._now = now;
        this._getRecordStore = getRecordStore;
        this._getPlayerRewardTarget = getPlayerRewardTarget;
        this._requestMapTransition = requestMapTransition;
        /** Rank context of the run; set by prepareArcadeRunRanking (ArcadeRunRankingOps), survives reset(). @type {any} */
        this.rankContext = null;
        this.reset();
    }

    reset() {
        this.entityManager = null; this.strategy = null;
        this.phase = 'idle'; this.mapIndex = 0; this.wave = 1; this.countdown = 0;
        this.upgrades = createArenaWavesUpgrades(); this.completedWaves = []; this.regularKills = 0; this.eliteKills = 0; this.fastClearSeconds = 0;
        this.mapStartedAt = 0; this.survivalSeconds = 0; this._activeSlots = new Set(); this._waveSlots = new Set(); this._eliteSlots = new Set();
        this._slotWave = new Map(); this._waveStatus = new Map();
        this._pendingWave = 1; this._nextWaveIn = null;
        this._plannedSlots = []; this._choices = []; this._choiceReason = ''; this._intermission = 0;
        this._pendingSupplyPickup = null; this._transitionRequested = false; this._succeeded = false; this.seed = 1;
        this.rewardBinding = null; this.xpEarned = 0; this.vehicleXpEarned = 0;
        this.mapStats = []; this._records = loadRecords(this._getRecordStore?.());
    }

    start({ entityManager, strategy = null, selectedMachineGunId = null, seed = 1, vehicleId = 'ship1' } = {}) {
        if (this.phase !== 'idle' && this.phase !== 'finished') {
            this.entityManager = entityManager || this.entityManager;
            this.strategy = strategy || this.strategy;
            this._applyHumanUpgrades(true);
            // A session rebuild follows a cleared arena and an upgrade choice.
            if (this.phase === 'transition') { this.phase = 'countdown'; this.countdown = 5; }
            if (this.phase === 'countdown') this._transitionRequested = false;
            return this.getHudState();
        }
        this.reset(); this.entityManager = entityManager || null; this.strategy = strategy || null; this.seed = Number(seed) >>> 0;
        this.rewardBinding = bindArcadeVehicleRewards({ runType: 'arena_waves', vehicleId });
        this.upgrades = createArenaWavesUpgrades({ machineGunId: selectedMachineGunId });
        this.mapStartedAt = this._now(); this.phase = 'countdown'; this.countdown = 5;
        this._applyHumanUpgrades(true); return this.getHudState();
    }

    _humans() { return this.entityManager?.humanPlayers || []; }
    _primaryHuman() { return this._humans().find((player) => player && player.isBot !== true) || null; }
    _human() { return this._humans().find((player) => player && player.isBot !== true && player.alive !== false) || this._primaryHuman(); }
    _applyHumanUpgrades(fullHeal = false) {
        const humans = this._humans(); if (!humans.length) return;
        this.strategy?.applyRunRewardEffects?.({
            speedBonusPct: this.upgrades.speed,
            maxHpBonus: this.upgrades.maxHp,
            spawnRateMultiplier: this.upgrades.pickup,
        });
        for (const player of humans) {
        if (!player || player.isBot === true) continue;
        player.arenaWavesLoadout = Object.freeze({
            machineGunId: this.upgrades.machineGunId,
            mgTuning: this.upgrades.mgTuning,
        });
        if (!Number.isFinite(player._arenaWavesBaseSpeed)) player._arenaWavesBaseSpeed = player.baseSpeed;
        // The run starts before the spawn: the base life is the spawn's (table/build) value, not the pre-spawn one.
        if (Number.isFinite(player._arcadeSpawnMaxHp)) { player._arenaWavesBaseMaxHp = player._arcadeSpawnMaxHp; player._arcadeSpawnMaxHp = undefined; }
        if (!Number.isFinite(player._arenaWavesBaseMaxHp)) player._arenaWavesBaseMaxHp = player.maxHp;
        const settingsBaseSpeed = Number(player._arcadeBaseSpeed);
        if (typeof this.strategy?.getSpeedMultiplier === 'function') {
            // The spawn formula: settings speed x vehicle table x hangar x arena reward, capped. Before the
            // spawn (_arcadeBaseSpeed unset) the spawn applies it itself, so the reward never counts twice.
            if (settingsBaseSpeed > 0) player.baseSpeed = settingsBaseSpeed * this.strategy.getSpeedMultiplier(player);
        } else {
            // Arena waves is always a normal Arcade run: cap relative to the settings base speed (_arcadeBaseSpeed).
            const speed = player._arenaWavesBaseSpeed * (1 + this.upgrades.speed / 100);
            player.baseSpeed = settingsBaseSpeed > 0
                ? settingsBaseSpeed * clampArcadeVehicleSpeedMultiplier(player.vehicleId, speed / settingsBaseSpeed) : speed;
        }
        player.speed = player.baseSpeed;
        player.maxHp = Math.max(1, player._arenaWavesBaseMaxHp + this.upgrades.maxHp);
        if (fullHeal) player.hp = player.maxHp;
        }
    }
    _planWave(wave = this.wave, warningSeconds = 1) {
        this._pendingWave = wave;
        this.phase = 'telegraph'; this.countdown = Math.max(0, warningSeconds);
    }
    _deactivateSlot(slot, reason, { creditedHuman = false } = {}) {
        const wave = this._slotWave.get(slot);
        const status = this._waveStatus.get(wave);
        if (status) {
            status.alive -= 1;
            if (reason !== 'killed') status.evicted = true;
            if (status.alive === 0) {
                if (!status.evicted) this._completeWave(wave);
                this._waveStatus.delete(wave);
            }
        }
        this._slotWave.delete(slot);
        this._activeSlots.delete(slot); this._waveSlots.delete(slot); this._eliteSlots.delete(slot);
        const player = this.entityManager?.bots?.[slot]?.player;
        if (player) { player.endlessDamageMultiplier = 1; player.arenaWavesDamageMultiplier = 1; player.arenaWavesElite = false; }
        this.entityManager?.deactivateBotSlot?.(slot, reason);
        if (reason === 'killed' && this.phase === 'combat' && this._activeSlots.size === 0) this._rewardFastClear(creditedHuman);
    }
    // The arena is empty: skip to the short warning window; only a human's last kill scores the skipped seconds.
    _rewardFastClear(creditedHuman) {
        const skipped = safe(this._nextWaveIn) - ARENA_WAVES_CLEAR_REMAINDER_SECONDS;
        if (skipped <= 0) return;
        this._nextWaveIn = ARENA_WAVES_CLEAR_REMAINDER_SECONDS;
        if (creditedHuman) this.fastClearSeconds += skipped;
    }
    _activeBotLimit() { return resolveArenaWavesActiveBotLimit(this.entityManager?.arena?.currentMapDefinition?.size); }
    _globalWave(wave) { return this.mapIndex * ARENA_WAVES_WAVES_PER_MAP + wave; }
    // The aggression wave bots spawn with; the HUD shows the same value.
    _waveAggression(globalWave) { return resolveArcadeTierAggressiveness(resolveArenaWavesAggression(this.mapIndex, globalWave), this.rankContext?.tierId); }
    // Free places up to the active limit; a wave larger than that only sends that many bots.
    _waveSpawnCount(profile) {
        const capacity = Math.min(ARENA_WAVES_BOT_CAPACITY, this.entityManager?.bots?.length || 0, this._activeBotLimit());
        return Math.max(0, Math.min(profile.count, capacity - this._activeSlots.size));
    }
    _activatePlannedWave() {
        const em = this.entityManager; if (!em) return;
        const globalWave = this._globalWave(this._pendingWave);
        const profile = resolveArenaWavesProfile(globalWave);
        const map = resolveArenaWavesMapMultipliers(this.mapIndex);
        if (!this._waveStatus.has(this._pendingWave)) {
            const count = this._waveSpawnCount(profile);
            // Full arena: this tick brings nobody, the next one tries again.
            if (count === 0) { this.phase = 'combat'; this._nextWaveIn = ARENA_WAVES_INTERVAL_SECONDS; return; }
            const capacity = Math.min(ARENA_WAVES_BOT_CAPACITY, em.bots.length);
            const slots = [];
            for (let slot = 0; slot < capacity && slots.length < count; slot += 1) {
                if (!this._activeSlots.has(slot)) slots.push(slot);
            }
            this._plannedSlots.length = 0;
            for (const slot of slots) {
                const position = em._findSpawnPosition?.(12, 12, { player: em.bots?.[slot]?.player }) || null;
                if (!position) return;
                this._plannedSlots.push({ slot, position });
            }
            this._waveStatus.set(this._pendingWave, { alive: 0, evicted: false });
        }
        const count = this._plannedSlots.length;
        const eliteSlot = profile.elite ? count - 1 : -1;
        const aggression = this._waveAggression(globalWave);
        const status = this._waveStatus.get(this._pendingWave);
        for (const [index, { slot, position }] of this._plannedSlots.entries()) {
            if (this._slotWave.get(slot) === this._pendingWave) continue;
            const role = resolveArenaWavesBotRole(index, eliteSlot);
            if (em.activateBotSlot?.({ slot, position, role, difficulty: resolveHigherArcadeBotDifficulty(this.rankContext?.botStrength?.ai, profile.difficulty) }) !== true) continue;
            const player = em.bots?.[slot]?.player; const ai = em.bots?.[slot]?.ai;
            if (!player) continue;
            if (!Number.isFinite(player._arenaWavesBaseMaxHp)) player._arenaWavesBaseMaxHp = safe(player.maxHp, 100);
            player.maxHp = Math.max(1, player._arenaWavesBaseMaxHp * profile.hp * map.hp);
            player.hp = player.maxHp; player.arenaWavesElite = index === eliteSlot;
            // MG and projectile resolvers already consume this field for bot damage.
            player.endlessDamageMultiplier = profile.damage * map.damage;
            player.arenaWavesDamageMultiplier = profile.damage * map.damage;
            // Every policy chain forwards this to its rule-based core, which rebuilds the profile from the difficulty.
            ai?.setArcadeBotAggressiveness?.(resolveArcadeRoleAggressiveness(aggression, role));
            this._activeSlots.add(slot); this._waveSlots.add(slot); this._slotWave.set(slot, this._pendingWave);
            status.alive += 1;
            if (player.arenaWavesElite) this._eliteSlots.add(slot);
        }
        if (status.alive === count) {
            this.wave = this._pendingWave;
            trackArcadeColorEvent(this._colorProgress, { type: 'wave_reached', wave: this.wave });
            this._nextWaveIn = ARENA_WAVES_INTERVAL_SECONDS;
            this._plannedSlots.length = 0; this.phase = 'combat';
            this._spawnPendingSupply();
        }
    }
    _spawnPendingSupply() {
        const type = this._pendingSupplyPickup; const human = this._human();
        if (!type || !human?.position) return;
        this.entityManager?.powerupManager?.spawnAtAnchor?.({
            ownerId: 'arena-waves-supply', type,
            x: Number(human.position.x) || 0, y: (Number(human.position.y) || 0) + 1, z: Number(human.position.z) || 0,
        });
        this._pendingSupplyPickup = null;
    }
    _deactivateBots(reason) {
        for (const slot of [...this._activeSlots]) this._deactivateSlot(slot, reason);
        this._activeSlots.clear(); this._waveSlots.clear(); this._eliteSlots.clear(); this._plannedSlots.length = 0;
        this._slotWave.clear(); this._waveStatus.clear();
    }
    handleGameplayEvent(event) {
        if ((this.phase !== 'combat' && this.phase !== 'telegraph') || String(event?.type) !== 'kill') return null;
        const victim = this.entityManager?.players?.find((player) => Number(player?.index) === Number(event?.victimIndex));
        if (!victim?.isBot) return null;
        const slot = this.entityManager?.bots?.findIndex((entry) => entry?.player === victim);
        if (!this._activeSlots.has(slot)) return null;
        const creditedHuman = this.entityManager?.humanPlayers?.find((player) => player?.index === event.playerIndex) || null;
        if (creditedHuman) {
            trackArcadeColorEvent(this._colorProgress, event);
            if (this._eliteSlots.has(slot)) this.eliteKills += 1; else this.regularKills += 1;
            // A split-screen partner with an own profile levels the plane he flies, in his own store.
            const partner = Number(event.playerIndex) === Number(this._primaryHuman()?.index) ? null : this._getPlayerRewardTarget?.(event.playerIndex);
            const result = awardBoundArcadeVehicleXpInStore(
                partner ? partner.store : this._getRecordStore?.(),
                partner ? bindArcadeVehicleRewards({ runType: 'arena_waves', vehicleId: partner.vehicleId }) : this.rewardBinding,
                XP_REWARD_TABLE.killBase,
                this._now()
            );
            if (result) this.xpEarned += result.earned;
            if (result && !partner) this.vehicleXpEarned += result.earned;
        }
        this._deactivateSlot(slot, 'killed', { creditedHuman: creditedHuman?.alive === true });
        return this.getHudState();
    }
    _completeWave(wave) {
        if (this.completedWaves.includes(wave)) return;
        this.completedWaves.push(wave);
        trackArcadeColorEvent(this._colorProgress, { type: 'wave_complete', completedWaves: this.mapStats.reduce((sum, stat) => sum + (stat?.completedWaves?.length || 0), 0) + this.completedWaves.length });
    }
    _openChoices(reason) {
        this.phase = 'upgrade'; this._intermission += 1;
        this._choices = resolveArenaWavesChoices(this.upgrades, this.upgrades.machineGunId, this.seed, this._intermission);
        this._applyHumanUpgrades(true); this._choiceReason = reason;
    }
    selectChoice(choiceId) {
        if (this.phase !== 'upgrade' || !this._choices.includes(choiceId)) return null;
        this.upgrades = applyArenaWavesChoice(this.upgrades, choiceId);
        this._pendingSupplyPickup = resolveArenaWavesSupplyPickup(choiceId) || this._pendingSupplyPickup;
        this._choices = []; this._applyHumanUpgrades(true);
        if (this._choiceReason === 'arena') {
            this.phase = 'transition';
            if (!this._transitionRequested) {
                this._transitionRequested = true;
                this._requestMapTransition?.({ mapKey: resolveArenaWavesMap(this.mapIndex), botCount: ARENA_WAVES_BOT_CAPACITY, arenaWaves: true });
            }
        } else { this._nextWaveIn = null; this._planWave(this.wave + 1); }
        return this.getHudState();
    }
    _finishArena() {
        this._deactivateBots('arena_clear');
        this._closeMapStats();
        if (this.mapIndex >= ARENA_WAVES_MAPS.length - 1) { this._finalize(true); return; }
        this.mapIndex += 1; this.wave = 1; this.completedWaves = []; this.regularKills = 0; this.eliteKills = 0; this.fastClearSeconds = 0; this.survivalSeconds = 0; this.mapStartedAt = this._now();
        this._nextWaveIn = null; this._pendingWave = 1;
        this._openChoices('arena');
    }
    _onHumanDeath() {
        this._deactivateBots('group_death');
        this._finalize(false);
    }
    _closeMapStats() { this.mapStats[this.mapIndex] = { mapKey: resolveArenaWavesMap(this.mapIndex), score: this.score, survivalSeconds: this.survivalSeconds, regularKills: this.regularKills, eliteKills: this.eliteKills, fastClearSeconds: this.fastClearSeconds, completedWaves: [...this.completedWaves] }; }
    _finalize(succeeded) {
        if (this.phase === 'finished') return;
        this._closeMapStats(); this.phase = 'finished'; this._succeeded = succeeded;
        const total = this.totalScore;
        this._records = { version: RECORD_VERSION, lastTotal: total, bestTotal: Math.max(total, safe(this._records.bestTotal)), legacyBestTotal: safe(this._records.legacyBestTotal) };
        saveRecords(this._getRecordStore?.(), this._records);
        const completedWaveCount = this.mapStats.reduce((sum, stat) => sum + (stat?.completedWaves?.length || 0), 0);
        this.ranking = settleArcadeRunRanking(this, { total, succeeded, completedWaveCount, lastCompletedWave: completedWaveCount });
        this._onJourneyCompleted?.({ succeeded, value: total });
    }
    update(dt) {
        if (this.phase === 'idle' || this.phase === 'finished') return;
        const humans = this._humans();
        if (humans.length && humans.every((player) => !player || player.isBot === true || player.alive === false)) {
            this._onHumanDeath(); return;
        }
        // A fresh spawn reset max HP to its table/build value: re-apply the run's upgrades on top.
        if (humans.some((player) => Number.isFinite(player?._arcadeSpawnMaxHp))) this._applyHumanUpgrades(true);
        const elapsed = Math.max(0, safe(dt));
        if (this.phase === 'combat' || (this.phase === 'telegraph' && (this._nextWaveIn !== null || this._activeSlots.size > 0))) this.survivalSeconds += elapsed;
        if (this.phase === 'countdown') {
            this.countdown = Math.max(0, this.countdown - elapsed);
            if (this.countdown === 0) this._planWave();
        } else if (this.phase === 'combat') {
            this._nextWaveIn = Math.max(0, this._nextWaveIn - elapsed);
            const won = this.completedWaves.length >= ARENA_WAVES_WAVES_PER_MAP;
            // An emptied arena keeps its short pause; leftover bots of later waves leave with the win.
            if (won && (this._activeSlots.size > 0 || this._nextWaveIn <= 1)) this._finishArena();
            else if (!won && this._nextWaveIn <= 1) {
                const pending = resolveArenaWavesProfile(this._globalWave(this.wave + 1));
                // No free place: skip this tick without a warning and keep the 30 s rhythm.
                if (this._waveSpawnCount(pending) === 0) this._nextWaveIn += ARENA_WAVES_INTERVAL_SECONDS;
                else {
                    this._planWave(this.wave + 1, this._nextWaveIn);
                    if (this.countdown === 0) this._activatePlannedWave();
                }
            }
        } else if (this.phase === 'telegraph') {
            this.countdown = Math.max(0, this.countdown - elapsed);
            if (this.countdown === 0) {
                // A last kill inside the warning second already won the arena: no wave follows.
                if (this.completedWaves.length >= ARENA_WAVES_WAVES_PER_MAP) this.phase = 'combat';
                else this._activatePlannedWave();
            }
        }
    }
    get score() { return calculateArenaWavesScore({ survivalSeconds: this.survivalSeconds, regularKills: this.regularKills, eliteKills: this.eliteKills, completedWaves: this.completedWaves, fastClearSeconds: this.fastClearSeconds }); }
    get totalScore() { return this.mapStats.reduce((total, stat) => total + (Number(stat?.score) || 0), 0) + (this.mapStats[this.mapIndex] ? 0 : this.score); }
    dispose() {
        this._deactivateBots('runtime_dispose');
        for (const player of this.entityManager?.players || []) this.entityManager?._projectileSystem?.clearForOwner?.(player);
        this.entityManager?.powerupManager?.removeByOwnerId?.('arena-waves-supply');
        for (const human of this._humans()) {
            if (!human || human.isBot === true) continue;
            if (Number.isFinite(human._arenaWavesBaseSpeed)) { human.baseSpeed = human._arenaWavesBaseSpeed; human.speed = human.baseSpeed; }
            if (Number.isFinite(human._arenaWavesBaseMaxHp)) human.maxHp = human._arenaWavesBaseMaxHp;
            human.arenaWavesLoadout = undefined;
        }
        this.strategy?.applyRunRewardEffects?.(null); this.reset();
    }
    getHudState() { const pendingCount = this.phase === 'telegraph' ? this._waveSpawnCount(resolveArenaWavesProfile(this._globalWave(this._pendingWave))) : 0; return { runType: 'arena_waves', vehicleId: this.rewardBinding?.vehicleId || '', xpEarned: this.xpEarned, vehicleXpEarned: this.vehicleXpEarned, phase: this.phase, mapIndex: this.mapIndex, mapCount: ARENA_WAVES_MAPS.length, currentMapKey: resolveArenaWavesMap(this.mapIndex), wave: this.wave, wavesPerMap: ARENA_WAVES_WAVES_PER_MAP, countdown: this.countdown, nextWaveInSeconds: this.phase === 'upgrade' || this.phase === 'finished' ? null : (this.phase === 'combat' ? this._nextWaveIn : (this.phase === 'countdown' ? this.countdown + 1 : this.countdown)), alive: this._activeSlots.size, plannedSpawnCount: pendingCount, spawnWarning: this.phase === 'telegraph' ? { remaining: this.countdown, count: pendingCount } : null, aggression: this._waveAggression(this._globalWave(this.wave)), kills: { regular: this.regularKills, elite: this.eliteKills }, fastClearSeconds: this.fastClearSeconds,survivalSeconds: this.survivalSeconds, upgrades: { ...this.upgrades }, choices: [...this._choices], choiceReason: this._choiceReason, score: { total: this.totalScore, currentMap: this.score }, mapStats: this.mapStats.map((stat) => ({ ...stat })), postRunSummary: this.phase === 'finished' ? { ranking: this.ranking, total: this.totalScore, succeeded: this._succeeded, maps: this.mapStats.map((stat) => ({ ...stat })) } : null, records: { ...this._records } }; }
}
