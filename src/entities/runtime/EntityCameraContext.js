// @ts-check

export function updateEntityCameraContext(context, player, otherPlayerPosition) {
    const playerState = context.playerState;
    playerState.hp = Number(player?.hp) || 0;
    playerState.maxHp = Number(player?.maxHp) || 1;
    playerState.score = Number(player?.score) || 0;
    playerState.speed = Number(player?.speed) || 0;
    playerState.isBoosting = player?.isBoosting === true;
    context.otherPlayerPosition = otherPlayerPosition;
    const discontinuityVersion = Number(player?.renderDiscontinuityVersion ?? player?._renderDiscontinuityVersion);
    context.discontinuityVersion = Number.isFinite(discontinuityVersion)
        ? discontinuityVersion
        : undefined;
    return context;
}

function readCoordinate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

export function findNearestProjectedCameraOpponentPosition(players, subject, out) {
    if (!Array.isArray(players) || !subject || !out) return null;
    const subjectIndex = Number(subject.playerIndex);
    const subjectX = readCoordinate(subject.position?.x);
    const subjectY = readCoordinate(subject.position?.y);
    const subjectZ = readCoordinate(subject.position?.z);
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    let nearestX = 0;
    let nearestY = 0;
    let nearestZ = 0;

    for (const candidate of players) {
        if (!candidate || candidate === subject || candidate.alive === false) continue;
        if (Number(candidate.playerIndex) === subjectIndex) continue;
        const x = readCoordinate(candidate.position?.x);
        const y = readCoordinate(candidate.position?.y);
        const z = readCoordinate(candidate.position?.z);
        const dx = x - subjectX;
        const dy = y - subjectY;
        const dz = z - subjectZ;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq >= nearestDistanceSq) continue;
        nearestDistanceSq = distanceSq;
        nearestX = x;
        nearestY = y;
        nearestZ = z;
    }

    return Number.isFinite(nearestDistanceSq) ? out.set(nearestX, nearestY, nearestZ) : null;
}

export function findNearestLiveCameraOpponentPosition(
    players,
    subject,
    subjectPosition,
    renderAlpha,
    out
) {
    if (!Array.isArray(players) || !subject || !subjectPosition || !out) return null;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    let nearestX = 0;
    let nearestY = 0;
    let nearestZ = 0;

    for (const candidate of players) {
        if (!candidate || candidate === subject || candidate.alive === false) continue;
        if (typeof candidate.resolveRenderPosition === 'function') {
            candidate.resolveRenderPosition(renderAlpha, out);
        } else {
            out.set(
                readCoordinate(candidate.position?.x),
                readCoordinate(candidate.position?.y),
                readCoordinate(candidate.position?.z)
            );
        }
        const distanceSq = out.distanceToSquared(subjectPosition);
        if (distanceSq >= nearestDistanceSq) continue;
        nearestDistanceSq = distanceSq;
        nearestX = out.x;
        nearestY = out.y;
        nearestZ = out.z;
    }

    return Number.isFinite(nearestDistanceSq) ? out.set(nearestX, nearestY, nearestZ) : null;
}
