/** Find one physical point inside a directional checkpoint, away from a portal crossed by its centerline. */
export function shouldSelectPortalSafeCheckpointEntryCandidate({ kind, target, directWallClear, directPortalConflict }) {
    return kind === 'checkpoint'
        && Array.isArray(target?.forward)
        && directWallClear === true
        && directPortalConflict === true;
}

export function createPortalSafeCheckpointEntryCandidate({
    start, checkpoint, playerRadius, portal, portalClearance, maxMotionDisplacement,
}) {
    const center = checkpoint?.pos;
    const rawForward = checkpoint?.forward;
    const coordinates = [start?.x, start?.y, start?.z, center?.[0], center?.[1], center?.[2],
        rawForward?.[0], rawForward?.[1], rawForward?.[2], playerRadius, checkpoint?.radius,
        portal?.x, portal?.y, portal?.z, portalClearance, maxMotionDisplacement];
    if (!coordinates.every(Number.isFinite) || playerRadius <= 0 || checkpoint.radius <= 0
        || portalClearance <= 0 || maxMotionDisplacement < 0) return null;

    const forwardLength = Math.hypot(rawForward[0], rawForward[1], rawForward[2]);
    if (!(forwardLength > 0.0001)) return null;
    const forward = rawForward.map((value) => value / forwardLength);
    const startOffset = [start.x - center[0], start.y - center[1], start.z - center[2]];
    const startSide = startOffset[0] * forward[0] + startOffset[1] * forward[1] + startOffset[2] * forward[2];
    if (!(startSide < 0)) return null;

    const segment = [center[0] - start.x, center[1] - start.y, center[2] - start.z];
    const segmentLengthSquared = segment[0] ** 2 + segment[1] ** 2 + segment[2] ** 2;
    if (!(segmentLengthSquared > 0.0001)) return null;
    const portalOffset = [portal.x - start.x, portal.y - start.y, portal.z - start.z];
    const amount = Math.max(0, Math.min(1,
        (portalOffset[0] * segment[0] + portalOffset[1] * segment[1] + portalOffset[2] * segment[2])
            / segmentLengthSquared,
    ));
    const closest = [start.x + segment[0] * amount, start.y + segment[1] * amount, start.z + segment[2] * amount];
    const away = [closest[0] - portal.x, closest[1] - portal.y, closest[2] - portal.z];
    const centerlinePortalDistance = Math.hypot(...away);
    if (centerlinePortalDistance > portalClearance) return null;

    const normalComponent = away[0] * forward[0] + away[1] * forward[1] + away[2] * forward[2];
    const tangent = away.map((value, index) => value - forward[index] * normalComponent);
    const tangentLength = Math.hypot(...tangent);
    if (!(tangentLength > 0.0001)) return null;

    const contactRadius = checkpoint.radius + playerRadius;
    const forwardPenetration = Math.max(1, playerRadius * 0.5);
    const maximumTangentOffset = Math.sqrt(contactRadius ** 2 - forwardPenetration ** 2) * (1 - 1e-9);
    if (!(contactRadius > maxMotionDisplacement && maximumTangentOffset > 0)) return null;
    const positionAtTangentOffset = (offset) => ({
        x: center[0] + forward[0] * forwardPenetration + tangent[0] / tangentLength * offset,
        y: center[1] + forward[1] * forwardPenetration + tangent[1] / tangentLength * offset,
        z: center[2] + forward[2] * forwardPenetration + tangent[2] / tangentLength * offset,
    });
    const portalDistanceAtTangentOffset = (offset) => {
        const candidate = positionAtTangentOffset(offset);
        const segment = [candidate.x - start.x, candidate.y - start.y, candidate.z - start.z];
        const lengthSquared = segment[0] ** 2 + segment[1] ** 2 + segment[2] ** 2;
        if (!(lengthSquared > 0.0001)) return 0;
        const amount = Math.max(0, Math.min(1,
            ((portal.x - start.x) * segment[0] + (portal.y - start.y) * segment[1]
                + (portal.z - start.z) * segment[2]) / lengthSquared,
        ));
        return Math.hypot(
            start.x + segment[0] * amount - portal.x,
            start.y + segment[1] * amount - portal.y,
            start.z + segment[2] * amount - portal.z,
        );
    };
    if (!(portalDistanceAtTangentOffset(maximumTangentOffset) > portalClearance)) return null;
    let unsafeOffset = 0;
    let safeOffset = maximumTangentOffset;
    for (let iteration = 0; iteration < 16; iteration += 1) {
        const midpoint = (unsafeOffset + safeOffset) / 2;
        if (portalDistanceAtTangentOffset(midpoint) > portalClearance) safeOffset = midpoint;
        else unsafeOffset = midpoint;
    }
    const tangentOffset = safeOffset;
    const position = positionAtTangentOffset(tangentOffset);
    const endOffset = [position.x - center[0], position.y - center[1], position.z - center[2]];
    const endSide = endOffset[0] * forward[0] + endOffset[1] * forward[1] + endOffset[2] * forward[2];
    const checkpointDistance = Math.hypot(...endOffset);
    if (!(endSide > 0 && checkpointDistance < contactRadius)) return null;

    const crossingAmount = -startSide / (endSide - startSide);
    if (!(crossingAmount > 0 && crossingAmount < 1)) return null;
    const crossingPosition = {
        x: start.x + (position.x - start.x) * crossingAmount,
        y: start.y + (position.y - start.y) * crossingAmount,
        z: start.z + (position.z - start.z) * crossingAmount,
    };
    const crossingDistance = Math.hypot(
        crossingPosition.x - center[0],
        crossingPosition.y - center[1],
        crossingPosition.z - center[2],
    );
    // The real progress consumer checks the current fixed-tick position, not the exact
    // segment/plane intersection. Reserve the existing per-render motion bound so a
    // crossing tick can still end inside the actual contact sphere.
    if (!(crossingDistance + maxMotionDisplacement < contactRadius)) return null;

    const portalDistanceAfter = portalDistanceAtTangentOffset(tangentOffset);
    if (!(portalDistanceAfter > portalClearance)) return null;

    return { position, contactRadius, checkpointDistance, crossingPosition, crossingDistance,
        maxMotionDisplacement, forwardPenetration, tangentOffset,
        centerlinePortalDistance, portalDistanceAfter, portalClearance };
}

/**
 * Build a small set of physical ring poses that cross the checkpoint plane and reserve the
 * already-authored trigger radius for one bounded motion step. The caller still checks every pose
 * against the complete wall, turn, portal, and checkpoint sweep before using it.
 */
export function createWallSafeCheckpointEntryCandidates({
    start, checkpoint, playerRadius, maxMotionDisplacement, bidirectionalCheckpoints,
}) {
    const center = checkpoint?.pos;
    const rawForward = checkpoint?.forward;
    const coordinates = [
        start?.x, start?.y, start?.z,
        center?.[0], center?.[1], center?.[2],
        rawForward?.[0], rawForward?.[1], rawForward?.[2],
        checkpoint?.radius, playerRadius, maxMotionDisplacement,
    ];
    if (!coordinates.every(Number.isFinite)
        || checkpoint.radius <= 0
        || playerRadius <= 0
        || maxMotionDisplacement < 0
        || typeof bidirectionalCheckpoints !== 'boolean') return [];

    const forwardLength = Math.hypot(rawForward[0], rawForward[1], rawForward[2]);
    if (!Number.isFinite(forwardLength) || !(forwardLength > 0.0001)) return [];
    const forward = rawForward.map((value) => value / forwardLength);
    const startOffset = [start.x - center[0], start.y - center[1], start.z - center[2]];
    const startSide = startOffset[0] * forward[0] + startOffset[1] * forward[1] + startOffset[2] * forward[2];
    if (!Number.isFinite(startSide) || Math.abs(startSide) <= 0.0001
        || (startSide > 0 && !bidirectionalCheckpoints)) return [];

    const travelSide = startSide < 0 ? 1 : -1;
    const contactRadius = checkpoint.radius + playerRadius;
    if (!Number.isFinite(contactRadius) || !(contactRadius > maxMotionDisplacement)) return [];

    const penetration = Math.min(1, playerRadius * 0.5, contactRadius * 0.25);
    if (!(penetration > 0)) return [];
    const endSide = travelSide * penetration;
    const crossingAmount = -startSide / (endSide - startSide);
    if (!(crossingAmount > 0 && crossingAmount < 1)) return [];

    const up = [0, 1, 0];
    const projectOntoPlane = (axis) => {
        const amount = axis[0] * forward[0] + axis[1] * forward[1] + axis[2] * forward[2];
        const projected = axis.map((value, index) => value - amount * forward[index]);
        const length = Math.hypot(projected[0], projected[1], projected[2]);
        return length > 0.0001 ? projected.map((value) => value / length) : null;
    };
    const upTangent = projectOntoPlane(up) || projectOntoPlane([0, 0, 1]);
    if (!upTangent) return [];
    const sideTangent = [
        forward[1] * upTangent[2] - forward[2] * upTangent[1],
        forward[2] * upTangent[0] - forward[0] * upTangent[2],
        forward[0] * upTangent[1] - forward[1] * upTangent[0],
    ];
    const sideLength = Math.hypot(sideTangent[0], sideTangent[1], sideTangent[2]);
    if (!(sideLength > 0.0001)) return [];
    for (let index = 0; index < sideTangent.length; index += 1) sideTangent[index] /= sideLength;

    // Reserve the unchanged per-frame motion envelope at the true plane crossing.
    // The endpoint may use the full contact sphere, but that same tangent offset is
    // multiplied by crossingAmount at the plane. Solve the crossing sphere analytically
    // so a legal smaller tangent offset is not discarded just because the endpoint-max
    // offset would put the plane intersection outside the motion-reserved sphere.
    const crossingRadius = contactRadius - maxMotionDisplacement;
    const maximumEndpointOffset = Math.sqrt(Math.max(0, contactRadius ** 2 - penetration ** 2)) * (1 - 1e-6);
    if (!(crossingRadius > 0 && maximumEndpointOffset > 0)) return [];
    const directions = [
        { tangent: upTangent, axis: 'up', sign: 1 },
        { tangent: upTangent, axis: 'up', sign: -1 },
        { tangent: sideTangent, axis: 'side', sign: 1 },
        { tangent: sideTangent, axis: 'side', sign: -1 },
    ];
    const candidates = [];
    for (const { tangent, axis, sign } of directions) {
        const basePosition = {
            x: center[0] + forward[0] * endSide,
            y: center[1] + forward[1] * endSide,
            z: center[2] + forward[2] * endSide,
        };
        const baseCrossing = {
            x: start.x + (basePosition.x - start.x) * crossingAmount,
            y: start.y + (basePosition.y - start.y) * crossingAmount,
            z: start.z + (basePosition.z - start.z) * crossingAmount,
        };
        const crossingDelta = {
            x: tangent[0] * sign * crossingAmount,
            y: tangent[1] * sign * crossingAmount,
            z: tangent[2] * sign * crossingAmount,
        };
        const relativeCrossing = {
            x: baseCrossing.x - center[0],
            y: baseCrossing.y - center[1],
            z: baseCrossing.z - center[2],
        };
        const quadraticA = crossingDelta.x ** 2 + crossingDelta.y ** 2 + crossingDelta.z ** 2;
        const quadraticB = 2 * (relativeCrossing.x * crossingDelta.x
            + relativeCrossing.y * crossingDelta.y + relativeCrossing.z * crossingDelta.z);
        const quadraticC = relativeCrossing.x ** 2 + relativeCrossing.y ** 2
            + relativeCrossing.z ** 2 - crossingRadius ** 2;
        const discriminant = quadraticB ** 2 - 4 * quadraticA * quadraticC;
        if (![quadraticA, quadraticB, quadraticC, discriminant].every(Number.isFinite)
            || !(quadraticA > 0) || !(discriminant > 0)) continue;
        const root = Math.sqrt(discriminant);
        const intervalStart = (-quadraticB - root) / (2 * quadraticA);
        const intervalEnd = (-quadraticB + root) / (2 * quadraticA);
        if (![intervalStart, intervalEnd].every(Number.isFinite)) continue;
        const safeStart = Math.max(0, intervalStart);
        const safeEnd = Math.min(maximumEndpointOffset, intervalEnd);
        if (!(safeEnd > safeStart)) continue;
        const intervalWidth = safeEnd - safeStart;
        const boundaryMargin = Math.min(intervalWidth / 2, Math.max(1e-9, Math.abs(safeEnd) * 1e-9));
        let tangentOffset = safeEnd - boundaryMargin;
        let position = {
            x: basePosition.x + tangent[0] * tangentOffset * sign,
            y: basePosition.y + tangent[1] * tangentOffset * sign,
            z: basePosition.z + tangent[2] * tangentOffset * sign,
        };
        const endOffset = [position.x - center[0], position.y - center[1], position.z - center[2]];
        const checkpointDistance = Math.hypot(endOffset[0], endOffset[1], endOffset[2]);
        if (!Number.isFinite(checkpointDistance) || !(checkpointDistance < contactRadius)) continue;

        const measureCrossing = (point) => {
            const crossingPosition = {
                x: start.x + (point.x - start.x) * crossingAmount,
                y: start.y + (point.y - start.y) * crossingAmount,
                z: start.z + (point.z - start.z) * crossingAmount,
            };
            const crossingDistance = Math.hypot(
                crossingPosition.x - center[0],
                crossingPosition.y - center[1],
                crossingPosition.z - center[2],
            );
            return { crossingPosition, crossingDistance };
        };
        let { crossingPosition, crossingDistance } = measureCrossing(position);
        if (!Number.isFinite(crossingDistance)
            || !(crossingDistance + maxMotionDisplacement < contactRadius)) {
            // A midpoint is strictly inside the analytically open interval and avoids
            // accepting a rounded boundary when the safe interval is very narrow.
            tangentOffset = safeStart + intervalWidth / 2;
            position = {
                x: basePosition.x + tangent[0] * tangentOffset * sign,
                y: basePosition.y + tangent[1] * tangentOffset * sign,
                z: basePosition.z + tangent[2] * tangentOffset * sign,
            };
            ({ crossingPosition, crossingDistance } = measureCrossing(position));
            if (!Number.isFinite(crossingDistance)
                || !(crossingDistance + maxMotionDisplacement < contactRadius)) continue;
        }
        const finalEndOffset = [position.x - center[0], position.y - center[1], position.z - center[2]];
        const finalCheckpointDistance = Math.hypot(...finalEndOffset);
        if (!Number.isFinite(finalCheckpointDistance) || !(finalCheckpointDistance < contactRadius)) continue;

        candidates.push({
            position,
            contactRadius,
            checkpointDistance: finalCheckpointDistance,
            crossingPosition,
            crossingDistance,
            maxMotionDisplacement,
            forwardPenetration: penetration,
            tangentOffset,
            tangentAxis: axis,
            tangentSign: sign,
        });
    }
    return candidates;
}
