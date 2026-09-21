export const FLAG_BOT_ROLES = Object.freeze({
    ATTACKER: 'ATTACKER',
    DEFENDER: 'DEFENDER',
    SUPPORT: 'SUPPORT',
});

const FLAG_BOT_ROLE_ORDER = Object.freeze([
    FLAG_BOT_ROLES.ATTACKER,
    FLAG_BOT_ROLES.DEFENDER,
    FLAG_BOT_ROLES.SUPPORT,
]);

const DEFENSE_TRIGGER_RANGE_SQ = 72 * 72;
const DEFENSE_ARRIVAL_RANGE_SQ = 18 * 18;
const ATTACK_BOOST_RANGE_SQ = 42 * 42;

function distanceSq(first, second) {
    if (!first || !second) return Infinity;
    const dx = Number(first.x) - Number(second.x);
    const dy = Number(first.y) - Number(second.y);
    const dz = Number(first.z) - Number(second.z);
    const value = dx * dx + dy * dy + dz * dz;
    return Number.isFinite(value) ? value : Infinity;
}

function isFlagAvailable(flag) {
    return !!flag?.position && flag.alive !== false && Number(flag.hp) > 0;
}

function resolveFlagObjectives(runtimeContext) {
    if (Array.isArray(runtimeContext?.flagObjectives)) return runtimeContext.flagObjectives;
    const system = runtimeContext?.entityManager?._flagObjectiveSystem;
    return system?.active === true && Array.isArray(system.flags) ? system.flags : [];
}

function resolvePlayers(runtimeContext) {
    if (Array.isArray(runtimeContext?.navigationPlayers)) return runtimeContext.navigationPlayers;
    return Array.isArray(runtimeContext?.players) ? runtimeContext.players : [];
}

function findNearestEnemyToFlag(flag, teamId, players) {
    let nearest = null;
    let nearestDistanceSq = Infinity;
    for (const candidate of players) {
        if (!candidate?.position || candidate.alive === false || candidate.teamId === teamId) continue;
        const candidateDistanceSq = distanceSq(candidate.position, flag.position);
        if (candidateDistanceSq >= nearestDistanceSq) continue;
        nearest = candidate;
        nearestDistanceSq = candidateDistanceSq;
    }
    return nearest;
}

function selectAttackFlag(player, flags) {
    let selected = null;
    let selectedScore = Infinity;
    for (const flag of flags) {
        if (!isFlagAvailable(flag) || flag.teamId === player.teamId) continue;
        const protectionPenalty = Number(flag.protectionRemaining) > 0 ? 1_000_000 : 0;
        const maxHp = Math.max(1, Number(flag.maxHp) || 1);
        const hpRatio = Math.max(0, Math.min(1, Number(flag.hp) / maxHp));
        const score = protectionPenalty
            + distanceSq(player.position, flag.position)
            + hpRatio * 900;
        if (score >= selectedScore) continue;
        selected = flag;
        selectedScore = score;
    }
    return selected;
}

function selectDefenseFlag(player, flags, players) {
    let selected = null;
    let selectedScore = Infinity;
    for (const flag of flags) {
        if (!isFlagAvailable(flag) || flag.teamId !== player.teamId) continue;
        const maxHp = Math.max(1, Number(flag.maxHp) || 1);
        const hpRatio = Math.max(0, Math.min(1, Number(flag.hp) / maxHp));
        const intruder = findNearestEnemyToFlag(flag, player.teamId, players);
        const intruderDistanceSq = distanceSq(intruder?.position, flag.position);
        const threatened = hpRatio < 0.999 || intruderDistanceSq <= DEFENSE_TRIGGER_RANGE_SQ;
        if (!threatened) continue;
        const score = intruderDistanceSq * 0.35
            + distanceSq(player.position, flag.position) * 0.2
            + hpRatio * 1_200;
        if (score >= selectedScore) continue;
        selected = flag;
        selectedScore = score;
    }
    return selected;
}

export function resolveFlagBotRole(player, players = []) {
    const playerIndex = Number.isInteger(player?.index) ? player.index : 0;
    let botOrdinal = 0;
    for (const candidate of players) {
        if (candidate === player || candidate?.isBot !== true || candidate?.teamId !== player?.teamId) continue;
        const candidateIndex = Number.isInteger(candidate?.index) ? candidate.index : Infinity;
        if (candidateIndex < playerIndex) botOrdinal += 1;
    }
    return FLAG_BOT_ROLE_ORDER[botOrdinal % FLAG_BOT_ROLE_ORDER.length];
}

export function applyFlagBotMovement({
    policy,
    input,
    player,
    runtimeContext,
    shouldRetreat = false,
    clearSteering,
    steerToward,
} = {}) {
    if (!policy || !input || !player?.position || shouldRetreat) return null;
    const hunt = runtimeContext?.runtimeConfig?.hunt;
    const flagSystemActive = runtimeContext?.entityManager?._flagObjectiveSystem?.active === true;
    if (!flagSystemActive && !(hunt?.teamMode === true && hunt?.teamObjective === 'FLAGS')) return null;

    const flags = resolveFlagObjectives(runtimeContext);
    if (flags.length === 0) return null;
    const players = resolvePlayers(runtimeContext);
    const role = resolveFlagBotRole(player, players);
    const defenseFlag = role === FLAG_BOT_ROLES.ATTACKER
        ? null
        : selectDefenseFlag(player, flags, players);
    const targetFlag = defenseFlag || selectAttackFlag(player, flags);
    if (!targetFlag?.position) return null;

    const defending = targetFlag.teamId === player.teamId;
    const intruder = defending ? findNearestEnemyToFlag(targetFlag, player.teamId, players) : null;
    const targetPosition = intruder?.position || targetFlag.position;
    const targetDistanceSq = distanceSq(player.position, targetPosition);
    if (defending && !intruder && targetDistanceSq <= DEFENSE_ARRIVAL_RANGE_SQ) return null;

    player.flagBotRole = role;
    player.flagBotTargetId = String(targetFlag.id || '');
    player.botObjectiveType = 'FLAGS';

    clearSteering?.(input);
    steerToward?.(policy, input, player, targetPosition);
    input.boost = targetDistanceSq > ATTACK_BOOST_RANGE_SQ;

    if (!defending && Number(targetFlag.protectionRemaining) <= 0) {
        const aim = player.getAimDirection?.(policy._tmpRoleForward);
        const toFlag = policy._tmpGate?.subVectors?.(targetFlag.position, player.position);
        if (aim && toFlag) {
            const distance = toFlag.length();
            const mgRange = Math.max(12, Number(player?.gameplayConfig?.HUNT?.MG?.RANGE) || 95);
            if (distance > 0.001 && distance <= mgRange) {
                aim.normalize();
                const alignment = toFlag.dot(aim) / distance;
                const aimDotMin = Math.max(0.82, Number(player?.gameplayConfig?.HUNT?.MG?.AIM_DOT_MIN) || 0.965);
                if (alignment >= aimDotMin) input.shootMG = true;
            }
        }
    }

    return role;
}
