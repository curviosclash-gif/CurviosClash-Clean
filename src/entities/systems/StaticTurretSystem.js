import * as THREE from 'three';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { resolveMapStaticTurretDefinitions } from '../../shared/contracts/MapSinglePlayerScenarioContract.js';
import { MGTracerFx } from '../../hunt/mg/MGTracerFx.js';
import {
    applyStaticTurretNetworkSnapshot,
    createStaticTurretNetworkSnapshot,
} from './static-turret/StaticTurretNetworkOps.js';
import {
    hasStaticTurretLineOfSight,
    resolveStaticTurretTarget,
} from './static-turret/StaticTurretTargetingOps.js';
import {
    createStaticTurretVisual,
    playReplicatedStaticTurretShot,
    updateStaticTurretVisual,
} from './static-turret/StaticTurretVisualOps.js';

const TURRET_BASE_COLOR = 0x263746;
const TURRET_MG_COLOR = 0xffb347;
const TURRET_ROCKET_COLOR = 0xff4d6d;
const TURRET_DESTROYED_COLOR = 0xff6b35;

function clampFinite(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function resolveOwnerIndex(turret) {
    return Number.isInteger(turret?.ownerIndex)
        ? turret.ownerIndex
        : (Number.isInteger(turret?.ownerPlayer?.index) ? turret.ownerPlayer.index : -1);
}

export class StaticTurretSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.turrets = [];
        this._tmpAim = new THREE.Vector3();
        this._tmpPoint = new THREE.Vector3();
        this._tmpMuzzle = new THREE.Vector3();
        this._trailQueryStamp = 0;
        this._nextTurretId = 1;
        this._nextCreatedSequence = 1;
        this.networkReplica = false;
        this._baseGeometry = new THREE.CylinderGeometry(1.8, 2.4, 2.2, 10);
        this._headGeometry = new THREE.SphereGeometry(1.35, 10, 8);
        this._barrelGeometry = new THREE.CylinderGeometry(0.22, 0.3, 3.8, 8);
        this._barrelGeometry.rotateX(Math.PI / 2);
        this._flashGeometry = new THREE.SphereGeometry(0.38, 8, 6);
        this._accentGeometry = new THREE.TorusGeometry(2.05, 0.12, 6, 20);
        this._healthBarGeometry = new THREE.BoxGeometry(3.2, 0.32, 0.12);
        this._healthBarFillGeometry = new THREE.BoxGeometry(3, 0.2, 0.14);
        this._baseMaterial = new THREE.MeshStandardMaterial({ color: TURRET_BASE_COLOR, roughness: 0.6, metalness: 0.65 });
        this._mgMaterial = new THREE.MeshStandardMaterial({ color: TURRET_MG_COLOR, emissive: TURRET_MG_COLOR, emissiveIntensity: 0.25 });
        this._rocketMaterial = new THREE.MeshStandardMaterial({ color: TURRET_ROCKET_COLOR, emissive: TURRET_ROCKET_COLOR, emissiveIntensity: 0.3 });
        this._flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
        this._healthBackMaterial = new THREE.MeshBasicMaterial({ color: 0x101820, transparent: true, opacity: 0.78 });
        this._tracerFx = new MGTracerFx(entityManager);
    }

    startRound() {
        this.clear();
        this._nextTurretId = 1;
        this._nextCreatedSequence = 1;
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
        const root = createStaticTurretVisual(this, definition, position, authoredScale);
        const deployed = definition.deployed === true;
        const maxHp = deployed
            ? clampFinite(definition.maxHp, 45, 1, 500)
            : Number.POSITIVE_INFINITY;
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
            deployed,
            ownerIndex: Number.isInteger(definition.ownerIndex) ? definition.ownerIndex : -1,
            maxHp,
            hp: deployed ? clampFinite(definition.hp, maxHp, 0, maxHp) : maxHp,
            hitboxRadius: clampFinite(definition.hitboxRadius, 2.2, 0.5, 8),
            cooldownRemaining: definition.phase,
            flashRemaining: 0,
            shotsFired: 0,
            target: null,
            targetHoldRemaining: 0,
            targetReacquireRemaining: 0,
            targetHoldSeconds: clampFinite(definition.targetHoldSeconds, 0.3, 0, 2),
            targetReacquireSeconds: clampFinite(definition.targetReacquireSeconds, 0.12, 0.03, 1),
            losSampleStep: clampFinite(definition.losSampleStep, 0.5, 0.2, 2),
            acquireDelaySeconds: clampFinite(definition.acquireDelaySeconds, 0.22, 0, 2),
            acquireRemaining: 0,
            turnRateRadians: clampFinite(definition.turnRateRadians, 8, 0.5, 30),
            fireDotMin: clampFinite(definition.fireDotMin, 0.985, 0.8, 1),
            audioRange: clampFinite(definition.audioRange, 80, 10, 200),
            visualTime: 0,
            networkShotsInitialized: false,
            createdSequence: this._nextCreatedSequence++,
        };
    }

    _resolveTurretConfig() {
        const config = resolveGameplayConfig(this.entityManager).HUNT?.MG_TURRET || {};
        return {
            range: clampFinite(config.RANGE, 58, 8, 120),
            cooldown: clampFinite(config.COOLDOWN, 0.24, 0.1, 2),
            damage: clampFinite(config.DAMAGE, 3, 1, 20),
            duration: clampFinite(config.DURATION_SECONDS, 20, 3, 60),
            maxHp: clampFinite(config.MAX_HP, 45, 10, 200),
            hitboxRadius: clampFinite(config.HIT_RADIUS, 2.2, 1, 5),
            maxPerOwner: Math.round(clampFinite(config.MAX_PER_OWNER, 1, 1, 4)),
            deployOffset: clampFinite(config.DEPLOY_OFFSET, 3.2, 0, 8),
            targetHoldSeconds: clampFinite(config.TARGET_HOLD_SECONDS, 0.3, 0, 2),
            targetReacquireSeconds: clampFinite(config.TARGET_REACQUIRE_SECONDS, 0.12, 0.03, 1),
            losSampleStep: clampFinite(config.LOS_SAMPLE_STEP, 0.5, 0.2, 2),
            acquireDelaySeconds: clampFinite(config.ACQUIRE_DELAY_SECONDS, 0.22, 0, 2),
            turnRateRadians: clampFinite(config.TURN_RATE_RADIANS_PER_SECOND, 8, 0.5, 30),
            fireDotMin: clampFinite(config.FIRE_DOT_MIN, 0.985, 0.8, 1),
            audioRange: clampFinite(config.AUDIO_RANGE, 80, 10, 200),
        };
    }

    _resolveDeploymentPosition(player, config) {
        const arena = this.entityManager?.arena;
        this._tmpMuzzle.copy(player.position);
        if (config.deployOffset > 0) {
            const getter = typeof player.getAimDirection === 'function'
                ? player.getAimDirection
                : player.getDirection;
            if (typeof getter === 'function') {
                getter.call(player, this._tmpAim);
                if (this._tmpAim.lengthSq() > 0.000001) {
                    this._tmpMuzzle.addScaledVector(this._tmpAim.normalize(), -config.deployOffset);
                }
            }
        }
        if (!arena?.checkCollisionFast) {
            return this._tmpMuzzle;
        }
        const deploymentDistance = this._tmpMuzzle.distanceTo(player.position);
        const steps = Math.max(1, Math.ceil(deploymentDistance / config.losSampleStep));
        let pathBlocked = false;
        for (let step = 1; step <= steps; step += 1) {
            this._tmpPoint.lerpVectors(player.position, this._tmpMuzzle, step / steps);
            if (arena.checkCollisionFast(this._tmpPoint, config.hitboxRadius)) {
                pathBlocked = true;
                break;
            }
        }
        if (!pathBlocked) return this._tmpMuzzle;
        this._tmpMuzzle.copy(player.position);
        return arena.checkCollisionFast(this._tmpMuzzle, config.hitboxRadius) ? null : this._tmpMuzzle;
    }

    _enforceOwnerLimit(player, maxPerOwner) {
        let count = 0;
        let oldestIndex = -1;
        let oldestSequence = Infinity;
        for (let i = 0; i < this.turrets.length; i += 1) {
            const turret = this.turrets[i];
            if (!turret?.deployed || resolveOwnerIndex(turret) !== player.index) continue;
            count += 1;
            if (turret.createdSequence < oldestSequence) {
                oldestSequence = turret.createdSequence;
                oldestIndex = i;
            }
        }
        if (count >= maxPerOwner && oldestIndex >= 0) {
            this._removeTurretAt(oldestIndex, 'replaced');
        }
    }

    deployForPlayer(player) {
        const owner = this.entityManager;
        if (
            !owner
            || this.networkReplica
            || String(owner.gameModeStrategy?.modeType || '').toUpperCase() !== 'HUNT'
            || !player?.alive
            || !player.position
        ) {
            return null;
        }
        const config = this._resolveTurretConfig();
        const position = this._resolveDeploymentPosition(player, config);
        if (!position) {
            owner.recorder?.logEvent?.('TURRET_DEPLOY_FAILED', player.index, 'blocked');
            return null;
        }
        this._enforceOwnerLimit(player, config.maxPerOwner);
        const definition = {
            id: `player_${player.index}_${this._nextTurretId++}`,
            weapon: 'mg',
            pos: [position.x, position.y, position.z],
            range: config.range,
            cooldown: config.cooldown,
            damage: config.damage,
            phase: 0,
            rocketType: 'ROCKET_WEAK',
            deployed: true,
            ownerIndex: player.index,
            ownerColor: player.color,
            maxHp: config.maxHp,
            hitboxRadius: config.hitboxRadius,
            targetHoldSeconds: config.targetHoldSeconds,
            targetReacquireSeconds: config.targetReacquireSeconds,
            losSampleStep: config.losSampleStep,
            acquireDelaySeconds: config.acquireDelaySeconds,
            turnRateRadians: config.turnRateRadians,
            fireDotMin: config.fireDotMin,
            audioRange: config.audioRange,
        };
        const turret = this._createTurret(definition);
        turret.ownerPlayer = player;
        turret.source = player;
        turret.expiresRemaining = config.duration;
        turret.takeDamage = (amount, options = {}) => this.damageTurret(turret, amount, options);
        this.turrets.push(turret);
        owner.particles?.spawnHit?.(turret.position, player.color || TURRET_MG_COLOR);
        if (!player.isBot) owner.audio?.play?.('POWERUP');
        owner.recorder?.logEvent?.('TURRET_DEPLOY', player.index, turret.id);
        return turret;
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
            if (damageResult?.hit) {
                owner.recorder?.logEvent?.('TURRET_TRAIL_HIT', resolveOwnerIndex(turret), turret.id);
                if (!turret.ownerPlayer?.isBot) owner.audio?.play?.('MG_HIT', { intensity: 0.5 });
            }
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
        const appliedDamage = Math.max(
            0,
            Number(damageResult?.hpApplied) || 0,
            Number(damageResult?.absorbedByShield) || 0
        );
        if (appliedDamage > 0) {
            owner.recorder?.logEvent?.('TURRET_PLAYER_HIT', resolveOwnerIndex(turret), turret.id);
        }
        if (damageResult?.isDead) {
            owner.recorder?.logEvent?.('TURRET_KILL', resolveOwnerIndex(turret), turret.id);
            owner._killPlayer?.(target, 'STATIC_TURRET_MG', {
                killer: turret.source,
                impactPoint: target.position,
                projectileType: 'STATIC_TURRET_MG',
            });
        }
    }

    damageTurret(turret, amount, options = {}) {
        if (!turret?.deployed || turret.hp <= 0 || this.networkReplica) {
            return { applied: 0, hpApplied: 0, remainingHp: Math.max(0, Number(turret?.hp) || 0), isDead: turret?.hp <= 0 };
        }
        const requested = Math.max(0, Number(amount) || 0);
        const hpBefore = turret.hp;
        turret.hp = Math.max(0, hpBefore - requested);
        const hpApplied = hpBefore - turret.hp;
        if (hpApplied > 0) {
            this.entityManager?.particles?.spawnHit?.(turret.position, TURRET_DESTROYED_COLOR);
            this.entityManager?.recorder?.logEvent?.(
                'TURRET_DAMAGED',
                resolveOwnerIndex(turret),
                `${turret.id}:source=${Number.isInteger(options.sourcePlayer?.index) ? options.sourcePlayer.index : -1}:cause=${String(options.cause || 'UNKNOWN')}:damage=${Math.round(hpApplied)}:hp=${Math.round(turret.hp)}`
            );
        }
        const isDead = turret.hp <= 0;
        if (isDead) {
            const index = this.turrets.indexOf(turret);
            if (index >= 0) {
                this._removeTurretAt(index, 'destroyed', options.sourcePlayer || null);
            }
        }
        return { applied: requested, hpApplied, absorbedByShield: 0, remainingHp: turret.hp, isDead };
    }

    _fire(turret, target) {
        if (turret.aimDirection.lengthSq() <= 0.000001) return;
        this._tmpMuzzle.copy(turret.position).addScaledVector(turret.aimDirection, 4.2 * turret.authoredScale);
        if (turret.weapon === 'rocket') {
            this.entityManager?._projectileSystem?.spawnExternalProjectile?.({
                owner: turret.source,
                type: turret.rocketType,
                position: this._tmpMuzzle,
                direction: turret.aimDirection,
                target,
                speedMultiplier: 0.82,
            });
            if (this._shouldPlayTurretAudio(turret)) {
                this.entityManager?.audio?.play?.('ROCKET_SHOOT', { intensity: 0.35 });
            }
        } else {
            this._applyMgHit(turret, target);
            this._tracerFx.spawnTracer(this._tmpMuzzle, target.position, true, {
                TRACER_COLOR: Number(turret.ownerPlayer?.color) || TURRET_MG_COLOR,
                TRACER_BEAM_RADIUS: 0.11,
                TRACER_BULLET_RADIUS: 0.28,
            });
            if (this._shouldPlayTurretAudio(turret)) {
                this.entityManager?.audio?.play?.('MG_SHOOT', { intensity: 0.35 });
            }
        }
        turret.cooldownRemaining = turret.cooldown;
        turret.flashRemaining = 0.09;
        turret.shotsFired += 1;
        if (turret.root?.userData?.muzzleFlash) turret.root.userData.muzzleFlash.visible = true;
        this.entityManager?.recorder?.logEvent?.('TURRET_SHOT', resolveOwnerIndex(turret), `${turret.id}:${turret.weapon}`);
    }

    _shouldPlayTurretAudio(turret) {
        const owner = this.entityManager;
        const session = owner?.runtimeConfig?.session || {};
        const first = Math.max(0, Math.trunc(Number(owner?.renderer?.viewportSystem?.localPlayerIndex ?? session.localPlayerIndex) || 0));
        const count = Math.max(1, Math.trunc(Number(session.localHumanCount) || 1));
        const rangeSq = turret.audioRange * turret.audioRange;
        for (let index = first; index < first + count; index += 1) {
            const player = owner?.players?.find?.((candidate) => candidate?.index === index);
            if (player?.position && player.position.distanceToSquared(turret.position) <= rangeSq) return true;
        }
        return false;
    }

    _playReplicatedShot(turret) {
        playReplicatedStaticTurretShot(this, turret);
    }

    update(dt) {
        const safeDt = Math.max(0, Number(dt) || 0);
        this._tracerFx.update(safeDt);
        for (let i = 0; i < this.turrets.length;) {
            const turret = this.turrets[i];
            if (Number.isFinite(turret.expiresRemaining)) {
                turret.expiresRemaining -= safeDt;
                if (!this.networkReplica && (turret.expiresRemaining <= 0 || !turret.ownerPlayer?.alive)) {
                    this._removeTurretAt(i, turret.expiresRemaining <= 0 ? 'expired' : 'owner-dead');
                    continue;
                }
            }
            turret.cooldownRemaining = Math.max(0, turret.cooldownRemaining - safeDt);
            turret.flashRemaining = Math.max(0, turret.flashRemaining - safeDt);
            if (turret.root?.userData?.muzzleFlash && turret.flashRemaining <= 0) {
                turret.root.userData.muzzleFlash.visible = false;
            }
            const target = this.networkReplica ? null : resolveStaticTurretTarget(this, turret, safeDt);
            const aimDot = updateStaticTurretVisual(this, turret, target, safeDt);
            if (this.networkReplica) {
                i += 1;
                continue;
            }
            if (!target) {
                i += 1;
                continue;
            }
            if (
                turret.acquireRemaining <= 0
                && aimDot >= turret.fireDotMin
                && turret.cooldownRemaining <= 0
                && hasStaticTurretLineOfSight(this, turret, target)
            ) {
                this._fire(turret, target);
            }
            i += 1;
        }
    }

    _disposeTurretVisual(turret) {
        const materials = turret?.root?.userData?.disposableMaterials;
        if (Array.isArray(materials)) {
            for (const material of materials) material?.dispose?.();
        }
    }

    _removeTurretAt(index, reason = 'removed', sourcePlayer = null) {
        const turret = this.turrets[index];
        if (turret?.root) this.entityManager?.renderer?.removeFromScene?.(turret.root);
        this._disposeTurretVisual(turret);
        this.turrets.splice(index, 1);
        if (!turret?.deployed || this.networkReplica) return;
        const ownerIndex = resolveOwnerIndex(turret);
        this.entityManager?.recorder?.logEvent?.(
            reason === 'destroyed' ? 'TURRET_DESTROYED' : 'TURRET_REMOVED',
            ownerIndex,
            `${turret.id}:${reason}`
        );
        if (reason === 'destroyed') {
            this.entityManager?.particles?.spawnExplosion?.(turret.position, TURRET_DESTROYED_COLOR, { cause: 'TURRET' });
            if (!sourcePlayer?.isBot) this.entityManager?.audio?.play?.('HIT', { intensity: 0.8 });
        }
    }

    clear() {
        const renderer = this.entityManager?.renderer;
        for (let i = 0; i < this.turrets.length; i += 1) {
            const turret = this.turrets[i];
            const root = turret?.root;
            if (root) renderer?.removeFromScene?.(root);
            this._disposeTurretVisual(turret);
        }
        this.turrets.length = 0;
        this._tracerFx.clear();
    }

    getDestructibleTargets() {
        return this.turrets;
    }

    getHudStateForPlayer(playerIndex) {
        let active = null;
        let count = 0;
        for (const turret of this.turrets) {
            if (!turret?.deployed || resolveOwnerIndex(turret) !== playerIndex) continue;
            count += 1;
            if (!active || turret.createdSequence > active.createdSequence) active = turret;
        }
        if (!active) return null;
        return {
            count,
            remainingSeconds: Math.max(0, Number(active.expiresRemaining) || 0),
            hp: Math.max(0, Number(active.hp) || 0),
            maxHp: Math.max(1, Number(active.maxHp) || 1),
            range: Math.max(0, Number(active.range) || 0),
        };
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    createNetworkSnapshot() {
        return createStaticTurretNetworkSnapshot(this.turrets);
    }

    applyNetworkSnapshot(entries, players = []) {
        applyStaticTurretNetworkSnapshot(this, entries, players);
    }

    dispose() {
        this.clear();
        this._baseGeometry.dispose();
        this._headGeometry.dispose();
        this._barrelGeometry.dispose();
        this._flashGeometry.dispose();
        this._accentGeometry.dispose();
        this._healthBarGeometry.dispose();
        this._healthBarFillGeometry.dispose();
        this._baseMaterial.dispose();
        this._mgMaterial.dispose();
        this._rocketMaterial.dispose();
        this._flashMaterial.dispose();
        this._healthBackMaterial.dispose();
    }
}

export default StaticTurretSystem;
