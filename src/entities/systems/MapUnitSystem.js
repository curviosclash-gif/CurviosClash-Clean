import * as THREE from 'three';
import { resolveMapUnitDefinitions } from '../../shared/contracts/MapUnitContract.js';
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
        // Scratch vectors the static turret targeting and aiming code expects on its system.
        this._tmpAim = new THREE.Vector3();
        this._tmpPoint = new THREE.Vector3();
        this._trailQueryStamp = 0;
        this._targets = [];
        this._dueRespawns = [];
        this._trailScratch = [];
        this.networkReplica = false;
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
            this.units.push(this._createUnit(definition, scale));
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
        };
        resetUnitOnPath(unit);
        unit.yaw = resolveUnitPathPose(unit, unit.path, unit.groundPosition) ?? 0;
        this._placeCentre(unit);
        if (definition.kind === 'swarm') {
            unit.members = createSwarmMembers(definition, scale, unit.position);
            unit.root = createSwarmVisual(this.entityManager?.renderer, this._resolveSwarmAssets(), unit.members);
        } else {
            unit.root = createMapUnitVisual(this.entityManager?.renderer, this._resolveAssets(), scale);
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

    _placeCentre(unit) {
        unit.position.copy(unit.groundPosition);
        if (unit.kind === 'tank') unit.position.y += TANK_TURRET_HEIGHT * unit.scale;
        if (unit.kind === 'swarm') updateSwarmMembers(unit);
    }

    _updateVisual(unit) {
        if (unit.kind === 'swarm') updateSwarmVisual(unit);
        else updateMapUnitVisual(unit);
    }

    /** Back at the start of its path with full hit points and cold weapons. */
    _respawn(unit) {
        unit.alive = true;
        unit.hp = unit.maxHp;
        unit.respawnRemaining = Infinity;
        resetUnitOnPath(unit);
        if (unit.kind === 'swarm') resetSwarmMembers(unit);
        unit.yaw = resolveUnitPathPose(unit, unit.path, unit.groundPosition) ?? unit.yaw;
        this._placeCentre(unit);
        for (const mount of unit.mounts) {
            mount.cooldownRemaining = mount.cooldown * 0.5;
            mount.target = null;
            mount.aimDirection.set(Math.sin(unit.yaw), 0, Math.cos(unit.yaw));
        }
        if (unit.root) unit.root.visible = true;
        this._updateVisual(unit);
    }

    update(dt) {
        const safeDt = Math.max(0, Number(dt) || 0);
        if (!this.networkReplica) {
            for (const unit of tickMapUnitRespawns(this.units, safeDt, this._dueRespawns)) this._respawn(unit);
        }
        for (const unit of this.units) {
            if (!unit.alive) continue;
            advanceUnitOnPath(unit, unit.path, unit.speed * safeDt, unit.definition.loop);
            const heading = resolveUnitPathPose(unit, unit.path, unit.groundPosition);
            unit.yaw = turnYawTowards(unit.yaw, heading, HULL_TURN_RATE * safeDt);
            this._placeCentre(unit);
            this._updateVisual(unit);
            const authority = !this.networkReplica && this.entityManager?.isFightOutcomeAuthority !== false;
            updateUnitWeapons(this, unit, safeDt, authority);
            if (authority && unit.alive && unit.kind === 'tank') {
                crushTrailsUnderUnit(this.entityManager, unit, safeDt, this._trailScratch);
            }
        }
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

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
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
        for (const unit of this.units) removeMapUnitVisual(renderer, unit);
        this.units.length = 0;
    }

    dispose() {
        this.clear();
        disposeMapUnitAssets(this._assets);
        this._assets = null;
        disposeSwarmAssets(this._swarmAssets);
        this._swarmAssets = null;
    }
}
