import * as THREE from 'three';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { resolveMapStaticTurretDefinitions } from '../../shared/contracts/MapSinglePlayerScenarioContract.js';

const TURRET_BASE_COLOR = 0x263746;
const TURRET_MG_COLOR = 0xffb347;
const TURRET_ROCKET_COLOR = 0xff4d6d;

export class StaticTurretSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.turrets = [];
        this._tmpAim = new THREE.Vector3();
        this._tmpPoint = new THREE.Vector3();
        this._tmpMuzzle = new THREE.Vector3();
        this._trailQueryStamp = 0;
        this._baseGeometry = new THREE.CylinderGeometry(1.8, 2.4, 2.2, 10);
        this._headGeometry = new THREE.SphereGeometry(1.35, 10, 8);
        this._barrelGeometry = new THREE.CylinderGeometry(0.22, 0.3, 3.8, 8);
        this._barrelGeometry.rotateX(Math.PI / 2);
        this._flashGeometry = new THREE.SphereGeometry(0.38, 8, 6);
        this._baseMaterial = new THREE.MeshStandardMaterial({ color: TURRET_BASE_COLOR, roughness: 0.6, metalness: 0.65 });
        this._mgMaterial = new THREE.MeshStandardMaterial({ color: TURRET_MG_COLOR, emissive: TURRET_MG_COLOR, emissiveIntensity: 0.25 });
        this._rocketMaterial = new THREE.MeshStandardMaterial({ color: TURRET_ROCKET_COLOR, emissive: TURRET_ROCKET_COLOR, emissiveIntensity: 0.3 });
        this._flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    }

    startRound() {
        this.clear();
        const owner = this.entityManager;
        if (!owner || String(owner.gameModeStrategy?.modeType || '').toUpperCase() !== 'HUNT') return 0;
        const mapDefinition = owner.arena?.currentMapDefinition;
        const definitions = resolveMapStaticTurretDefinitions(mapDefinition);
        const authoredScale = mapDefinition?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(resolveGameplayConfig(owner).ARENA?.MAP_SCALE) || 1)
            : 1;
        for (let i = 0; i < definitions.length; i += 1) {
            this.turrets.push(this._createTurret(definitions[i], authoredScale));
        }
        return this.turrets.length;
    }

    _createTurret(definition, authoredScale = 1) {
        const position = new THREE.Vector3(...definition.pos).multiplyScalar(authoredScale);
        const aimDirection = new THREE.Vector3(1, 0, 0);
        const root = this._createVisual(definition, position, authoredScale);
        const source = {
            index: -1,
            isBot: true,
            staticTurret: true,
            alive: true,
            combatLabel: `Geschuetz ${definition.id}`,
            position,
            getAimDirection: (out) => out.copy(aimDirection),
        };
        return {
            ...definition,
            range: definition.range * authoredScale,
            authoredScale,
            position,
            aimDirection,
            root,
            source,
            cooldownRemaining: definition.phase,
            flashRemaining: 0,
            shotsFired: 0,
        };
    }

    deployForPlayer(player) {
        const owner = this.entityManager;
        if (!owner || String(owner.gameModeStrategy?.modeType || '').toUpperCase() !== 'HUNT' || !player?.alive || !player.position) {
            return null;
        }
        const config = resolveGameplayConfig(owner).HUNT?.MG_TURRET || {};
        const definition = {
            id: `player_${player.index}_${this.turrets.length + 1}`,
            weapon: 'mg',
            pos: [player.position.x, player.position.y, player.position.z],
            range: Math.max(1, Number(config.RANGE) || 58),
            cooldown: Math.max(0.05, Number(config.COOLDOWN) || 0.24),
            damage: Math.max(1, Number(config.DAMAGE) || 3),
            phase: 0,
            rocketType: 'ROCKET_WEAK',
        };
        const turret = this._createTurret(definition);
        turret.ownerPlayer = player;
        turret.source = player;
        turret.expiresRemaining = Math.max(1, Number(config.DURATION_SECONDS) || 20);
        this.turrets.push(turret);
        return turret;
    }

    _createVisual(definition, position, authoredScale = 1) {
        const renderer = this.entityManager?.renderer;
        if (!renderer) return null;
        const root = new THREE.Group();
        root.position.copy(position);
        root.scale.setScalar(Math.max(0.001, Number(authoredScale) || 1));
        const base = new THREE.Mesh(this._baseGeometry, this._baseMaterial);
        base.position.y = -1.1;
        root.add(base);
        const weaponMaterial = definition.weapon === 'rocket' ? this._rocketMaterial : this._mgMaterial;
        const head = new THREE.Mesh(this._headGeometry, weaponMaterial);
        root.add(head);
        const barrel = new THREE.Mesh(this._barrelGeometry, weaponMaterial);
        barrel.position.z = -2.1;
        root.add(barrel);
        const flash = new THREE.Mesh(this._flashGeometry, this._flashMaterial);
        flash.position.z = -4.1;
        flash.visible = false;
        root.add(flash);
        root.userData.muzzleFlash = flash;
        renderer.addToScene(root);
        return root;
    }

    _findTarget(turret) {
        const candidates = turret.ownerPlayer
            ? (this.entityManager?.players || [])
            : (this.entityManager?.humanPlayers || []);
        let nearest = null;
        let nearestDistanceSq = turret.range * turret.range;
        for (let i = 0; i < candidates.length; i += 1) {
            const candidate = candidates[i];
            if (candidate === turret.ownerPlayer) continue;
            if (!candidate?.alive || !candidate.position) continue;
            const distanceSq = turret.position.distanceToSquared(candidate.position);
            if (distanceSq >= nearestDistanceSq) continue;
            nearest = candidate;
            nearestDistanceSq = distanceSq;
        }
        if (turret.ownerPlayer) {
            const trailTarget = this._findTrailTarget(turret, nearestDistanceSq);
            if (trailTarget) return trailTarget;
        }
        return nearest;
    }

    _findTrailTarget(turret, nearestDistanceSq) {
        const trailSpatialIndex = this.entityManager?._trailSpatialIndex;
        const grid = trailSpatialIndex?.spatialGrid;
        const gridSize = Math.max(1, Number(trailSpatialIndex?.gridSize) || 10);
        if (!(grid instanceof Map)) return null;

        const range = turret.range;
        const minCellX = Math.floor((turret.position.x - range) / gridSize);
        const maxCellX = Math.floor((turret.position.x + range) / gridSize);
        const minCellZ = Math.floor((turret.position.z - range) / gridSize);
        const maxCellZ = Math.floor((turret.position.z + range) / gridSize);
        const queryStamp = ++this._trailQueryStamp;
        const target = turret.trailTarget || (turret.trailTarget = {
            isTrail: true,
            entry: null,
            position: new THREE.Vector3(),
        });
        target.entry = null;

        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
            for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
                const cell = grid.get((cellX + 1000) * 2000 + (cellZ + 1000));
                if (!cell) continue;
                for (const entry of cell) {
                    if (!entry || entry.destroyed || entry.playerIndex === turret.ownerPlayer.index) continue;
                    if (entry._turretTrailQueryStamp === queryStamp) continue;
                    entry._turretTrailQueryStamp = queryStamp;
                    const x = (entry.fromX + entry.toX) * 0.5;
                    const y = (entry.fromY + entry.toY) * 0.5;
                    const z = (entry.fromZ + entry.toZ) * 0.5;
                    const dx = x - turret.position.x;
                    const dy = y - turret.position.y;
                    const dz = z - turret.position.z;
                    const distanceSq = dx * dx + dy * dy + dz * dz;
                    if (distanceSq >= nearestDistanceSq) continue;
                    nearestDistanceSq = distanceSq;
                    target.entry = entry;
                    target.position.set(x, y, z);
                }
            }
        }
        return target.entry ? target : null;
    }

    _hasLineOfSight(turret, target) {
        const arena = this.entityManager?.arena;
        if (!arena?.checkCollisionFast) return true;
        this._tmpAim.subVectors(target.position, turret.position);
        const distance = this._tmpAim.length();
        if (distance <= 4) return true;
        const steps = Math.min(18, Math.max(2, Math.ceil(distance / 5)));
        for (let i = 1; i < steps; i += 1) {
            const alpha = i / steps;
            this._tmpPoint.lerpVectors(turret.position, target.position, alpha);
            if (arena.checkCollisionFast(this._tmpPoint, 0.18)) return false;
        }
        return true;
    }

    _applyMgHit(turret, target) {
        const owner = this.entityManager;
        if (target?.isTrail) {
            const trailSpatialIndex = owner?._trailSpatialIndex;
            if (!trailSpatialIndex?.damageTrailSegment || !target.entry) return;
            const damageResult = trailSpatialIndex.damageTrailSegment(target.entry, turret.damage);
            owner.particles?.spawnTrailImpact?.(target.position, TURRET_MG_COLOR, {
                destroyed: damageResult?.destroyed === true,
            });
            return;
        }
        if (!owner || typeof target?.takeDamage !== 'function') return;
        const damageResult = target.takeDamage(turret.damage);
        owner._emitHuntDamageEvent?.({
            target,
            sourcePlayer: turret.source,
            cause: 'STATIC_TURRET_MG',
            damageResult,
            projectileType: null,
            impactPoint: target.position,
        });
        owner.particles?.spawnHit?.(target.position, TURRET_MG_COLOR);
        if (damageResult?.isDead) {
            owner._killPlayer?.(target, 'STATIC_TURRET_MG', { killer: turret.source });
        }
    }

    _fire(turret, target) {
        turret.aimDirection.subVectors(target.position, turret.position);
        if (turret.aimDirection.lengthSq() <= 0.000001) return;
        turret.aimDirection.normalize();
        if (turret.weapon === 'rocket') {
            this._tmpMuzzle.copy(turret.position).addScaledVector(turret.aimDirection, 4.2 * turret.authoredScale);
            this.entityManager?._projectileSystem?.spawnExternalProjectile?.({
                owner: turret.source,
                type: turret.rocketType,
                position: this._tmpMuzzle,
                direction: turret.aimDirection,
                target,
                speedMultiplier: 0.82,
            });
        } else {
            this._applyMgHit(turret, target);
        }
        turret.cooldownRemaining = turret.cooldown;
        turret.flashRemaining = 0.09;
        turret.shotsFired += 1;
        if (turret.root?.userData?.muzzleFlash) turret.root.userData.muzzleFlash.visible = true;
    }

    update(dt) {
        const safeDt = Math.max(0, Number(dt) || 0);
        for (let i = 0; i < this.turrets.length;) {
            const turret = this.turrets[i];
            if (Number.isFinite(turret.expiresRemaining)) {
                turret.expiresRemaining -= safeDt;
                if (turret.expiresRemaining <= 0 || !turret.ownerPlayer?.alive) {
                    this._removeTurretAt(i);
                    continue;
                }
            }
            turret.cooldownRemaining = Math.max(0, turret.cooldownRemaining - safeDt);
            turret.flashRemaining = Math.max(0, turret.flashRemaining - safeDt);
            if (turret.root?.userData?.muzzleFlash && turret.flashRemaining <= 0) {
                turret.root.userData.muzzleFlash.visible = false;
            }
            const target = this._findTarget(turret);
            if (!target) {
                i += 1;
                continue;
            }
            turret.root?.lookAt?.(target.position);
            if (turret.cooldownRemaining <= 0 && this._hasLineOfSight(turret, target)) {
                this._fire(turret, target);
            }
            i += 1;
        }
    }

    _removeTurretAt(index) {
        const turret = this.turrets[index];
        if (turret?.root) this.entityManager?.renderer?.removeFromScene?.(turret.root);
        this.turrets.splice(index, 1);
    }

    clear() {
        const renderer = this.entityManager?.renderer;
        for (let i = 0; i < this.turrets.length; i += 1) {
            const root = this.turrets[i]?.root;
            if (root) renderer?.removeFromScene?.(root);
        }
        this.turrets.length = 0;
    }

    dispose() {
        this.clear();
        this._baseGeometry.dispose();
        this._headGeometry.dispose();
        this._barrelGeometry.dispose();
        this._flashGeometry.dispose();
        this._baseMaterial.dispose();
        this._mgMaterial.dispose();
        this._rocketMaterial.dispose();
        this._flashMaterial.dispose();
    }
}

export default StaticTurretSystem;
