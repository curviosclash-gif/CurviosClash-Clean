import {
    ARENA_WAVES_BOT_CAPACITY,
    ARENA_WAVES_INTERVAL_SECONDS,
    ARENA_WAVES_MAPS,
    applyArenaWavesChoice,
    calculateArenaWavesScore,
    createArenaWavesUpgrades,
    resolveArenaWavesChoices,
    resolveArenaWavesSupplyPickup,
    resolveArenaWavesAggression,
    resolveArenaWavesMap,
    resolveArenaWavesMapMultipliers,
    resolveArenaWavesProfile,
} from '../../shared/contracts/ArenaWavesContract.js';
import { applyArcadeBotAggressiveness } from '../../shared/contracts/ArcadeBotAggressionContract.js';

const RECORD_KEY = 'curviosclash.arena-waves-records.v1';
const RECORD_VERSION = 'arena-waves-records.v1';
const safe = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function loadRecords(store) {
    const value = store?.loadJsonRecord?.(RECORD_KEY, null);
    return value?.version === RECORD_VERSION ? value : { version: RECORD_VERSION, lastTotal: 0, bestTotal: 0 };
}
function saveRecords(store, records) { store?.saveJsonRecord?.(RECORD_KEY, records); }

/** Dedicated single-player Hunt run. It intentionally owns no parcours state. */
export class ArenaWavesRuntime {
    constructor({ now = () => Date.now(), getRecordStore = () => null, requestMapTransition = null } = {}) {
        this._now = now;
        this._getRecordStore = getRecordStore;
        this._requestMapTransition = requestMapTransition;
        this.reset();
    }

    reset() {
        this.entityManager = null; this.strategy = null;
        this.phase = 'idle'; this.mapIndex = 0; this.wave = 1; this.countdown = 0;
        this.upgrades = createArenaWavesUpgrades(); this.completedWaves = []; this.regularKills = 0; this.eliteKills = 0;
        this.mapStartedAt = 0; this.survivalSeconds = 0; this._activeSlots = new Set(); this._waveSlots = new Set(); this._eliteSlots = new Set();
        this._slotWave = new Map(); this._waveStatus = new Map(); this._spawnOrder = [];
        this._pendingWave = 1; this._nextWaveIn = null;
        this._plannedSlots = []; this._choices = []; this._choiceReason = ''; this._intermission = 0;
        this._pendingSupplyPickup = null; this._transitionRequested = false; this.seed = 1;
        this.mapStats = []; this._records = loadRecords(this._getRecordStore?.());
    }

    start({ entityManager, strategy = null, selectedMachineGunId = null, seed = 1 } = {}) {
        if (this.phase !== 'idle' && this.phase !== 'finished') {
            this.entityManager = entityManager || this.entityManager;
            this.strategy = strategy || this.strategy;
            this._applyHumanUpgrades(true);
            // A session rebuild only happens after the one permitted death choice.
            if (this.phase === 'transition') { this.phase = 'countdown'; this.countdown = 5; }
            if (this.phase === 'countdown') this._transitionRequested = false;
            return this.getHudState();
        }
        this.reset(); this.entityManager = entityManager || null; this.strategy = strategy || null; this.seed = Number(seed) >>> 0;
        this.upgrades = createArenaWavesUpgrades({ machineGunId: selectedMachineGunId });
        this.mapStartedAt = this._now(); this.phase = 'countdown'; this.countdown = 5;
        this._applyHumanUpgrades(true); return this.getHudState();
    }

    _human() { return this.entityManager?.humanPlayers?.find((player) => player && player.isBot !== true) || null; }
    _applyHumanUpgrades(fullHeal = false) {
        const player = this._human(); if (!player) return;
        if (!Object.prototype.hasOwnProperty.call(player, '_arenaWavesBaseMachineGunId')) player._arenaWavesBaseMachineGunId = player.fightLoadout?.machineGunId;
        player.fightLoadout = { ...(player.fightLoadout || {}), machineGunId: this.upgrades.machineGunId, arenaWavesMgTuning: this.upgrades.mgTuning };
        if (!Number.isFinite(player._arenaWavesBaseSpeed)) player._arenaWavesBaseSpeed = player.baseSpeed;
        if (!Number.isFinite(player._arenaWavesBaseMaxHp)) player._arenaWavesBaseMaxHp = player.maxHp;
        player.baseSpeed = player._arenaWavesBaseSpeed * (1 + this.upgrades.speed / 100);
        player.speed = player.baseSpeed;
        player.maxHp = Math.max(1, player._arenaWavesBaseMaxHp + this.upgrades.maxHp);
        if (fullHeal) player.hp = player.maxHp;
        this.strategy?.applyRunRewardEffects?.({
            speedBonusPct: this.upgrades.speed,
            maxHpBonus: this.upgrades.maxHp,
            spawnRateMultiplier: this.upgrades.pickup,
        });
    }
    _planWave(wave = this.wave, warningSeconds = 1) {
        this._pendingWave = wave;
        this.phase = 'telegraph'; this.countdown = Math.max(0, warningSeconds);
    }
    _deactivateSlot(slot, reason) {
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
        const orderIndex = this._spawnOrder.indexOf(slot);
        if (orderIndex >= 0) this._spawnOrder.splice(orderIndex, 1);
        const player = this.entityManager?.bots?.[slot]?.player;
        if (player) { player.endlessDamageMultiplier = 1; player.arenaWavesDamageMultiplier = 1; player.arenaWavesElite = false; }
        this.entityManager?.deactivateBotSlot?.(slot, reason);
    }
    _activatePlannedWave() {
        const em = this.entityManager; if (!em) return;
        const profile = resolveArenaWavesProfile(this._pendingWave);
        const map = resolveArenaWavesMapMultipliers(this.mapIndex);
        const count = Math.min(profile.count, ARENA_WAVES_BOT_CAPACITY);
        const capacity = Math.min(ARENA_WAVES_BOT_CAPACITY, em.bots?.length || 0);
        if (capacity < count) return;
        if (!this._waveStatus.has(this._pendingWave)) {
            const excess = Math.max(0, this._activeSlots.size + count - capacity);
            const slots = [];
            for (let slot = 0; slot < capacity && slots.length < count; slot += 1) {
                if (!this._activeSlots.has(slot)) slots.push(slot);
            }
            for (let index = 0; index < excess; index += 1) slots.push(this._spawnOrder[index]);
            if (slots.length < count) return;
            this._plannedSlots.length = 0;
            for (const slot of slots) {
                const position = em._findSpawnPosition?.(12, 12, { player: em.bots?.[slot]?.player }) || null;
                if (!position) return;
                this._plannedSlots.push({ slot, position });
            }
            for (let index = 0; index < excess; index += 1) this._deactivateSlot(this._spawnOrder[0], 'wave_capacity');
            this._waveStatus.set(this._pendingWave, { alive: 0, evicted: false });
        }
        const aggression = resolveArenaWavesAggression(this.mapIndex, this._pendingWave);
        const status = this._waveStatus.get(this._pendingWave);
        for (const [index, { slot, position }] of this._plannedSlots.entries()) {
            if (this._slotWave.get(slot) === this._pendingWave) continue;
            if (em.activateBotSlot?.({ slot, position, difficulty: profile.difficulty }) !== true) continue;
            const player = em.bots?.[slot]?.player; const ai = em.bots?.[slot]?.ai;
            if (!player) continue;
            if (!Number.isFinite(player._arenaWavesBaseMaxHp)) player._arenaWavesBaseMaxHp = safe(player.maxHp, 100);
            player.maxHp = Math.max(1, player._arenaWavesBaseMaxHp * profile.hp * map.hp);
            player.hp = player.maxHp; player.arenaWavesElite = index === profile.eliteSlot;
            // MG and projectile resolvers already consume this field for bot damage.
            player.endlessDamageMultiplier = profile.damage * map.damage;
            player.arenaWavesDamageMultiplier = profile.damage * map.damage;
            if (!ai?._arenaWavesBaseProfile) ai._arenaWavesBaseProfile = Object.freeze({ ...(ai?.profile || {}) });
            ai?.setProfile?.(applyArcadeBotAggressiveness(ai._arenaWavesBaseProfile, aggression));
            this._activeSlots.add(slot); this._waveSlots.add(slot); this._slotWave.set(slot, this._pendingWave);
            this._spawnOrder.push(slot); status.alive += 1;
            if (player.arenaWavesElite) this._eliteSlots.add(slot);
        }
        if (status.alive === count) {
            this.wave = this._pendingWave;
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
        this._slotWave.clear(); this._waveStatus.clear(); this._spawnOrder.length = 0;
    }
    handleGameplayEvent(event) {
        if ((this.phase !== 'combat' && this.phase !== 'telegraph') || String(event?.type) !== 'kill') return null;
        const victim = this.entityManager?.players?.find((player) => Number(player?.index) === Number(event?.victimIndex));
        if (!victim?.isBot) return null;
        const slot = this.entityManager?.bots?.findIndex((entry) => entry?.player === victim);
        if (!this._activeSlots.has(slot)) return null;
        const creditedHuman = this.entityManager?.humanPlayers?.some((player) => player?.index === event.playerIndex);
        if (creditedHuman) {
            if (this._eliteSlots.has(slot)) this.eliteKills += 1; else this.regularKills += 1;
        }
        this._deactivateSlot(slot, 'killed');
        return this.getHudState();
    }
    _completeWave(wave) { this.completedWaves.push(wave); }
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
        if (this._choiceReason === 'death') {
            this.phase = 'transition';
            if (!this._transitionRequested) {
                this._transitionRequested = true;
                this._requestMapTransition?.({ mapKey: resolveArenaWavesMap(this.mapIndex), botCount: ARENA_WAVES_BOT_CAPACITY, arenaWaves: true });
            }
        } else { this._nextWaveIn = null; this._planWave(this.wave + 1); }
        return this.getHudState();
    }
    _onHumanDeath() {
        this._deactivateBots('map_death');
        if (this.mapIndex >= ARENA_WAVES_MAPS.length - 1) { this._finalize(); return; }
        this._closeMapStats(); this.mapIndex += 1; this.wave = 1; this.completedWaves = []; this.regularKills = 0; this.eliteKills = 0; this.survivalSeconds = 0; this.mapStartedAt = this._now();
        this._nextWaveIn = null; this._pendingWave = 1;
        this._openChoices('death');
    }
    _closeMapStats() { this.mapStats[this.mapIndex] = { mapKey: resolveArenaWavesMap(this.mapIndex), score: this.score, survivalSeconds: this.survivalSeconds, regularKills: this.regularKills, eliteKills: this.eliteKills, completedWaves: [...this.completedWaves] }; }
    _finalize() { this._closeMapStats(); this.phase = 'finished'; const total = this.totalScore; this._records = { version: RECORD_VERSION, lastTotal: total, bestTotal: Math.max(total, safe(this._records.bestTotal)) }; saveRecords(this._getRecordStore?.(), this._records); }
    update(dt) {
        if (this.phase === 'idle' || this.phase === 'finished') return;
        const human = this._human();
        if (human && human.alive === false && (this.phase === 'combat' || this.phase === 'countdown' || this.phase === 'telegraph')) {
            this._onHumanDeath(); return;
        }
        const elapsed = Math.max(0, safe(dt));
        if (this.phase === 'combat' || (this.phase === 'telegraph' && (this._nextWaveIn !== null || this._activeSlots.size > 0))) this.survivalSeconds += elapsed;
        if (this.phase === 'countdown') {
            this.countdown = Math.max(0, this.countdown - elapsed);
            if (this.countdown === 0) this._planWave();
        } else if (this.phase === 'combat') {
            this._nextWaveIn = Math.max(0, this._nextWaveIn - elapsed);
            if (this._nextWaveIn <= 1) {
                if (this._nextWaveIn === 0 && this.wave % 4 === 0) this._openChoices('wave');
                else {
                    this._planWave(this.wave + 1, this._nextWaveIn);
                    if (this.countdown === 0) this._activatePlannedWave();
                }
            }
        } else if (this.phase === 'telegraph') {
            this.countdown = Math.max(0, this.countdown - elapsed);
            if (this.countdown === 0) {
                if (this.wave % 4 === 0 && this._pendingWave === this.wave + 1 && this._nextWaveIn !== null) this._openChoices('wave');
                else this._activatePlannedWave();
            }
        }
    }
    get score() { return calculateArenaWavesScore({ survivalSeconds: this.survivalSeconds, regularKills: this.regularKills, eliteKills: this.eliteKills, completedWaves: this.completedWaves }); }
    get totalScore() { return this.mapStats.reduce((total, stat) => total + (Number(stat?.score) || 0), 0) + (this.mapStats[this.mapIndex] ? 0 : this.score); }
    dispose() {
        this._deactivateBots('runtime_dispose');
        for (const player of this.entityManager?.players || []) this.entityManager?._projectileSystem?.clearForOwner?.(player);
        this.entityManager?.powerupManager?.removeByOwnerId?.('arena-waves-supply');
        const human = this._human();
        if (human) {
            if (Number.isFinite(human._arenaWavesBaseSpeed)) { human.baseSpeed = human._arenaWavesBaseSpeed; human.speed = human.baseSpeed; }
            if (Number.isFinite(human._arenaWavesBaseMaxHp)) human.maxHp = human._arenaWavesBaseMaxHp;
            if (human.fightLoadout) {
                human.fightLoadout.arenaWavesMgTuning = 0;
                human.fightLoadout.machineGunId = human._arenaWavesBaseMachineGunId || human.fightLoadout.machineGunId;
            }
        }
        this.strategy?.applyRunRewardEffects?.(null); this.reset();
    }
    getHudState() { return { runType: 'arena_waves', phase: this.phase, mapIndex: this.mapIndex, mapCount: ARENA_WAVES_MAPS.length, currentMapKey: resolveArenaWavesMap(this.mapIndex), wave: this.wave, countdown: this.countdown, nextWaveInSeconds: this.phase === 'upgrade' || this.phase === 'finished' ? null : (this.phase === 'combat' ? this._nextWaveIn : (this.phase === 'countdown' ? this.countdown + 1 : this.countdown)), alive: this._activeSlots.size, plannedSpawnCount: this.phase === 'telegraph' ? resolveArenaWavesProfile(this._pendingWave).count : 0, spawnWarning: this.phase === 'telegraph' ? { remaining: this.countdown, count: resolveArenaWavesProfile(this._pendingWave).count } : null, aggression: resolveArenaWavesAggression(this.mapIndex, this.wave), kills: { regular: this.regularKills, elite: this.eliteKills }, survivalSeconds: this.survivalSeconds, upgrades: { ...this.upgrades }, choices: [...this._choices], choiceReason: this._choiceReason, score: { total: this.totalScore, currentMap: this.score }, mapStats: this.mapStats.map((stat) => ({ ...stat })), postRunSummary: this.phase === 'finished' ? { total: this.totalScore, maps: this.mapStats.map((stat) => ({ ...stat })) } : null, records: { ...this._records } }; }
}
