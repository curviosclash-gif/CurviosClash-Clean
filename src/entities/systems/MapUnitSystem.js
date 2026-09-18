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

// How fast the hull swings round at a path corner, in radians per second.
const HULL_TURN_RATE = 2.5;

/**
 * Map units (E46): tanks that drive an authored path. This system owns their lifecycle - built at
 * round start from the map definition, moved every tick, removed at round end. The unit's
 * `position` is the centre of its turret, which is what weapons aim at; `groundPosition` is the
 * path point under its tracks.
 */
export class MapUnitSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.units = [];
        this._assets = null;
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
        for (const definition of resolveMapUnitDefinitions(mapDefinition)) {
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
        };
        resetUnitOnPath(unit);
        unit.yaw = resolveUnitPathPose(unit, unit.path, unit.groundPosition) ?? 0;
        this._placeCentre(unit);
        unit.root = createMapUnitVisual(this.entityManager?.renderer, this._resolveAssets(), scale);
        updateMapUnitVisual(unit);
        unit.source = createUnitSource(unit);
        // Its own shots must not hit it: the weapons skip targets owned by the shooter.
        unit.ownerPlayer = unit.source;
        unit.mounts = createUnitMounts(unit);
        unit.takeDamage = (amount, options = {}) => applyMapUnitDamage(this, unit, amount, options);
        return unit;
    }

    _resolveAssets() {
        if (!this.entityManager?.renderer) return null;
        if (!this._assets) this._assets = createMapUnitAssets();
        return this._assets;
    }

    _placeCentre(unit) {
        unit.position.copy(unit.groundPosition);
        unit.position.y += TANK_TURRET_HEIGHT * unit.scale;
    }

    /** Back at the start of its path with full hit points and cold weapons. */
    _respawn(unit) {
        unit.alive = true;
        unit.hp = unit.maxHp;
        unit.respawnRemaining = Infinity;
        resetUnitOnPath(unit);
        unit.yaw = resolveUnitPathPose(unit, unit.path, unit.groundPosition) ?? unit.yaw;
        this._placeCentre(unit);
        for (const mount of unit.mounts) {
            mount.cooldownRemaining = mount.cooldown * 0.5;
            mount.target = null;
            mount.aimDirection.set(Math.sin(unit.yaw), 0, Math.cos(unit.yaw));
        }
        if (unit.root) unit.root.visible = true;
        updateMapUnitVisual(unit);
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
            updateMapUnitVisual(unit);
            const authority = !this.networkReplica && this.entityManager?.isFightOutcomeAuthority !== false;
            updateUnitWeapons(this, unit, safeDt, authority);
            if (authority && unit.alive) crushTrailsUnderUnit(this.entityManager, unit, safeDt, this._trailScratch);
        }
    }

    /** What weapons may hit: the tanks that are still standing. The list is reused per call. */
    getTargets() {
        this._targets.length = 0;
        for (const unit of this.units) if (unit.alive) this._targets.push(unit);
        return this._targets;
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
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
    }
}
