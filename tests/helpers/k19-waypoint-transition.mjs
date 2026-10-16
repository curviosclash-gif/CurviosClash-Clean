export const K19_NEON_CP05_ROUTE_ID = 'neon-cp05-east-wall-overpass-v3';
export const K19_NEON_CP05_ROUTE_WAYPOINTS = Object.freeze([
    Object.freeze({ x: 220, y: 120, z: -16 }),
]);
export const K19_NEON_CP05_ENTRY_POSITION = Object.freeze({ x: 235, y: 48, z: -8 });
export const K19_NEON_CP06_ROUTE_ID = 'neon-cp06-south-wall-overpass-v1';
export const K19_FROZEN_CP06_WAYPOINTS = Object.freeze([
    Object.freeze({ x: 90, y: 165, z: -100 }),
]);
export const K19_FROZEN_CP07_WAYPOINTS = Object.freeze([
    Object.freeze({ x: 50, y: 165, z: -35 }),
    Object.freeze({ x: 50, y: 175, z: 40 }),
    Object.freeze({ x: 24, y: 40, z: 30 }),
    Object.freeze({ x: 24, y: 65, z: 30 }),
]);
export const K19_FROZEN_CP09_ENTRY_POSITION = Object.freeze({ x: 76, y: 41, z: 105 });
export const K19_SKY_CP07_ENTRY_POSITION = Object.freeze({ x: 210, y: 240, z: 60 });
export const K19_CHRONO_CHECKPOINT_WAYPOINTS = Object.freeze({
    CP05: Object.freeze([Object.freeze({ x: -80, y: 168, z: 102 })]),
    CP09: Object.freeze([Object.freeze({ x: 285, y: 72, z: -125 })]),
    CP10: Object.freeze([Object.freeze({ x: 370, y: 72, z: -10 })]),
    CP11: Object.freeze([Object.freeze({ x: 366, y: 72, z: 105 })]),
    CP12: Object.freeze([Object.freeze({ x: 390, y: 42, z: 175 })]),
});
export const K19_NEON_CP06_ROUTE_WAYPOINTS = Object.freeze([
    Object.freeze({ x: 205, y: 80, z: 100 }),
]);

/** Select a K19 physical ring entry, failing closed when runtime geometry disagrees. */
export function resolveK19CheckpointEntryOverride({
    mapKey, checkpointId, target, playerRadius, portalEndpoints, portalClearance,
} = {}) {
    if (typeof mapKey !== 'string' || typeof checkpointId !== 'string') return null;
    const positions = {
        'neon_circuit:CP05': { x: 235, y: 48, z: -8 },
        'neon_circuit:CP09': { x: -198, y: 42, z: -2 },
        'frozen_helix:CP09': { x: 76, y: 41, z: 105 },
        'sky_islands:CP07': { x: 210, y: 240, z: 60 },
    };
    const key = `${mapKey}:${checkpointId}`;
    if (!Object.hasOwn(positions, key)) return null;
    const position = positions[key];
    const finitePoint = (point) => point && [point.x, point.y, point.z].every(Number.isFinite);
    const finiteTarget = Array.isArray(target?.pos) && target.pos.length === 3 && target.pos.every(Number.isFinite);
    const finitePortals = Array.isArray(portalEndpoints) && portalEndpoints.length > 0
        && portalEndpoints.every(finitePoint);
    if (target?.id !== checkpointId || !finiteTarget || !Number.isFinite(target.radius) || target.radius <= 0
        || !Number.isFinite(playerRadius) || playerRadius <= 0
        || !finitePortals || !Number.isFinite(portalClearance) || portalClearance <= 0) {
        return { accepted: false, rejectionReason: 'invalid-runtime-entry-geometry' };
    }

    const center = { x: target.pos[0], y: target.pos[1], z: target.pos[2] };
    const contactRadius = target.radius + playerRadius;
    const checkpointDistance = Math.hypot(position.x - center.x, position.y - center.y, position.z - center.z);
    const nearestPortalDistance = Math.min(...portalEndpoints.map((endpoint) => Math.hypot(
        endpoint.x - position.x,
        endpoint.y - position.y,
        endpoint.z - position.z,
    )));
    if (!(Number.isFinite(contactRadius) && contactRadius > 0 && checkpointDistance < contactRadius)) {
        return {
            accepted: false,
            rejectionReason: 'outside-authored-checkpoint-contact-radius',
            position, center, contactRadius, checkpointDistance, portalClearance, nearestPortalDistance,
        };
    }
    if (!(Number.isFinite(nearestPortalDistance) && nearestPortalDistance > portalClearance)) {
        return {
            accepted: false,
            rejectionReason: 'portal-clearance',
            position, center, contactRadius, checkpointDistance, portalClearance, nearestPortalDistance,
        };
    }
    return {
        accepted: true,
        position, center, contactRadius, checkpointDistance, portalClearance, nearestPortalDistance,
    };
}

/** Detect the existing waypoint sphere or a forward sample-to-sample sweep through it. */
export function crossedWaypointArrivalBand(previous, current, waypoint, incomingStart, hullRadius) {
    const radius = Number(hullRadius) * 2;
    if (!(Number.isFinite(radius) && radius > 0)) return false;
    const coordinates = [previous, current, waypoint, incomingStart];
    if (coordinates.some((point) => !point || ![point.x, point.y, point.z].every(Number.isFinite))) return false;

    const offsetX = current.x - waypoint.x;
    const offsetY = current.y - waypoint.y;
    const offsetZ = current.z - waypoint.z;
    if (offsetX ** 2 + offsetY ** 2 + offsetZ ** 2 <= radius ** 2) return true;

    const directionX = waypoint.x - incomingStart.x;
    const directionY = waypoint.y - incomingStart.y;
    const directionZ = waypoint.z - incomingStart.z;
    const directionLength = Math.hypot(directionX, directionY, directionZ);
    if (!(directionLength > 0)) return false;
    const unitX = directionX / directionLength;
    const unitY = directionY / directionLength;
    const unitZ = directionZ / directionLength;
    const previousLongitudinal = (previous.x - waypoint.x) * unitX
        + (previous.y - waypoint.y) * unitY + (previous.z - waypoint.z) * unitZ;
    const currentLongitudinal = offsetX * unitX + offsetY * unitY + offsetZ * unitZ;

    // For an incoming unit vector, the front of the legacy arrival sphere is at -radius.
    if (!(previousLongitudinal < -radius && currentLongitudinal >= -radius)) return false;

    const segmentX = current.x - previous.x;
    const segmentY = current.y - previous.y;
    const segmentZ = current.z - previous.z;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2 + segmentZ ** 2;
    if (!(segmentLengthSquared > 0)) return false;
    const projection = Math.max(0, Math.min(1,
        ((waypoint.x - previous.x) * segmentX
            + (waypoint.y - previous.y) * segmentY
            + (waypoint.z - previous.z) * segmentZ) / segmentLengthSquared,
    ));
    const nearestX = previous.x + segmentX * projection - waypoint.x;
    const nearestY = previous.y + segmentY * projection - waypoint.y;
    const nearestZ = previous.z + segmentZ * projection - waypoint.z;
    return nearestX ** 2 + nearestY ** 2 + nearestZ ** 2 <= radius ** 2;
}

/** Fail closed when the turn-motion interval reaches the next steering target. */
export function turnIntervalReachesTarget(target, switchPoint, turnEnd, hullRadius) {
    const finitePoint = (point) => point && [point.x, point.y, point.z].every(Number.isFinite);
    const radius = Number(hullRadius) * 2;
    if (![target, switchPoint, turnEnd].every(finitePoint) || !(Number.isFinite(radius) && radius > 0)) return true;
    const dx = turnEnd.x - switchPoint.x;
    const dy = turnEnd.y - switchPoint.y;
    const dz = turnEnd.z - switchPoint.z;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const amount = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((target.x - switchPoint.x) * dx
            + (target.y - switchPoint.y) * dy + (target.z - switchPoint.z) * dz) / lengthSquared))
        : 0;
    return Math.hypot(
        target.x - (switchPoint.x + dx * amount),
        target.y - (switchPoint.y + dy * amount),
        target.z - (switchPoint.z + dz * amount),
    ) <= radius;
}

/** Select the exact required route, or the shortest candidate when no route is pinned. */
export function selectK19RouteCandidate(candidates, requiredRouteId = null, requiredWaypoints = null) {
    if (!Array.isArray(candidates)) return null;
    if (requiredRouteId !== null) {
        if (typeof requiredRouteId !== 'string' || !requiredRouteId) return null;
        if (!Array.isArray(requiredWaypoints) || requiredWaypoints.length < 1
            || requiredWaypoints.some((point) => !point || ![point.x, point.y, point.z].every(Number.isFinite))) return null;
        return candidates.find((candidate) => candidate?.routeId === requiredRouteId
            && Array.isArray(candidate.waypoints)
            && candidate.waypoints.length === requiredWaypoints.length
            && candidate.waypoints.every((point, index) => point
                && point.x === requiredWaypoints[index].x
                && point.y === requiredWaypoints[index].y
                && point.z === requiredWaypoints[index].z)) || null;
    }
    return candidates.filter((candidate) => Number.isFinite(candidate?.length))
        .sort((left, right) => left.length - right.length)[0] || null;
}

/** Bound look-at hull displacement over a straight turn interval without assuming monotonic quaternion motion. */
export function maximumOrientationDeviationEnvelope(radius, switchPoint, turnEnd, target) {
    const finitePoint = (point) => point && [point.x, point.y, point.z].every(Number.isFinite);
    const finiteRadius = Number(radius);
    if (!Number.isFinite(finiteRadius) || finiteRadius < 0
        || ![switchPoint, turnEnd, target].every(finitePoint)) return null;

    const delta = {
        x: turnEnd.x - switchPoint.x,
        y: turnEnd.y - switchPoint.y,
        z: turnEnd.z - switchPoint.z,
    };
    const travelled = Math.hypot(delta.x, delta.y, delta.z);
    if (!Number.isFinite(travelled)) return null;
    const relativeAt = (amount) => ({
        x: target.x - (switchPoint.x + delta.x * amount),
        y: target.y - (switchPoint.y + delta.y * amount),
        z: target.z - (switchPoint.z + delta.z * amount),
    });
    if (travelled === 0) {
        const relative = relativeAt(0);
        const relativeLength = Math.hypot(relative.x, relative.y, relative.z);
        return relativeLength > 1e-10 && relative.z / relativeLength < 1 - 1e-10 ? 0 : null;
    }
    const unitAt = (amount) => {
        const relative = relativeAt(amount);
        const length = Math.hypot(relative.x, relative.y, relative.z);
        return length > 1e-10 ? { x: relative.x / length, y: relative.y / length, z: relative.z / length } : null;
    };
    const directionAngle = (left, right) => {
        const crossX = left.y * right.z - left.z * right.y;
        const crossY = left.z * right.x - left.x * right.z;
        const crossZ = left.x * right.y - left.y * right.x;
        const dot = left.x * right.x + left.y * right.y + left.z * right.z;
        return Math.atan2(Math.hypot(crossX, crossY, crossZ), Math.max(-1, Math.min(1, dot)));
    };
    const relativeStart = relativeAt(0);
    const relativeDelta = { x: -delta.x, y: -delta.y, z: -delta.z };
    const relativeDeltaSquared = relativeDelta.x ** 2 + relativeDelta.y ** 2 + relativeDelta.z ** 2;
    const relativeStartDotDelta = relativeStart.x * relativeDelta.x
        + relativeStart.y * relativeDelta.y + relativeStart.z * relativeDelta.z;
    if (!(Number.isFinite(relativeDeltaSquared) && relativeDeltaSquared > 0
        && Number.isFinite(relativeStartDotDelta))) return null;
    const closestAmount = Math.max(0, Math.min(1, -relativeStartDotDelta / relativeDeltaSquared));
    const closestRelative = relativeAt(closestAmount);
    if (Math.hypot(closestRelative.x, closestRelative.y, closestRelative.z) <= 1e-10) return null;
    const zDerivativeConstant = relativeDelta.z * (relativeStart.x ** 2 + relativeStart.y ** 2 + relativeStart.z ** 2)
        - relativeStart.z * relativeStartDotDelta;
    const zDerivativeSlope = relativeDelta.z * relativeStartDotDelta - relativeStart.z * relativeDeltaSquared;
    const maximumZOnInterval = (from, to) => {
        const candidates = [from, to];
        if (zDerivativeSlope !== 0) {
            const stationary = -zDerivativeConstant / zDerivativeSlope;
            if (stationary > from && stationary < to) candidates.push(stationary);
        }
        return Math.max(...candidates.map((amount) => {
            const direction = unitAt(amount);
            return direction ? direction.z : Infinity;
        }));
    };

    const midpoint = 0.5;
    const midpointDirection = unitAt(midpoint);
    const startDirection = unitAt(0);
    const endDirection = unitAt(1);
    if (!midpointDirection || !startDirection || !endDirection) return null;
    const maximumZ = Math.min(1, maximumZOnInterval(0, 1) + 1e-12);
    // For setFromUnitVectors(-Z, n), the quaternion map is singular at n=+Z.
    if (!(maximumZ < 1 - 1e-10)) return null;
    const maximumSinHalf = Math.sqrt(Math.max(0, (1 + maximumZ) / 2));
    const horizontalVelocitySquared = relativeDelta.x ** 2 + relativeDelta.y ** 2;
    const horizontalStartLength = Math.hypot(relativeStart.x, relativeStart.y);
    let crossesVerticalAxis = horizontalVelocitySquared === 0 && horizontalStartLength <= 1e-10;
    const closestHorizontalAmount = horizontalVelocitySquared > 0
        ? Math.max(0, Math.min(1,
            -(relativeStart.x * relativeDelta.x + relativeStart.y * relativeDelta.y) / horizontalVelocitySquared,
        ))
        : 0;
    const closestHorizontal = relativeAt(closestHorizontalAmount);
    if (Math.hypot(closestHorizontal.x, closestHorizontal.y) <= 1e-10) {
        if (closestHorizontal.z >= 0) return null;
        crossesVerticalAxis = true;
    }
    const azimuthArc = (from, to) => {
        const left = relativeAt(from);
        const right = relativeAt(to);
        const leftLength = Math.hypot(left.x, left.y);
        const rightLength = Math.hypot(right.x, right.y);
        if (leftLength <= 1e-10 || rightLength <= 1e-10) return null;
        return Math.atan2(Math.abs(left.x * right.y - left.y * right.x), left.x * right.x + left.y * right.y);
    };
    const directionDeviation = Math.min(Math.PI, Math.max(
        directionAngle(midpointDirection, startDirection),
        directionAngle(midpointDirection, endDirection),
    ) + 1e-12);
    const azimuthDeviation = crossesVerticalAxis
        ? 0
        : Math.min(Math.PI, Math.max(azimuthArc(midpoint, 0), azimuthArc(midpoint, 1)) + 1e-12);
    if (!Number.isFinite(directionDeviation) || !Number.isFinite(azimuthDeviation)) return null;
    // Quaternion angular speed obeys ds^2 = d(theta)^2 + 4 sin^2(theta/2)d(phi)^2.
    // Bound its path length by the total look-direction arc plus the maximum sin(theta/2)
    // times azimuth travel. At a -Z axis crossing, azimuth may jump where sin(theta/2)=0,
    // so that zero-weight jump contributes no orientation travel.
    const orientationAngleBound = Math.min(Math.PI,
        directionDeviation + 2 * maximumSinHalf * azimuthDeviation);
    const rotationalDisplacement = 2 * finiteRadius * Math.sin(orientationAngleBound / 2);
    return Number.isFinite(rotationalDisplacement) ? rotationalDisplacement : null;
}

/** Reserve the full pose-sample budget for a pinned route before generic probes begin. */
export function createK19RoutePreflightPlan({ requiredRoute = false, samplesRemaining, maxSamples } = {}) {
    if (!Number.isSafeInteger(samplesRemaining) || samplesRemaining < 0
        || !Number.isSafeInteger(maxSamples) || maxSamples < 1 || samplesRemaining > maxSamples) return null;
    return {
        requiredFirst: requiredRoute === true,
        sampleBudget: requiredRoute === true ? maxSamples : samplesRemaining,
    };
}

/** Keep timeout observation on the Neon segments whose pre-reset failures are audited. */
export function shouldObserveK19SegmentTimeout(mapKey, checkpointId) {
    return (mapKey === 'neon_circuit' && (checkpointId === 'CP02' || checkpointId === 'CP04'))
        || (mapKey === 'frozen_helix' && (checkpointId === 'CP05' || checkpointId === 'CP07'));
}

/** Turn any observed segment timeout into a deterministic harness failure. */
export function failOnK19SegmentTimeout(snapshot, mapKey, checkpointId) {
    if (!snapshot) return false;
    throw new Error(`Observed Parcours segment timeout on ${mapKey} ${checkpointId}; `
        + `elapsed=${snapshot.simulation?.segmentElapsedMs}ms limit=${snapshot.simulation?.maxSegmentTimeMs}ms `
        + `resetCountBefore=${snapshot.progress?.resetCount}`);
}

/** Return the true incoming origin for a bounded route target, or null when malformed. */
export function getWaypointIncomingStart(start, waypoints, waypointIndex) {
    const finitePoint = (point) => point && [point.x, point.y, point.z].every(Number.isFinite);
    if (!finitePoint(start) || !Array.isArray(waypoints)
        || waypoints.length < 1 || waypoints.length > 5
        || waypoints.some((point) => !finitePoint(point))
        || !Number.isInteger(waypointIndex) || waypointIndex < 0 || waypointIndex >= waypoints.length) return null;
    return waypointIndex === 0 ? start : waypoints[waypointIndex - 1];
}

/** Measure the full route polyline; waypoints includes the final authored target. */
export function measureWaypointPolyline(start, waypoints) {
    const finitePoint = (point) => point && [point.x, point.y, point.z].every(Number.isFinite);
    const distance3 = (left, right) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
    if (!finitePoint(start) || !Array.isArray(waypoints)
        || waypoints.length < 1 || waypoints.length > 5
        || waypoints.some((point) => !finitePoint(point))) return null;
    let length = 0;
    let previous = start;
    for (const point of waypoints) {
        length += distance3(previous, point);
        previous = point;
    }
    return Number.isFinite(length) ? length : null;
}

/** Measure distance left along the active polyline, including off-line recovery distance. */
export function remainingWaypointPolylineDistance(position, start, waypoints, activeIndex) {
    const finitePoint = (point) => point && [point.x, point.y, point.z].every(Number.isFinite);
    const distance3 = (left, right) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
    if (!finitePoint(start) || !finitePoint(position) || !Array.isArray(waypoints)
        || waypoints.length < 1 || waypoints.length > 5
        || waypoints.some((point) => !finitePoint(point)) || !Number.isInteger(activeIndex)
        || activeIndex < 0 || activeIndex >= waypoints.length) return null;
    const from = activeIndex === 0 ? start : waypoints[activeIndex - 1];
    const to = waypoints[activeIndex];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const amount = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((position.x - from.x) * dx
            + (position.y - from.y) * dy + (position.z - from.z) * dz) / lengthSquared))
        : 0;
    const projected = { x: from.x + dx * amount, y: from.y + dy * amount, z: from.z + dz * amount };
    let remaining = distance3(position, projected) + distance3(projected, to);
    for (let index = activeIndex + 1; index < waypoints.length; index += 1) {
        remaining += distance3(waypoints[index - 1], waypoints[index]);
    }
    return Number.isFinite(remaining) ? remaining : null;
}

/**
 * Check the route centerline at portal clearance, then bound turn displacement
 * only around internal route vertices where the driver changes direction.
 */
export function portalPathConflictsWithTurnEnvelope(points, endpoints, portalClearance, turnDisplacement, turnGeometry = []) {
    const finitePoint = (point) => point && [point.x, point.y, point.z].every(Number.isFinite);
    if (!Array.isArray(points) || points.length < 2 || !Array.isArray(endpoints)
        || !Number.isFinite(portalClearance) || portalClearance < 0
        || !Number.isFinite(turnDisplacement) || turnDisplacement < 0 || !Array.isArray(turnGeometry)
        || points.some((point) => !finitePoint(point)) || endpoints.some((point) => !finitePoint(point))) return true;
    if (turnGeometry.some((turn) => !finitePoint(turn?.switchPoint) || !finitePoint(turn?.turnEnd)
        || !finitePoint(turn?.turnMidpoint) || (turn?.departureEnd !== undefined && !finitePoint(turn.departureEnd))
        || !Number.isFinite(turn?.departureEnvelope) || turn.departureEnvelope < 0)) return true;

    const pointToSegmentDistance = (point, from, to) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const lengthSquared = dx * dx + dy * dy + dz * dz;
        const amount = lengthSquared > 0
            ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / lengthSquared))
            : 0;
        return Math.hypot(
            point.x - (from.x + dx * amount),
            point.y - (from.y + dy * amount),
            point.z - (from.z + dz * amount),
        );
    };

    for (const endpoint of endpoints) {
        for (let index = 1; index < points.length; index += 1) {
            if (pointToSegmentDistance(endpoint, points[index - 1], points[index]) <= portalClearance) return true;
        }
        for (let index = 1; index < points.length - 1; index += 1) {
            if (pointToSegmentDistance(endpoint, points[index], points[index]) <= portalClearance + turnDisplacement) return true;
        }
        for (const turn of turnGeometry) {
            if (pointToSegmentDistance(endpoint, turn.switchPoint, turn.turnEnd) <= portalClearance) return true;
            if (pointToSegmentDistance(endpoint, turn.turnMidpoint, turn.departureEnd || points[points.length - 1])
                <= portalClearance + turn.departureEnvelope) return true;
        }
    }
    return false;
}


/**
 * All departures from an exactly collinear turn interval share the positive ray to the target.
 * Sweeping from its earliest point covers their complete union; keep a roundoff margin.
 * Any nonzero bend retains the original isotropic envelope instead of using a tolerance.
 */
export function resolveCollinearDepartureSweep({ switchPoint, turnEnd, target, arrivalBand, maxMotionDisplacement } = {}) {
    const finitePoint = point => point && [point.x, point.y, point.z].every(Number.isFinite);
    if (![switchPoint, turnEnd, target].every(finitePoint)
        || !Number.isFinite(arrivalBand) || arrivalBand < 0
        || !Number.isFinite(maxMotionDisplacement) || maxMotionDisplacement <= 0) return null;
    const axes = ['x', 'y', 'z'];
    const move = axes.map(key => turnEnd[key] - switchPoint[key]);
    const ray = axes.map(key => target[key] - switchPoint[key]);
    const distance = Math.hypot(...ray);
    const moveLength = Math.hypot(...move);
    if (!(distance > 0 && moveLength > 0) || !Number.isFinite(distance + moveLength)) return null;
    // Exact equality deliberately fails closed for even tiny non-collinearity.
    const cross = [move[1] * ray[2] - move[2] * ray[1],
        move[2] * ray[0] - move[0] * ray[2], move[0] * ray[1] - move[1] * ray[0]];
    if (!cross.every(value => Number.isFinite(value) && value === 0)) return null;
    const dot = move.reduce((sum, value, index) => sum + value * ray[index], 0);
    const coordinateBound = Math.max(1, ...[switchPoint, turnEnd, target].flatMap(point => axes.map(key => Math.abs(point[key]))));
    if (coordinateBound > 1e6) return null;
    const envelope = Number.EPSILON * coordinateBound * 128;
    if (!(dot > 0) || !(distance - moveLength > arrivalBand + maxMotionDisplacement + envelope)) return null;
    return { from: { ...switchPoint }, to: { ...target }, envelope };
}
