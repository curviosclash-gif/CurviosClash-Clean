import * as THREE from 'three';
import {
    createFlagObjectiveState,
    damageFlagObjective,
    FLAG_OBJECTIVE_DEFAULTS,
    resolveFlagObjectiveOutcome,
    TEAM_OBJECTIVE_TYPES,
    tickFlagObjectiveProtection,
} from '../../shared/contracts/FlagObjectiveContract.js';
import { normalizeTeamId, TEAM_IDS } from '../../shared/contracts/TeamCombatContract.js';

const TEAM_COLORS = Object.freeze({ ALPHA: 0x2f8cff, BRAVO: 0xff4d62 });

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
    }

    startRound() {
        this.clear();
        const hunt = this.entityManager?.runtimeConfig?.hunt;
        this.active = hunt?.teamMode === true && hunt?.teamObjective === TEAM_OBJECTIVE_TYPES.FLAGS;
        if (!this.active) return 0;
        const bounds = this.entityManager?.arena?.bounds;
        const minX = readBound(bounds, 'minX', ['min', 'x'], -100);
        const maxX = readBound(bounds, 'maxX', ['max', 'x'], 100);
        const minY = readBound(bounds, 'minY', ['min', 'y'], 0);
        const maxY = readBound(bounds, 'maxY', ['max', 'y'], 80);
        const minZ = readBound(bounds, 'minZ', ['min', 'z'], -100);
        const maxZ = readBound(bounds, 'maxZ', ['max', 'z'], 100);
        const y = minY + (maxY - minY) * 0.35;
        for (const teamId of [TEAM_IDS.ALPHA, TEAM_IDS.BRAVO]) {
            const x = teamId === TEAM_IDS.ALPHA ? minX + (maxX - minX) * 0.2 : minX + (maxX - minX) * 0.8;
            for (let index = 0; index < FLAG_OBJECTIVE_DEFAULTS.flagsPerTeam; index += 1) {
                const z = minZ + (maxZ - minZ) * ((index + 1) / (FLAG_OBJECTIVE_DEFAULTS.flagsPerTeam + 1));
                this.flags.push(this._createFlag(`${teamId.toLowerCase()}_${index + 1}`, teamId, new THREE.Vector3(x, y, z)));
            }
        }
        return this.flags.length;
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
        flag.takeDamage = (amount, options = {}) => this.damageFlag(flag, amount, options);
        const offsets = [-5, 5];
        for (let index = 0; index < FLAG_OBJECTIVE_DEFAULTS.guardsPerFlag; index += 1) {
            const guard = this.entityManager?._staticTurretSystem?.addObjectiveGuard?.({
                id: `flag_guard_${id}_${index + 1}`,
                teamId,
                position: [position.x, position.y - 1.5, position.z + offsets[index]],
            });
            if (guard) flag.guards.push(guard);
        }
        return flag;
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
            new THREE.MeshStandardMaterial({ color: TEAM_COLORS[teamId], emissive: TEAM_COLORS[teamId], emissiveIntensity: 0.25 }),
        );
        banner.position.set(2, 2, 0);
        root.add(pole, banner);
        root.position.copy(position);
        root.userData.banner = banner;
        renderer.addToScene?.(root);
        return root;
    }

    damageFlag(flag, amount, options = {}) {
        if (!this.active || this.networkReplica) return { applied: 0, hpApplied: 0, remainingHp: flag?.hp || 0, captured: false };
        const sourcePlayer = options.sourcePlayer || null;
        const result = damageFlagObjective(flag, amount, sourcePlayer?.teamId);
        if (result.captured) {
            this._applyTeam(flag, flag.teamId);
            this.entityManager?._huntScoring?.registerFlagCapture?.(sourcePlayer?.index);
            this.entityManager?.recorder?.logEvent?.('FLAG_CAPTURED', sourcePlayer?.index ?? -1, flag.id);
            this.entityManager?.particles?.spawnExplosion?.(flag.position, TEAM_COLORS[flag.teamId], { blast: 'ITEM_BURST' });
        } else if (result.applied > 0) {
            this.entityManager?.particles?.spawnHit?.(flag.position, TEAM_COLORS[flag.teamId]);
        }
        return { ...result, isDead: false };
    }

    _applyTeam(flag, teamId) {
        flag.teamId = normalizeTeamId(teamId) || flag.teamId;
        const material = flag.root?.userData?.banner?.material;
        material?.color?.setHex?.(TEAM_COLORS[flag.teamId]);
        material?.emissive?.setHex?.(TEAM_COLORS[flag.teamId]);
        for (const guard of flag.guards) this.entityManager?._staticTurretSystem?.setTurretTeam?.(guard, flag.teamId);
    }

    update(dt) {
        if (!this.active) return;
        for (const flag of this.flags) tickFlagObjectiveProtection(flag, dt);
    }

    getTargets() { return this.active ? this.flags : []; }

    getRoundOutcome() {
        if (!this.active) return null;
        const elapsed = Math.max(0, Number(this.entityManager?._simulationClockMs) || 0) * 0.001;
        const result = resolveFlagObjectiveOutcome(this.flags, elapsed);
        if (!result) return { shouldEnd: false, winner: null, reason: '', flagCounts: null };
        const winner = this.entityManager?.players?.find((player) => player?.teamId === result.winnerTeamId) || null;
        return { ...result, winner, reason: 'FLAG_TIME_LIMIT' };
    }

    serializeNetworkState() {
        if (!this.active) return null;
        return this.flags.map((flag) => ({
            id: flag.id, teamId: flag.teamId, hp: flag.hp, maxHp: flag.maxHp,
            protectionRemaining: flag.protectionRemaining,
        }));
    }

    applyNetworkState(entries) {
        if (!Array.isArray(entries)) return;
        this.networkReplica = true;
        for (const entry of entries) {
            const flag = this.flags.find((candidate) => candidate.id === entry?.id);
            if (!flag) continue;
            flag.hp = Math.max(0, Number(entry.hp) || 0);
            flag.maxHp = Math.max(1, Number(entry.maxHp) || FLAG_OBJECTIVE_DEFAULTS.maxHp);
            flag.protectionRemaining = Math.max(0, Number(entry.protectionRemaining) || 0);
            this._applyTeam(flag, entry.teamId);
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
    }

    dispose() { this.clear(); }
}
