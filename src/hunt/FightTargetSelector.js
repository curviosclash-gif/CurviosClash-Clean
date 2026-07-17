function resolveHealthRatio(player) {
    const hp = Math.max(0, Number(player?.hp) || 0);
    const maxHp = Math.max(1, Number(player?.maxHp) || 1);
    return Math.min(1, hp / maxHp);
}

export function getPreferredFightEnemy(player, allPlayers, outVec, dt = 0) {
    let preferredIndex = Infinity;
    let wrappedIndex = Infinity;
    let candidateCount = 0;
    for (const other of allPlayers || []) {
        if (!other || other === player || !other.alive) continue;
        candidateCount += 1;
        const index = Number.isInteger(other.index) ? other.index : Infinity;
        if (index > player.index && index < preferredIndex) preferredIndex = index;
        if (index < wrappedIndex) wrappedIndex = index;
    }
    if (!Number.isFinite(preferredIndex)) preferredIndex = wrappedIndex;

    let enemy = null;
    let distSq = Infinity;
    let bestScore = Infinity;
    let lockedEnemy = null;
    let lockedDistSq = Infinity;
    let lockedScore = Infinity;
    for (const other of allPlayers || []) {
        if (!other || other === player || !other.alive) continue;
        outVec.subVectors(other.position, player.position);
        const candidateDistSq = outVec.lengthSq();
        const vitalityWeight = 0.8 + resolveHealthRatio(other) * 0.2;
        const affinityWeight = other.index === preferredIndex ? 0.55 : 1;
        const retaliationWeight = other.index === player.fightLastAttackerIndex ? 0.35 : 1;
        const score = candidateDistSq * vitalityWeight * affinityWeight * retaliationWeight;
        if (other.index === player.fightTargetPlayerIndex) {
            lockedEnemy = other;
            lockedDistSq = candidateDistSq;
            lockedScore = score;
        }
        if (score < bestScore) {
            bestScore = score;
            distSq = candidateDistSq;
            enemy = other;
        }
    }
    player.fightTargetLockRemaining = Math.max(0, Number(player.fightTargetLockRemaining) || 0) - Math.max(0, Number(dt) || 0);
    const retaliationSelected = enemy?.index === player.fightLastAttackerIndex;
    if (lockedEnemy && lockedEnemy !== enemy && !retaliationSelected && (
        player.fightTargetLockRemaining > 0 || lockedScore <= bestScore * 1.2
    )) {
        enemy = lockedEnemy;
        distSq = lockedDistSq;
    }
    if (enemy && enemy.index !== player.fightTargetPlayerIndex) {
        player.fightTargetPlayerIndex = enemy.index;
        player.fightTargetLockRemaining = 0.75;
    }
    return { enemy, distSq, candidateCount };
}
