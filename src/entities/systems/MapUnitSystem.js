import * as THREE from 'three';
import { normalizeMapUnit, resolveMapUnitDefinitions } from '../../shared/contracts/MapUnitContract.js';
import { isTurretCombatActive } from '../../shared/contracts/TurretCombatContract.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import {
    advanceUnitOnPath,
    resetUnitOnPath,
    resolveUnitPathPose,
    turnYawTowards,
} from './map-units/MapUnitMovementOps.js';
import {
    TANK_TURRET_HEIGHT,
    createMapUnitAssets,
    createMapUnitVisual,
    disposeMapUnitAssets,
    removeMapUnitVisual,
    updateMapUnitVisual,
} from './map-units/MapUnitVisualOps.js';
import { createUnitMounts, createUnitSource, updateUnitWeapons } from './map-units/MapUnitWeaponOps.js';
import { applyMapUnitDamage, tickMapUnitRespawns } from './map-units/MapUnitDamageOps.js';
import { crushTrailsUnderUnit } from './map-units/MapUnitTrailOps.js';
import { applyMapUnitsNetworkState, serializeMapUnits } from './map-units/MapUnitNetworkOps.js';
import {
    bindSwarmMemberCombat,
    createSwarmMembers,
    resetSwarmMembers,
    updateSwarmMembers,
} from './map-units/MapUnitSwarmOps.js';
import {
    createSwarmAssets,
    createSwarmVisual,
    disposeSwarmAssets,
    updateSwarmVisual,
} from './map-units/MapUnitSwarmVisualOps.js';
import {
    createBomberAssets,
    createBomberVisual,
    disposeBomberAssets,
    updateBomberVisual,
} from './map-units/MapUnitBomberVisualOps.js';
import { updateBomberBombs } from './map-units/MapUnitBombOps.js';
import { updateBomberCrash } from './map-units/MapUnitBomberCrashOps.js';
import {
    createCreatureAssets,
    createCreatureVisual,
    disposeCreatureAssets,
    updateCreatureVisual,
} from './map-units/MapUnitCreatureVisualOps.js';
import { updateCreatureAttack } from './map-units/MapUnitCreatureOps.js';
import { GAME_MODE_TYPES } from '../../hunt/HuntMode.js';
import {
    bindEscortTank,
    createEscortTankDefinition,
    resolveEscortMapUnitOutcome,
    updateEscortTankSpeed,
} from './map-units/EscortMapUnitOps.js';

// How fast the hull swings round at a path corner, in radians per second.
const HULL_TURN_RATE = 2.5;

/**
 * Map units (E46/E53): map-owned targets that follow an authored path. This system owns their
 * lifecycle from round start through cleanup. `position` is the point weapons aim at;
 * `groundPosition` is the authored path pose before a kind-specific visual offset.
 */
export class MapUnitSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.units = [];
        this._assets = null;
        this._swarmAssets = null;
        this._bomberAssets = null;
        this._creatureAssets = null;
        // Scratch vectors the static turret targeting and aiming code expects on its system.
        this._tmpAim = new THREE.Vector3();
        this._tmpPoint = new THREE.Vector3();
        this._tmpBombPoint = new THREE.Vector3();
        this._trailQueryStamp = 0;
        this._targets = [];
        this._dueRespawns = [];
        this._trailScratch = [];
        this.networkReplica = false;
        this._summonCounter = 0;
    }

    startRound() {
        this.clear();
        const owner = this.entityManager;
        if (!owner) return 0;
        const mapDefinition = owner.arena?.currentMapDefinition;
        // Same rule as static turrets: maps authored in map units get the map scale applied.
        const scale = mapDefinition?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(resolveGameplayConfig(owner).ARENA?.MAP_SCALE) || 1)
            : 1;
        const definitions = resolveMapUnitDefinitions(mapDefinition, { preserveSpatial: mapDefinition?.scaleAuthoredAnchors === true });
        for (const definition of definitions) {
            if (!isTurretCombatActive(owner.gameModeStrategy, [...definition.allowedModes])) continue;
            const unit = this._createUnit(definition, scale);
            this.units.push(unit);
            this.setBossRoomClock(unit, true);
        }
        if (owner.gameModeStrategy?.modeType === GAME_MODE_TYPES.ESCORT) {
            const definition = createEscortTankDefinition(owner.arena?.bounds);
            if (definition) this.units.push(bindEscortTank(this._createUnit(definition, 1)));
        }
        return this.units.length;
    }

    _createUnit(definition, scale) {
        const unit = {
            id: definition.id,
            kind: definition.kind,
            definition,
            scale,
            path: definition.path.map((point) => point.map((value) => value * scale)),
            speed: definition.speed * scale,
            maxHp: definition.maxHp,
            hp: definition.maxHp,
            hitboxRadius: definition.hitboxRadius * scale,
            destructible: true,
            ownerIndex: -1,
            alive: true,
            fromIndex: 0,
            toIndex: 1,
            progress: 0,
            yaw: 0,
            groundPosition: new THREE.Vector3(),
            position: new THREE.Vector3(),
            root: null,
            source: null,
            ownerPlayer: null,
            mounts: [],
            respawnRemaining: Infinity,
            deaths: 0,
            members: null,
            bombCooldownRemaining: definition.weapons?.bomb?.cooldown || 0,
            bombsFired: 0,
            crashing: false,
            crashSourcePlayer: null,
            summoned: false,
            calledByIndex: -1,
            attackSourcePlayer: null,
            summonRemaining: Infinity,
            attackCooldownRemaining: definition.attack?.cooldown || 0,
            attacksFired: 0,
            networkAttacksInitialized: false,
        };
        resetUnitOnPath(unit);
        unit.yaw = resolveUnitPathPose(unit, unit.path, unit.groundPosition) ?? 0;
        this._placeCentre(unit);
        if (definition.kind === 'swarm') {
            unit.members = createSwarmMembers(definition, scale, unit.position);
            unit.root = createSwarmVisual(this.entityManager?.renderer, this._resolveSwarmAssets(), unit.members);
        } else if (definition.kind === 'bomber') {
            unit.root = createBomberVisual(this.entityManager?.renderer, this._resolveBomberAssets(), scale);
        } else if (definition.kind === 'creature') {
            unit.root = createCreatureVisual(this.entityManager?.renderer, this._resolveCreatureAssets(), scale);
        } else {
            unit.root = createMapUnitVisual(
                this.entityManager?.renderer,
                this._resolveAssets(),
                scale * (definition.kind === 'boss' ? definition.modelScale : 1),
            );
        }
        this._updateVisual(unit);
        unit.source = createUnitSource(unit);
        // Its own shots must not hit it: the weapons skip targets owned by the shooter.
        unit.ownerPlayer = unit.source;
        unit.mounts = createUnitMounts(unit);
        unit.takeDamage = (amount, options = {}) => applyMapUnitDamage(this, unit, amount, options);
        if (unit.kind === 'swarm') {
            bindSwarmMemberCombat(this, unit);
            resetSwarmMembers(unit);
        }
        return unit;
    }

    _resolveAssets() {
        if (!this.entityManager?.renderer) return null;
        if (!this._assets) this._assets = createMapUnitAssets();
        return this._assets;
    }

    _resolveSwarmAssets() {
        if (!this.entityManager?.renderer) return null;
        if (!this._swarmAssets) this._swarmAssets = createSwarmAssets();
        return this._swarmAssets;
    }

    _resolveBomberAssets() {
        if (!this.entityManager?.renderer) return null;
        if (!this._bomberAssets) this._bomberAssets = createBomberAssets();
        return this._bomberAssets;
    }

    _resolveCreatureAssets() {
        if (!this.entityManager?.renderer) return null;
        if (!this._creatureAssets) this._creatureAssets = createCreatureAssets();
        return this._creatureAssets;
    }

    _placeCentre(unit) {
        unit.position.copy(unit.groundPosition);
        if (unit.kind === 'tank' || unit.kind === 'boss') {
            const modelScale = unit.kind === 'boss' ? unit.definition.modelScale : 1;
            unit.position.y += TANK_TURRET_HEIGHT * unit.scale * modelScale;
        }
        if (unit.kind === 'creature') unit.position.y += 1.35 * unit.scale;
        if (unit.kind === 'swarm') updateSwarmMembers(unit);
    }

    _updateVisual(unit) {
        if (unit.kind === 'swarm') updateSwarmVisual(unit);
        else if (unit.kind === 'bomber') updateBomberVisual(unit);
        else if (unit.kind === 'creature') updateCreatureVisual(unit);
        else updateMapUnitVisual(unit);
    }

    /** Back at the start of its path with full hit points and cold weapons. */
    _respawn(unit) {
        unit.alive = true;
        unit.hp = unit.maxHp;
        unit.respawnRemaining = Infinity;
        resetUnitOnPath(unit);
        if (unit.kind === 'swarm') resetSwarmMembers(unit);
        unit.bombCooldownRemaining = unit.definition.weapons?.bomb?.cooldown || 0;
        unit.bombsFired = 0;
        unit.crashing = false;
        unit.crashSourcePlayer = null;
        unit.attackCooldownRemaining = unit.definition.attack?.cooldown || 0;
        unit.attacksFired = 0;
        unit.networkAttacksInitialized = false;
        unit.yaw = resolveUnitPathPose(unit, unit.path, unit.groundPosition) ?? unit.yaw;
        this._placeCentre(unit);
        for (const mount of unit.mounts) {
            mount.cooldownRemaining = mount.cooldown * 0.5;
            mount.target = null;
            mount.aimDirection.set(Math.sin(unit.yaw), 0, Math.cos(unit.yaw));
        }
        if (unit.root) unit.root.visible = true;
        this.setBossRoomClock(unit, true);
        this._updateVisual(unit);
    }

    update(dt) {
        const safeDt = Math.max(0, Number(dt) || 0);
        if (!this.networkReplica) {
            for (const unit of tickMapUnitRespawns(this.units, safeDt, this._dueRespawns)) this._respawn(unit);
        }
        for (const unit of this.units) {
            if (unit.crashing) {
                if (!this.networkReplica) updateBomberCrash(this, unit, safeDt);
                continue;
            }
            if (!unit.alive) continue;
            if (unit.escortTank) {
                if (unit.escortReachedGoal) continue;
                if (!this.networkReplica) updateEscortTankSpeed(unit, this.entityManager?.players || []);
            }
            const unitDt = unit.summoned ? Math.min(safeDt, unit.summonRemaining) : safeDt;
            advanceUnitOnPath(unit, unit.path, unit.speed * unitDt, unit.definition.loop);
            if (unit.escortTank && unit.fromIndex === unit.path.length - 1) unit.escortReachedGoal = true;
            const heading = resolveUnitPathPose(unit, unit.path, unit.groundPosition);
            unit.yaw = turnYawTowards(unit.yaw, heading, HULL_TURN_RATE * safeDt);
            this._placeCentre(unit);
            this._updateVisual(unit);
            const authority = !this.networkReplica && this.entityManager?.isFightOutcomeAuthority !== false;
            updateUnitWeapons(this, unit, unitDt, authority);
            if (unit.kind === 'bomber') updateBomberBombs(this, unit, unitDt, authority);
            if (unit.kind === 'creature') updateCreatureAttack(this, unit, unitDt, authority);
            if (authority && unit.alive && unit.kind === 'tank') {
                crushTrailsUnderUnit(this.entityManager, unit, unitDt, this._trailScratch);
            }
            if (unit.summoned && !this.networkReplica) {
                unit.summonRemaining = Math.max(0, unit.summonRemaining - safeDt);
                if (unit.summonRemaining <= 0) {
                    unit.alive = false;
                    unit.respawnRemaining = Infinity;
                    if (unit.root) unit.root.visible = false;
                }
            }
        }
    }

    callBomberStrike(player) {
        if (this.networkReplica || !player || this.entityManager?.isFightOutcomeAuthority === false) return false;
        const bounds = this.entityManager?.arena?.bounds;
        const minX = Number(bounds?.minX ?? bounds?.min?.x);
        const maxX = Number(bounds?.maxX ?? bounds?.max?.x);
        const groundY = Number(bounds?.minY ?? bounds?.min?.y) || 0;
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) return false;
        const minZ = Number(bounds?.minZ ?? bounds?.min?.z);
        const maxZ = Number(bounds?.maxZ ?? bounds?.max?.z);
        const z = Math.max(Number.isFinite(minZ) ? minZ : -100, Math.min(Number.isFinite(maxZ) ? maxZ : 100, Number(player.position?.z) || 0));
        const ceilingY = Number(bounds?.maxY ?? bounds?.max?.y);
        const height = Number.isFinite(ceilingY) ? Math.min(groundY + 30, ceilingY - 1) : groundY + 30;
        const definition = normalizeMapUnit({
            id: `called_bomber_${++this._summonCounter}`,
            kind: 'bomber', path: [[minX, height, z], [maxX, height, z]], loop: false,
            speed: 30, respawnSeconds: 0,
        }, 0, undefined, { preserveSpatial: true });
        if (!definition) return false;
        const unit = this._createUnit(definition, 1);
        unit.summoned = true;
        unit.calledByIndex = Number.isInteger(player.index) ? player.index : -1;
        unit.attackSourcePlayer = player;
        unit.summonRemaining = (maxX - minX) / unit.speed;
        this.units.push(unit);
        return true;
    }

    /** What weapons may hit: the tanks that are still standing. The list is reused per call. */
    getTargets() {
        this._targets.length = 0;
        for (const unit of this.units) {
            if (!unit.alive) continue;
            if (unit.kind === 'swarm') {
                for (const member of unit.members) if (member.alive) this._targets.push(member);
            } else {
                this._targets.push(unit);
            }
        }
        return this._targets;
    }

    getEscortOutcome() {
        if (this.entityManager?.gameModeStrategy?.modeType !== GAME_MODE_TYPES.ESCORT) return null;
        const tank = this.units.find((unit) => unit.escortTank === true) || null;
        const elapsed = Math.max(0, Number(this.entityManager?._simulationClockMs) || 0) * 0.001;
        return resolveEscortMapUnitOutcome(tank, elapsed, this.entityManager?.players || []);
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    setBossRoomClock(unit, paused) {
        const roomId = unit?.kind === 'boss' ? unit.definition?.secretRoomId : '';
        if (!roomId) return;
        for (const entry of this.entityManager?._secretRoomSystem?.getRooms?.() || []) {
            if (entry?.room?.id === roomId) entry.clockPaused = paused === true;
        }
    }

    serializeNetworkState() {
        return serializeMapUnits(this.units);
    }

    applyNetworkState(entries) {
        applyMapUnitsNetworkState(this, entries, (unit) => {
            this._placeCentre(unit);
            this._updateVisual(unit);
        });
    }

    clear() {
        const renderer = this.entityManager?.renderer;
        for (const unit of this.units) {
            this.setBossRoomClock(unit, false);
            removeMapUnitVisual(renderer, unit);
        }
        this.units.length = 0;
    }

    dispose() {
        this.clear();
        disposeMapUnitAssets(this._assets);
        this._assets = null;
        disposeSwarmAssets(this._swarmAssets);
        this._swarmAssets = null;
        disposeBomberAssets(this._bomberAssets);
        this._bomberAssets = null;
        disposeCreatureAssets(this._creatureAssets);
        this._creatureAssets = null;
    }
}
