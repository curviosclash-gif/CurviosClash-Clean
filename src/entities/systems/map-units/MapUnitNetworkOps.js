import { resolveUnitPathPose } from './MapUnitMovementOps.js';
import { normalizeMapUnit } from '../../../shared/contracts/MapUnitContract.js';

/**
 * Map units across the network. The host decides where a tank is, whether it lives and when it
 * fires; clients build the same tanks from the same map, keep driving them along the path between
 * two snapshots (smooth motion) and take every snapshot as the truth. A client never deals damage.
 */

const BLAST_COLOR = 0xff8a3d;

function round(value, digits = 1000) {
    return Math.round((Number(value) || 0) * digits) / digits;
}

/** Null on every map without tanks, so the block costs nothing there. */
export function serializeMapUnits(units) {
    if (!Array.isArray(units) || units.length === 0) return null;
    return units.map((unit) => ({
        id: unit.id,
        alive: unit.alive === true,
        hp: round(unit.hp, 10),
        from: unit.fromIndex,
        to: unit.toIndex,
        progress: round(unit.progress),
        yaw: round(unit.yaw),
        ...(unit.escortTank ? {
            escortReachedGoal: unit.escortReachedGoal === true,
            escortSpeed: round(unit.speed),
        } : {}),
        ...(unit.kind === 'bomber' ? {
            crashing: unit.crashing === true,
            pos: [round(unit.position.x), round(unit.position.y), round(unit.position.z)],
            bombs: unit.bombsFired,
            ...(unit.summoned ? {
                summoned: true,
                calledBy: unit.calledByIndex,
                remaining: round(unit.summonRemaining),
                path: unit.path.map((point) => point.map((value) => round(value))),
                speed: unit.speed,
            } : {}),
        } : {}),
        ...(unit.kind === 'swarm' ? {
            members: unit.members.map((member) => ({ alive: member.alive === true, hp: round(member.hp, 10) })),
        } : {}),
        ...(unit.kind === 'creature' ? { attacks: unit.attacksFired } : {}),
        mounts: unit.mounts.map((mount) => ({
            aim: [round(mount.aimDirection.x), round(mount.aimDirection.y), round(mount.aimDirection.z)],
            shots: mount.shotsFired,
        })),
    }));
}

function applyMounts(system, unit, entries) {
    const turrets = system.entityManager?._staticTurretSystem;
    for (let index = 0; index < unit.mounts.length; index += 1) {
        const mount = unit.mounts[index];
        const entry = entries?.[index];
        if (!entry) continue;
        const aim = Array.isArray(entry.aim) ? entry.aim : null;
        if (aim) mount.aimDirection.set(Number(aim[0]) || 0, Number(aim[1]) || 0, Number(aim[2]) || 1);
        if (mount.aimDirection.lengthSq() > 0.000001) {
            system._tmpPoint.copy(unit.position).add(mount.aimDirection);
            mount.root?.userData?.headPivot?.lookAt?.(system._tmpPoint);
        }
        const shots = Math.max(0, Math.trunc(Number(entry.shots) || 0));
        // The first snapshot only learns the count; later ones replay every new shot as a tracer.
        if (mount.networkShotsInitialized === true && shots > mount.shotsFired && unit.alive) {
            turrets?._playReplicatedShot?.(mount);
        }
        mount.shotsFired = shots;
        mount.networkShotsInitialized = true;
    }
}

export function applyMapUnitsNetworkState(system, entries, onPoseChanged) {
    if (!Array.isArray(entries)) return;
    system.networkReplica = true;
    const byId = new Map(entries.map((entry) => [String(entry?.id || ''), entry]));
    const knownIds = new Set(system.units.map((unit) => unit.id));
    for (const entry of entries) {
        if (!entry?.summoned || knownIds.has(String(entry.id || '')) || !Array.isArray(entry.path)) continue;
        const definition = normalizeMapUnit({
            id: entry.id, kind: 'bomber', path: entry.path, loop: false,
            speed: entry.speed, respawnSeconds: 0,
        }, 0, undefined, { preserveSpatial: true });
        if (!definition) continue;
        const unit = system._createUnit(definition, 1);
        unit.summoned = true;
        unit.calledByIndex = Math.trunc(Number(entry.calledBy));
        unit.attackSourcePlayer = system.entityManager?.players?.find?.((player) => player?.index === unit.calledByIndex) || null;
        unit.summonRemaining = Math.max(0, Number(entry.remaining) || 0);
        system.units.push(unit);
        knownIds.add(unit.id);
    }
    for (const unit of system.units) {
        const entry = byId.get(unit.id);
        if (!entry) continue;
        const wasAlive = unit.alive;
        const wasCrashing = unit.crashing === true;
        let playCreatureAttack = false;
        const pathLength = unit.path.length;
        const from = Math.trunc(Number(entry.from));
        const to = Math.trunc(Number(entry.to));
        if (from >= 0 && from < pathLength && to >= 0 && to < pathLength && from !== to) {
            unit.fromIndex = from;
            unit.toIndex = to;
            unit.progress = Math.max(0, Number(entry.progress) || 0);
        }
        unit.yaw = Number.isFinite(Number(entry.yaw)) ? Number(entry.yaw) : unit.yaw;
        unit.hp = Math.max(0, Number(entry.hp) || 0);
        unit.alive = entry.alive === true;
        if (unit.escortTank) {
            unit.escortReachedGoal = entry.escortReachedGoal === true;
            unit.speed = Math.max(0, Number(entry.escortSpeed) || unit.speed);
        }
        if (unit.kind === 'bomber') {
            unit.crashing = entry.crashing === true;
            unit.bombsFired = Math.max(0, Math.trunc(Number(entry.bombs) || 0));
            if (unit.summoned) unit.summonRemaining = Math.max(0, Number(entry.remaining) || 0);
            if (unit.crashing && Array.isArray(entry.pos)) {
                unit.groundPosition.set(Number(entry.pos[0]) || 0, Number(entry.pos[1]) || 0, Number(entry.pos[2]) || 0);
            }
        }
        system.setBossRoomClock?.(unit, unit.alive);
        if (unit.kind === 'swarm' && Array.isArray(entry.members)) {
            let totalHp = 0;
            for (let index = 0; index < unit.members.length; index += 1) {
                const member = unit.members[index];
                const state = entry.members[index];
                if (!state) continue;
                member.alive = state.alive === true;
                member.hp = Math.max(0, Number(state.hp) || 0);
                totalHp += member.hp;
            }
            unit.hp = totalHp;
            if (unit.source) unit.source.alive = unit.alive;
        }
        if (unit.kind === 'creature') {
            const attacks = Math.max(0, Math.trunc(Number(entry.attacks) || 0));
            playCreatureAttack = unit.networkAttacksInitialized && attacks > unit.attacksFired && unit.alive;
            unit.attacksFired = attacks;
            unit.networkAttacksInitialized = true;
        }
        if (!unit.crashing) resolveUnitPathPose(unit, unit.path, unit.groundPosition);
        onPoseChanged(unit);
        if (playCreatureAttack) {
            system.entityManager?.particles?.spawnExplosion?.(unit.position, 0xd4773f, {
                cause: 'PROJECTILE', projectileType: 'CREATURE_ATTACK',
            });
        }
        if (unit.root) unit.root.visible = unit.alive || unit.crashing;
        if ((wasAlive && !unit.alive && unit.kind !== 'swarm' && unit.kind !== 'bomber')
            || (wasCrashing && !unit.crashing && !unit.alive && unit.kind === 'bomber')) {
            // Only the picture: damage, loot and credit already happened on the host.
            system.entityManager?.particles?.spawnExplosion?.(unit.position, BLAST_COLOR, { cause: 'PROJECTILE', projectileType: 'ROCKET_HEAVY' });
        }
        applyMounts(system, unit, entry.mounts);
    }
}
