import * as THREE from 'three';
import {
    createFlagObjectiveState,
    damageFlagObjective,
    FLAG_OBJECTIVE_DEFAULTS,
    FLAG_OBJECTIVE_REASONS,
    resolveFlagObjectiveOutcome,
    TEAM_OBJECTIVE_TYPES,
    tickFlagObjectiveProtection,
} from '../../shared/contracts/FlagObjectiveContract.js';
import { resolveAuthoredFlagObjectives } from '../../shared/contracts/FlagObjectivePlacementContract.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { normalizeTeamId, resolveTeamColor, resolveTeamLabel, TEAM_IDS } from '../../shared/contracts/TeamCombatContract.js';

const PLACEMENT_PROBES = Object.freeze([
    [0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [8, 8], [8, -8], [-8, 8], [-8, -8],
]);

function readBound(bounds, direct, nested, fallback) {
    const value = Number(bounds?.[direct] ?? bounds?.[nested?.[0]]?.[nested?.[1]]);
    return Number.isFinite(value) ? value : fallback;
}

export class FlagObjectiveSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.flags = [];
        this.networkReplica = false;
        this.active = false;
        this.stateRevision = 0;
        this.captureEventId = 0;
        this.captureEvent = null;
        this.lastAppliedRevision = -1;
        this.lastAppliedCaptureEventId = 0;
        this.overtime = false;
    }

    startRound() {
        this.clear();
        const hunt = this.entityManager?.runtimeConfig?.hunt;
        this.active = hunt?.teamMode === true && hunt?.teamObjective === TEAM_OBJECTIVE_TYPES.FLAGS;
        if (!this.active) return 0;
        const arena = this.entityManager?.arena;
        const bounds = arena?.bounds;
        const minX = readBound(bounds, 'minX', ['min', 'x'], -100);
        const maxX = readBound(bounds, 'maxX', ['max', 'x'], 100);
        const minY = readBound(bounds, 'minY', ['min', 'y'], 0);
        const maxY = readBound(bounds, 'maxY', ['max', 'y'], 80);
        const minZ = readBound(bounds, 'minZ', ['min', 'z'], -100);
        const maxZ = readBound(bounds, 'maxZ', ['max', 'z'], 100);
        const y = minY + (maxY - minY) * 0.35;
        const fallbackPlacements = [];
        for (const teamId of [TEAM_IDS.ALPHA, TEAM_IDS.BRAVO]) {
            const x = teamId === TEAM_IDS.ALPHA ? minX + (maxX - minX) * 0.2 : minX + (maxX - minX) * 0.8;
            for (let index = 0; index < FLAG_OBJECTIVE_DEFAULTS.flagsPerTeam; index += 1) {
                const z = minZ + (maxZ - minZ) * ((index + 1) / (FLAG_OBJECTIVE_DEFAULTS.flagsPerTeam + 1));
                fallbackPlacements.push({ id: `${teamId.toLowerCase()}_${index + 1}`, teamId, position: [x, y, z] });
            }
        }
        const map = arena?.currentMapDefinition;
        const authoredScale = map?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(resolveGameplayConfig(this.entityManager).ARENA?.MAP_SCALE) || 1)
            : 1;
        const authored = resolveAuthoredFlagObjectives(map, { spatialScale: authoredScale });
        const placements = authored.length === fallbackPlacements.length ? authored : fallbackPlacements;
        for (let index = 0; index < placements.length; index += 1) {
            const placement = placements[index];
            const fallback = fallbackPlacements[index];
            const desired = new THREE.Vector3(...placement.position);
            const safePosition = this._resolveOpenPosition(desired, new THREE.Vector3(...fallback.position));
            this.flags.push(this._createFlag(placement.id, placement.teamId, safePosition));
        }
        return this.flags.length;
    }

    _resolveOpenPosition(desired, fallback) {
        const arena = this.entityManager?.arena;
        if (typeof arena?.checkCollision !== 'function') return desired;
        for (const [offsetX, offsetZ] of PLACEMENT_PROBES) {
            const candidate = desired.clone();
            candidate.x += offsetX;
            candidate.z += offsetZ;
            if (!arena.checkCollision(candidate, 4)) return candidate;
        }
        for (const [offsetX, offsetZ] of PLACEMENT_PROBES) {
            const candidate = fallback.clone();
            candidate.x += offsetX;
            candidate.z += offsetZ;
            if (!arena.checkCollision(candidate, 4)) return candidate;
        }
        return fallback;
    }

    _createFlag(id, teamId, position) {
        const flag = {
            ...createFlagObjectiveState({ id, teamId }),
            position,
            hitboxRadius: 3.2,
            destructible: true,
            teamObjective: true,
            alive: true,
            guards: [],
            root: this._createVisual(position, teamId),
        };
        this._syncVisual(flag);
        flag.takeDamage = (amount, options = {}) => this.damageFlag(flag, amount, options);
        for (let index = 0; index < FLAG_OBJECTIVE_DEFAULTS.guardsPerFlag; index += 1) {
            const guard = this._createGuard(flag, index);
            if (guard) flag.guards.push(guard);
        }
        return flag;
    }

    _createGuard(flag, index) {
        const offset = index === 0 ? -5 : 5;
        return this.entityManager?._staticTurretSystem?.addObjectiveGuard?.({
            id: `flag_guard_${flag.id}_${index + 1}`,
            teamId: flag.teamId,
            position: [flag.position.x, flag.position.y - 1.5, flag.position.z + offset],
        }) || null;
    }

    _restoreCapturedGuards(flag) {
        const turretSystem = this.entityManager?._staticTurretSystem;
        if (!turretSystem) return;
        for (let index = 0; index < FLAG_OBJECTIVE_DEFAULTS.guardsPerFlag; index += 1) {
            const guard = flag.guards[index];
            if (guard && guard.hp > 0 && turretSystem.turrets?.includes?.(guard)) continue;
            flag.guards[index] = this._createGuard(flag, index);
        }
        flag.guards = flag.guards.filter(Boolean);
    }

    _createVisual(position, teamId) {
        const renderer = this.entityManager?.renderer;
        if (!renderer) return null;
        const root = new THREE.Group();
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.22, 7, 8),
            new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.7, roughness: 0.35 }),
        );
        const banner = new THREE.Mesh(
            new THREE.BoxGeometry(4.2, 2.2, 0.18),
            new THREE.MeshStandardMaterial({ color: resolveTeamColor(teamId), emissive: resolveTeamColor(teamId), emissiveIntensity: 0.25 }),
        );
        banner.position.set(2, 2, 0);
        const healthBack = new THREE.Mesh(
            new THREE.BoxGeometry(4.4, 0.35, 0.16),
            new THREE.MeshBasicMaterial({ color: 0x111827, depthTest: false }),
        );
        const healthFill = new THREE.Mesh(
            new THREE.BoxGeometry(4.2, 0.22, 0.2),
            new THREE.MeshBasicMaterial({ color: resolveTeamColor(teamId), depthTest: false }),
        );
        healthBack.position.set(2, 3.65, 0);
        healthFill.position.set(2, 3.65, 0.12);
        const protectionRing = new THREE.Mesh(
            new THREE.TorusGeometry(3.2, 0.12, 8, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82 }),
        );
        protectionRing.rotation.x = Math.PI * 0.5;
        protectionRing.position.y = -2.8;
        root.add(pole, banner, healthBack, healthFill, protectionRing);
        root.position.copy(position);
        root.userData.banner = banner;
        root.userData.healthFill = healthFill;
        root.userData.protectionRing = protectionRing;
        renderer.addToScene?.(root);
        return root;
    }

    _syncVisual(flag) {
        const fill = flag?.root?.userData?.healthFill;
        if (fill) {
            const ratio = Math.max(0.001, Math.min(1, flag.hp / Math.max(1, flag.maxHp)));
            fill.scale.x = ratio;
            fill.position.x = 2 - (4.2 * (1 - ratio) * 0.5);
            fill.material?.color?.setHex?.(resolveTeamColor(flag.teamId));
        }
        const ring = flag?.root?.userData?.protectionRing;
        if (ring) ring.visible = flag.protectionRemaining > 0;
    }

    damageFlag(flag, amount, options = {}) {
        if (!this.active || this.networkReplica) return { applied: 0, hpApplied: 0, remainingHp: flag?.hp || 0, captured: false };
        const sourcePlayer = options.sourcePlayer || null;
        const result = damageFlagObjective(flag, amount, sourcePlayer?.teamId);
        if (result.captured) {
            this._applyTeam(flag, flag.teamId);
            this.stateRevision += 1;
            this.captureEventId += 1;
            this.captureEvent = {
                id: this.captureEventId,
                flagId: flag.id,
                teamId: flag.teamId,
                playerIndex: Number.isInteger(sourcePlayer?.index) ? sourcePlayer.index : -1,
            };
            this.entityManager?._huntScoring?.registerFlagCapture?.(sourcePlayer?.index);
            this.entityManager?.recorder?.logEvent?.('FLAG_CAPTURED', sourcePlayer?.index ?? -1, flag.id);
            this.entityManager?.particles?.spawnExplosion?.(flag.position, resolveTeamColor(flag.teamId), { blast: 'ITEM_BURST' });
            this.entityManager?.audio?.play?.('FLAG_CAPTURE', { intensity: 0.9 });
            this.entityManager?._eventBus?.emitHuntFeed?.(`${resolveTeamLabel(flag.teamId)} erobert ${flag.id}`);
        } else if (result.applied > 0) {
            this.stateRevision += 1;
            this.entityManager?.particles?.spawnHit?.(flag.position, resolveTeamColor(flag.teamId));
        }
        this._syncVisual(flag);
        return { ...result, isDead: false };
    }

    _applyTeam(flag, teamId) {
        flag.teamId = normalizeTeamId(teamId) || flag.teamId;
        const material = flag.root?.userData?.banner?.material;
        material?.color?.setHex?.(resolveTeamColor(flag.teamId));
        material?.emissive?.setHex?.(resolveTeamColor(flag.teamId));
        this._syncVisual(flag);
        for (const guard of flag.guards) this.entityManager?._staticTurretSystem?.setTurretTeam?.(guard, flag.teamId);
    }

    update(dt) {
        if (!this.active) return;
        for (const flag of this.flags) {
            const protectedBefore = flag.protectionRemaining > 0;
            tickFlagObjectiveProtection(flag, dt);
            this._syncVisual(flag);
            if (!this.networkReplica && protectedBefore && flag.protectionRemaining <= 0) {
                this._restoreCapturedGuards(flag);
            }
        }
    }

    getTargets() { return this.active ? this.flags : []; }

    getRoundOutcome() {
        if (!this.active) return null;
        const elapsed = Math.max(0, Number(this.entityManager?._simulationClockMs) || 0) * 0.001;
        const result = resolveFlagObjectiveOutcome(this.flags, elapsed);
        if (!result) return { shouldEnd: false, winner: null, reason: '', flagCounts: null, overtime: false };
        if (result.overtime === true) this.overtime = true;
        const winner = result.winnerTeamId
            ? this.entityManager?.players?.find((player) => player?.teamId === result.winnerTeamId
                && player?.entitySlotActive !== false) || null
            : null;
        return { ...result, winner, reason: this.overtime && result.shouldEnd
            ? FLAG_OBJECTIVE_REASONS.OVERTIME : result.reason };
    }

    serializeNetworkState() {
        if (!this.active) return null;
        return {
            version: 1,
            revision: this.stateRevision,
            captureEventId: this.captureEventId,
            captureEvent: this.captureEvent ? { ...this.captureEvent } : null,
            entries: this.flags.map((flag) => ({
                id: flag.id, teamId: flag.teamId, hp: flag.hp, maxHp: flag.maxHp,
                protectionRemaining: flag.protectionRemaining,
                position: [flag.position.x, flag.position.y, flag.position.z],
            })),
        };
    }

    applyNetworkState(payload) {
        const entries = Array.isArray(payload) ? payload : payload?.entries;
        if (!Array.isArray(entries)) return;
        const revision = Array.isArray(payload) ? this.lastAppliedRevision + 1 : Number(payload?.revision);
        if (Number.isFinite(revision) && revision <= this.lastAppliedRevision) return;
        this.networkReplica = true;
        for (const entry of entries) {
            const flag = this.flags.find((candidate) => candidate.id === entry?.id);
            if (!flag) continue;
            flag.maxHp = Math.max(1, Number(entry.maxHp) || FLAG_OBJECTIVE_DEFAULTS.maxHp);
            flag.hp = Math.max(0, Math.min(flag.maxHp, Number(entry.hp) || 0));
            flag.protectionRemaining = Math.max(0, Math.min(
                FLAG_OBJECTIVE_DEFAULTS.protectionSeconds,
                Number(entry.protectionRemaining) || 0,
            ));
            if (Array.isArray(entry.position) && entry.position.length >= 3
                && entry.position.slice(0, 3).every((value) => Number.isFinite(Number(value)))) {
                flag.position.set(Number(entry.position[0]), Number(entry.position[1]), Number(entry.position[2]));
                flag.root?.position?.copy?.(flag.position);
            }
            this._applyTeam(flag, entry.teamId);
            this._syncVisual(flag);
        }
        if (Number.isFinite(revision)) this.lastAppliedRevision = revision;
        const eventId = Math.max(0, Math.trunc(Number(payload?.captureEventId) || 0));
        if (eventId > this.lastAppliedCaptureEventId) {
            this.lastAppliedCaptureEventId = eventId;
            this.captureEventId = eventId;
            this.captureEvent = payload?.captureEvent && typeof payload.captureEvent === 'object'
                ? { ...payload.captureEvent, id: eventId }
                : null;
            const capturedFlag = this.flags.find((flag) => flag.id === this.captureEvent?.flagId);
            if (capturedFlag) {
                this.entityManager?.particles?.spawnExplosion?.(
                    capturedFlag.position,
                    resolveTeamColor(capturedFlag.teamId),
                    { blast: 'ITEM_BURST' },
                );
                this.entityManager?.audio?.play?.('FLAG_CAPTURE', { intensity: 0.9 });
                this.entityManager?._eventBus?.emitHuntFeed?.(
                    `${resolveTeamLabel(capturedFlag.teamId)} erobert ${capturedFlag.id}`,
                );
            }
        }
    }

    setNetworkReplica(enabled) { this.networkReplica = enabled === true; }

    clear() {
        const renderer = this.entityManager?.renderer;
        for (const flag of this.flags) {
            if (flag.root) renderer?.removeFromScene?.(flag.root);
            flag.root?.traverse?.((node) => {
                node.geometry?.dispose?.();
                node.material?.dispose?.();
            });
        }
        this.flags.length = 0;
        this.active = false;
        this.stateRevision = 0;
        this.captureEventId = 0;
        this.captureEvent = null;
        this.lastAppliedRevision = -1;
        this.lastAppliedCaptureEventId = 0;
        this.overtime = false;
    }

    dispose() { this.clear(); }
}
