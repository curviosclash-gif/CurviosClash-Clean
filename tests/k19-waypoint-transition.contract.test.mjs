import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    crossedWaypointArrivalBand,
    getWaypointIncomingStart,
    measureWaypointPolyline,
    portalPathConflictsWithTurnEnvelope,
    remainingWaypointPolylineDistance,
    selectK19RouteCandidate,
    turnIntervalReachesTarget,
    maximumOrientationDeviationEnvelope,
    resolveCollinearDepartureSweep,
    createK19RoutePreflightPlan,
    shouldObserveK19SegmentTimeout,
    failOnK19SegmentTimeout,
} from './helpers/k19-waypoint-transition.mjs';
import { installK19SegmentTimeoutObserver } from './helpers/k19-segment-timeout-observer.mjs';

// Exercise the exact serialized function expression that the desktop page evaluates.
const desktopTransition = new Function(`return (${crossedWaypointArrivalBand.toString()});`)();
const desktopPortalTurnEnvelope = new Function(`return (${portalPathConflictsWithTurnEnvelope.toString()});`)();
const desktopIncomingStart = new Function(`return (${getWaypointIncomingStart.toString()});`)();
const desktopPolylineLength = new Function(`return (${measureWaypointPolyline.toString()});`)();
const desktopPolylineRemaining = new Function(`return (${remainingWaypointPolylineDistance.toString()});`)();
const desktopTurnIntervalReachesTarget = new Function(`return (${turnIntervalReachesTarget.toString()});`)();
const desktopSelectRouteCandidate = new Function(`return (${selectK19RouteCandidate.toString()});`)();
const desktopMaximumOrientationDeviation = new Function(`return (${maximumOrientationDeviationEnvelope.toString()});`)();
const desktopRoutePreflightPlan = new Function(`return (${createK19RoutePreflightPlan.toString()});`)();
const desktopShouldObserveTimeout = new Function(`return (${shouldObserveK19SegmentTimeout.toString()});`)();
const desktopFailOnTimeout = new Function(`return (${failOnK19SegmentTimeout.toString()});`)();
const desktopTimeoutObserver = new Function(`return (${installK19SegmentTimeoutObserver.toString()});`)();
const start = { x: 0, y: 0, z: 0 };
const waypoint = { x: 0, y: 0, z: -20 };
const hullRadius = 1.2;

test('preserves the existing slow arrival inside the radius-times-two sphere', () => {
    assert.equal(desktopTransition(
        { x: 0, y: 0, z: -17.5 }, { x: 0, y: 0, z: -18.5 }, waypoint, start, hullRadius,
    ), true);
});

test('detects a forward one-frame crossing of the full arrival band at the 9.368-unit bound', () => {
    const previous = { x: 0, y: 0, z: -17.5 };
    const current = { x: 0, y: 0, z: -26.868 };
    assert.ok(Math.hypot(current.x - previous.x, current.y - previous.y, current.z - previous.z) > hullRadius * 4);
    assert.ok(Math.hypot(current.x - waypoint.x, current.y - waypoint.y, current.z - waypoint.z) > hullRadius * 2);
    assert.equal(desktopTransition(previous, current, waypoint, start, hullRadius), true);
});

test('does not advance for a lateral segment that misses the same arrival sphere', () => {
    assert.equal(desktopTransition(
        { x: 2.5, y: 0, z: -17.5 }, { x: 2.5, y: 0, z: -26.868 }, waypoint, start, hullRadius,
    ), false);
});

test('does not treat a backward crossing as waypoint arrival', () => {
    assert.equal(desktopTransition(
        { x: 0, y: 0, z: -22.5 }, { x: 0, y: 0, z: -17.5 }, waypoint, start, hullRadius,
    ), false);
});

test('fails closed for a degenerate incoming leg', () => {
    assert.equal(desktopTransition(
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, waypoint, waypoint, hullRadius,
    ), false);
});

test('keeps the V29 straight departure outside portal clearance without smearing turn displacement over the whole leg', () => {
    const start = { x: -243.52662813548278, y: 43.61287384983231, z: 1.5662656821140026 };
    const endpoint = { x: -237.81345073215152, y: 41, z: 1.2120240506158426 };
    const turn = { x: -287.5, y: 151.9, z: -145.3 };
    const target = { x: -150, y: 36, z: -150 };
    assert.ok(Math.hypot(endpoint.x - start.x, endpoint.y - start.y, endpoint.z - start.z) > 6.2);
    assert.equal(desktopPortalTurnEnvelope([start, turn, target], [endpoint], 6.2, 9.368), false);
    // The old whole-leg expansion produced this false positive at the start projection.
    assert.ok(Math.hypot(endpoint.x - start.x, endpoint.y - start.y, endpoint.z - start.z) <= 6.2 + 9.368);
});

test('retains actual portal trigger and clearance protection for approach, crossing, and tangency', () => {
    const portal = { x: 0, y: 0, z: 0 };
    const turn = { x: 30, y: 0, z: 0 };
    const target = { x: 40, y: 0, z: 0 };
    assert.equal(desktopPortalTurnEnvelope([{ x: 8, y: 0, z: 0 }, turn, target], [portal], 6.2, 9.368), false);
    assert.equal(desktopPortalTurnEnvelope([{ x: 8, y: 0, z: 0 }, { x: -8, y: 0, z: 0 }, target], [portal], 6.2, 9.368), true);
    assert.equal(desktopPortalTurnEnvelope([{ x: -8, y: 6.2, z: 0 }, { x: 8, y: 6.2, z: 0 }, target], [portal], 6.2, 9.368), true);
    assert.equal(desktopPortalTurnEnvelope([{ x: 30, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }], [portal], 6.2, 9.368), false);
});

test('keeps the full turn-displacement envelope at an actual route corner and fails closed on malformed geometry', () => {
    assert.equal(desktopPortalTurnEnvelope(
        [{ x: -20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }],
        [{ x: 0, y: 15.568, z: 0 }], 6.2, 9.368,
    ), true);
    assert.equal(desktopPortalTurnEnvelope([{ x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 }], [], 6.2, 9.368), true);
});

test('checks the bounded post-turn departure segment against portal clearance', () => {
    const geometry = [{
        switchPoint: { x: 0, y: 0, z: 0 },
        turnEnd: { x: 0, y: 0, z: 9.368 },
        turnMidpoint: { x: 0, y: 0, z: 9.368 / 2 },
        departureEnvelope: 4.684,
    }];
    const points = [{ x: 0, y: 0, z: -10 }, geometry[0].switchPoint, { x: 100, y: 0, z: 0 }];
    const endpoint = { x: 20, y: 0, z: 7.4944 };
    assert.equal(desktopPortalTurnEnvelope(points, [endpoint], 6.2, 9.368), false);
    assert.equal(desktopPortalTurnEnvelope(points, [endpoint], 6.2, 9.368, geometry), true);
});

test('uses the immediately preceding leg as the crossing origin at every intermediate waypoint', () => {
    const route = [
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
        { x: 20, y: 0, z: 10 },
        { x: 20, y: 0, z: 20 },
    ];
    assert.deepEqual(desktopIncomingStart(start, route, 0), start);
    assert.deepEqual(desktopIncomingStart(start, route, 1), route[0]);
    assert.deepEqual(desktopIncomingStart(start, route, 2), route[1]);
    assert.deepEqual(desktopIncomingStart(start, route, 3), route[2]);
    assert.equal(desktopIncomingStart(start, route, 4), null);
});

test('bounds route size and measures total and remaining distance along the polyline', () => {
    const route = [
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
        { x: 20, y: 0, z: 10 },
    ];
    assert.equal(desktopPolylineLength(start, route), 30);
    assert.equal(desktopPolylineRemaining({ x: 5, y: 0, z: 0 }, start, route, 0), 25);
    assert.equal(desktopPolylineRemaining({ x: 10, y: 0, z: 5 }, start, route, 1), 15);
    assert.equal(desktopPolylineRemaining({ x: 15, y: 0, z: 10 }, start, route, 2), 5);
    assert.equal(desktopPolylineLength(start, [...route, { x: 20, y: 0, z: 20 }, { x: 30, y: 0, z: 20 }, { x: 40, y: 0, z: 20 }]), null);
    assert.equal(desktopPolylineRemaining({ x: 0, y: 0, z: 0 }, start, route, 3), null);
});

test('checks portal clearance across every polyline leg and each turn departure target', () => {
    const route = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
        { x: 20, y: 0, z: 10 },
    ];
    const turns = [
        { switchPoint: { x: 9, y: 0, z: 0 }, turnEnd: { x: 11, y: 0, z: 0 },
            turnMidpoint: { x: 10, y: 0, z: 0 }, departureEnd: route[2], departureEnvelope: 2.5 },
        { switchPoint: { x: 10, y: 0, z: 9 }, turnEnd: { x: 10, y: 0, z: 11 },
            turnMidpoint: { x: 10, y: 0, z: 10 }, departureEnd: route[3], departureEnvelope: 1 },
    ];
    assert.equal(desktopPortalTurnEnvelope(route, [{ x: 15, y: 0.5, z: 10 }], 1, 0, turns), true);
    // This endpoint clears every route leg and turn segment; only the first transition's
    // bounded departure toward route[2] includes it within the expanded envelope.
    assert.equal(desktopPortalTurnEnvelope(route, [{ x: 12, y: 2, z: 5 }], 1, 0, turns), true);
    assert.equal(desktopPortalTurnEnvelope(route, [{ x: 30, y: 10, z: 30 }], 1, 0, turns), false);
});

test('checks whether the segment-local next steering target lies on the turn-motion interval', () => {
    const waypoint = { x: 10, y: 0, z: 0 };
    const switchPoint = { x: 8, y: 0, z: 0 };
    const turnEnd = { x: 17.368, y: 0, z: 0 };
    const nextTarget = { x: 10, y: 0, z: 10 };
    // The incoming waypoint lies on the overshooting interval; it is not the target being
    // steered toward after the turn. Checking it caused every multi-segment candidate to HOLD.
    assert.equal(desktopTurnIntervalReachesTarget(waypoint, switchPoint, turnEnd, 1), true);
    assert.equal(desktopTurnIntervalReachesTarget(nextTarget, switchPoint, turnEnd, 1), false);
    assert.equal(desktopTurnIntervalReachesTarget({ x: 15, y: 0, z: 0 }, switchPoint, turnEnd, 1), true);
    assert.equal(desktopTurnIntervalReachesTarget({ x: 12, y: 1.9, z: 0 }, switchPoint, turnEnd, 1), true);
    assert.equal(desktopTurnIntervalReachesTarget({ x: 12, y: 2.01, z: 0 }, switchPoint, turnEnd, 1), false);
    assert.equal(desktopTurnIntervalReachesTarget(nextTarget, switchPoint, { x: NaN, y: 0, z: 0 }, 1), true);
    assert.equal(desktopTurnIntervalReachesTarget(nextTarget, switchPoint, turnEnd, 0), true);
});

test('pins the CP04 forward-departure route and checks static clearance from CP03 trail', () => {
    const routeId = 'neon-cp04-north-overpass-close-bore-v4';
    const cp03TrailStart = { x: -100, y: 80, z: -150 };
    const start = { x: -15.592907, y: 42.46415, z: -149.92378 };
    const geometry = [
        { x: -15.5, y: 42, z: -158 },
        { x: -29, y: 48, z: -157 },
        { x: -29, y: 53, z: -180 },
        { x: 180, y: 53, z: -170 },
    ];
    const endpoint = { x: 180, y: 36, z: -150 };
    const routePolyline = [...geometry, endpoint];
    const routeLength = desktopPolylineLength(start, routePolyline);
    const exact = { routeId, waypoints: geometry, length: routeLength };
    const shorterAlternative = { routeId: 'other-safe-route', length: 100 };
    assert.equal(desktopSelectRouteCandidate([exact, shorterAlternative], routeId, geometry), exact);
    assert.equal(desktopSelectRouteCandidate([shorterAlternative], routeId, geometry), null);
    assert.equal(desktopSelectRouteCandidate([{ ...exact, waypoints: geometry.slice(0, 2) }], routeId, geometry), null);
    assert.equal(desktopSelectRouteCandidate([{
        ...exact,
        waypoints: geometry.map((point, index) => index === 2 ? { ...point, x: 41 } : point),
    }], routeId, geometry), null);
    assert.equal(desktopSelectRouteCandidate([exact, shorterAlternative]).routeId, shorterAlternative.routeId);
    assert.equal(routePolyline.length, 5, 'the required route must fit the existing five-target preflight bound');
    assert.ok(Math.abs(routeLength - 281.922285) < 0.001, `unexpected pinned route length ${routeLength}`);
    assert.ok(routeLength / 18 < 16, `nominal route time ${routeLength / 18}s must fit a 16s segment`);

    const pointToSegmentDistance = (point, from, to) => {
        const direction = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
        const lengthSquared = direction.x ** 2 + direction.y ** 2 + direction.z ** 2;
        if (!(lengthSquared > 0)) return Math.hypot(point.x - from.x, point.y - from.y, point.z - from.z);
        const t = Math.max(0, Math.min(1, (
            (point.x - from.x) * direction.x
            + (point.y - from.y) * direction.y
            + (point.z - from.z) * direction.z
        ) / lengthSquared));
        return Math.hypot(
            point.x - (from.x + direction.x * t),
            point.y - (from.y + direction.y * t),
            point.z - (from.z + direction.z * t),
        );
    };
    const segmentToSegmentDistance = (from, to, otherFrom, otherTo) => {
        const distanceAt = (amount) => pointToSegmentDistance({
            x: from.x + (to.x - from.x) * amount,
            y: from.y + (to.y - from.y) * amount,
            z: from.z + (to.z - from.z) * amount,
        }, otherFrom, otherTo);
        let low = 0;
        let high = 1;
        for (let iteration = 0; iteration < 80; iteration += 1) {
            const left = low + (high - low) / 3;
            const right = high - (high - low) / 3;
            if (distanceAt(left) <= distanceAt(right)) high = right;
            else low = left;
        }
        return Math.min(distanceAt(0), distanceAt(1), distanceAt((low + high) / 2));
    };
    const segmentAabbDistance = (from, to, box) => {
        const distanceAt = (t) => {
            const point = {
                x: from.x + (to.x - from.x) * t,
                y: from.y + (to.y - from.y) * t,
                z: from.z + (to.z - from.z) * t,
            };
            const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x);
            const dy = Math.max(box.min.y - point.y, 0, point.y - box.max.y);
            const dz = Math.max(box.min.z - point.z, 0, point.z - box.max.z);
            return Math.hypot(dx, dy, dz);
        };
        let low = 0;
        let high = 1;
        for (let iteration = 0; iteration < 80; iteration += 1) {
            const left = low + (high - low) / 3;
            const right = high - (high - low) / 3;
            if (distanceAt(left) <= distanceAt(right)) high = right;
            else low = left;
        }
        return Math.min(distanceAt(0), distanceAt(1), distanceAt((low + high) / 2));
    };

    // Static authored boxes in world units. Start->A and A->B leave through the
    // authored open tunnel bore; its enclosing AABB is not a solid collider there.
    const northRail = { min: { x: -210, y: 30, z: -178.5 }, max: { x: 210, y: 42, z: -169.5 } };
    const tunnelBlock = { min: { x: -18, y: 0, z: -168 }, max: { x: 18, y: 84, z: -132 } };
    const eastPillar = { min: { x: 141, y: 0, z: -159 }, max: { x: 159, y: 60, z: -141 } };
    const railMinimum = Math.min(...[
        [start, geometry[0]], [geometry[0], geometry[1]], [geometry[1], geometry[2]],
        [geometry[2], geometry[3]], [geometry[3], endpoint],
    ].map(([from, to]) => segmentAabbDistance(from, to, northRail)));
    const eastPillarGap = segmentAabbDistance(geometry[2], geometry[3], eastPillar);
    const tunnelExteriorLegs = [
        { id: 'B→C', from: geometry[1], to: geometry[2] },
        { id: 'C→D', from: geometry[2], to: geometry[3] },
        { id: 'D→E', from: geometry[3], to: endpoint },
    ];
    const tunnelExteriorGaps = tunnelExteriorLegs.map((leg) => ({
        id: leg.id,
        distance: segmentAabbDistance(leg.from, leg.to, tunnelBlock),
    }));
    const tunnelMinimumExteriorGap = tunnelExteriorGaps.reduce((minimum, current) => (
        current.distance < minimum.distance ? current : minimum
    ));
    assert.ok(railMinimum > 8.0, `north rail static centerline gap ${railMinimum} must exceed 8.0 units`);
    assert.ok(eastPillarGap > 9.9, `east pillar static centerline gap ${eastPillarGap} must exceed 9.9 units`);
    assert.deepEqual(tunnelExteriorGaps.map(({ id }) => id), ['B→C', 'C→D', 'D→E']);
    assert.ok(tunnelMinimumExteriorGap.distance > 9.7,
        `minimum tunnel AABB gap over exterior legs is ${tunnelMinimumExteriorGap.distance} on ${tunnelMinimumExteriorGap.id}; expected > 9.7`);
    assert.equal(tunnelMinimumExteriorGap.id, 'C→D', 'the diagonal C→D overflight is the limiting exterior leg');

    const tunnelAxis = { x: 0, y: 42, z: -150 };
    const tunnelRadius = 15;
    const overflightInsideTunnelX = [
        { x: -18, y: 53, z: -180 + ((-18 - geometry[2].x) / (geometry[3].x - geometry[2].x)) * (geometry[3].z - geometry[2].z) },
        { x: 18, y: 53, z: -180 + ((18 - geometry[2].x) / (geometry[3].x - geometry[2].x)) * (geometry[3].z - geometry[2].z) },
    ];
    const tunnelRadialAtXBounds = overflightInsideTunnelX.map((point) => Math.hypot(
        point.y - tunnelAxis.y, point.z - tunnelAxis.z,
    ));
    assert.ok(Math.min(...tunnelRadialAtXBounds) > tunnelRadius + 14,
        `overflight must stay outside the authored tunnel cylinder while x crosses its AABB; radial=${tunnelRadialAtXBounds}`);
    const westBoreExitAmount = (-18 - geometry[0].x) / (geometry[1].x - geometry[0].x);
    const westBoreExit = {
        x: -18,
        y: geometry[0].y + (geometry[1].y - geometry[0].y) * westBoreExitAmount,
        z: geometry[0].z + (geometry[1].z - geometry[0].z) * westBoreExitAmount,
    };
    const boreRadialMaximum = Math.max(...[
        start,
        geometry[0],
        westBoreExit,
    ].map((point) => Math.hypot(point.y - tunnelAxis.y, point.z - tunnelAxis.z)));
    const staticWallHullBoundRadius = 6.2;
    assert.ok(boreRadialMaximum + staticWallHullBoundRadius < tunnelRadius,
        `open-bore departure radial ${boreRadialMaximum} plus static hull bound ${staticWallHullBoundRadius} must stay inside radius ${tunnelRadius}`);

    const cp03Portal = { x: 0, y: 42, z: -150 };
    const portalClearance = 4 + 2.342 + 1;
    const authoredPortalEndpoints = [
        cp03Portal,
        { x: 0, y: 42, z: 150 },
        { x: 240, y: 36, z: 0 },
        { x: -240, y: 36, z: 0 },
    ];
    const preEndpointLegs = [
        [start, geometry[0]], [geometry[0], geometry[1]], [geometry[1], geometry[2]], [geometry[2], geometry[3]],
    ];
    const cp03PortalGap = Math.min(...preEndpointLegs.map(([from, to]) => pointToSegmentDistance(cp03Portal, from, to)));
    assert.ok(cp03PortalGap > portalClearance, `CP03 portal static centerline gap ${cp03PortalGap} must exceed ${portalClearance}`);
    assert.ok(pointToSegmentDistance(cp03Portal, geometry[0], geometry[0]) > portalClearance + 9.368,
        'probe waypoint A must clear the existing internal-vertex turn-displacement threshold');
    const portalTurnFixtures = geometry.slice(0, -1).map((switchPoint, index) => ({
        switchPoint,
        turnEnd: switchPoint,
        turnMidpoint: switchPoint,
        departureEnd: geometry[index + 1],
        departureEnvelope: 6,
    }));
    assert.equal(desktopPortalTurnEnvelope(
        routePolyline,
        authoredPortalEndpoints,
        portalClearance,
        9.368,
        portalTurnFixtures,
    ), false, 'explicit static turn fixtures must pass the unchanged helper against all authored portal endpoints');
    const blockedV2Route = [
        start,
        { x: -12, y: 46, z: -157 },
        ...geometry.slice(1),
        endpoint,
    ];
    assert.equal(desktopPortalTurnEnvelope(
        blockedV2Route,
        authoredPortalEndpoints,
        portalClearance,
        9.368,
        portalTurnFixtures,
    ), true, 'the same helper must reproduce the previous route A portal-envelope blocker');

    const oldFailedWaypoint = { x: -29, y: 48, z: -149.925 };
    const oldFailedWaypointGap = pointToSegmentDistance(oldFailedWaypoint, cp03TrailStart, start);
    const departure = { x: geometry[0].x - start.x, y: geometry[0].y - start.y, z: geometry[0].z - start.z };
    const cp03Tangent = { x: start.x - cp03TrailStart.x, y: start.y - cp03TrailStart.y, z: start.z - cp03TrailStart.z };
    const forwardDepartureDot = departure.x * cp03Tangent.x + departure.y * cp03Tangent.y + departure.z * cp03Tangent.z;
    const forwardDepartureCosine = forwardDepartureDot / (
        Math.hypot(departure.x, departure.y, departure.z) * Math.hypot(cp03Tangent.x, cp03Tangent.y, cp03Tangent.z)
    );
    assert.ok(oldFailedWaypointGap < 0.4, `old CP04 first waypoint should reproduce the ${oldFailedWaypointGap}u trail proximity`);
    const forwardProjection = forwardDepartureDot / Math.hypot(cp03Tangent.x, cp03Tangent.y, cp03Tangent.z);
    assert.ok(forwardProjection > 0.25 && forwardDepartureCosine > 0.02 && forwardDepartureCosine < 0.05,
        `first leg must make a positive tangential departure from the CP03 trail; projection=${forwardProjection} cosine=${forwardDepartureCosine}`);
    const postDepartureLegs = [
        { id: 'A→B', from: geometry[0], to: geometry[1] },
        { id: 'B→C', from: geometry[1], to: geometry[2] },
        { id: 'C→D', from: geometry[2], to: geometry[3] },
        { id: 'D→E', from: geometry[3], to: endpoint },
    ].map((leg) => ({
        id: leg.id,
        distance: segmentToSegmentDistance(leg.from, leg.to, cp03TrailStart, start),
    }));
    const minimumPostDepartureGap = postDepartureLegs.reduce((minimum, current) => (
        current.distance < minimum.distance ? current : minimum
    ));
    assert.ok(minimumPostDepartureGap.distance > 7,
        `post-departure CP03 trail centerline gap ${minimumPostDepartureGap.distance} on ${minimumPostDepartureGap.id} must exceed 7 units`);
    assert.equal(minimumPostDepartureGap.id, 'A→B', 'A→B is the closest route leg to the CP03 trail');
    // These are static centerline/AABB/radial and endpoint-distance checks only. They do not
    // approve the runtime transformed-hull sweep, trail collision, turning envelope, or segment timeout.
});

test('reserves first-frame and death diagnostics for Neon CP04 and CP05 after the global quota', () => {
    const desktopSpec = readFileSync(new URL('./portal-chain-k19.desktop.spec.js', import.meta.url), 'utf8');
    assert.match(desktopSpec, /const effectiveDiagnosticTargetOrdinal = isNeonCp04DiagnosticTarget \? 4\s*: \(isNeonCp05DiagnosticTarget \? 5 : diagnosticTargetOrdinal\)/);
    assert.match(desktopSpec, /expectedMapKey === 'neon_circuit' && kind === 'checkpoint'\s*&& expectedCheckpointId === 'CP04'/);
    assert.match(desktopSpec, /emitDiagnostic\('first-frame'/);
    assert.match(desktopSpec, /emitDiagnostic\('waypoint-advance'/);
    assert.match(desktopSpec, /emitDiagnostic\('death-state'/);
});

test('continuous look-at envelope covers the reported interior maximum missed by sparse samples', () => {
    // Review counterexample: the u=.63 orientation deviation is 1.298515rad while
    // start/mid/end samples report only 1.132781rad; the function does not assume
    // monotonic orientation between those samples.
    const interiorMaximumRadians = 1.298515;
    const sampledMaximumRadians = 1.132781;
    assert.ok(interiorMaximumRadians > sampledMaximumRadians);
    const hullBoundRadius = 6.2;
    const switchPoint = { x: -9.810613, y: 4.334779, z: -9.890404 };
    const turnEnd = { x: -3.786037, y: 3.107939, z: -16.926631 };
    const nextTarget = { x: -5.850681, y: 3.121709, z: 0.152643 };
    const positionalUncertainty = Math.hypot(
        turnEnd.x - switchPoint.x, turnEnd.y - switchPoint.y, turnEnd.z - switchPoint.z,
    ) / 2;
    const conservativeEnvelope = desktopMaximumOrientationDeviation(
        hullBoundRadius, switchPoint, turnEnd, nextTarget,
    );
    const interiorPointDisplacement = 2 * hullBoundRadius * Math.sin(interiorMaximumRadians / 2);
    const sparseSampleEstimate = 2 * hullBoundRadius * Math.sin(sampledMaximumRadians / 2);
    const departureEnvelope = positionalUncertainty + conservativeEnvelope;
    assert.ok(interiorPointDisplacement > sparseSampleEstimate);
    assert.ok(positionalUncertainty + interiorPointDisplacement <= departureEnvelope);
    assert.equal(departureEnvelope, positionalUncertainty + conservativeEnvelope);
    assert.equal(desktopMaximumOrientationDeviation(Number.NaN, switchPoint, turnEnd, nextTarget), null);
    assert.equal(desktopMaximumOrientationDeviation(1, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }), null);
    assert.equal(desktopMaximumOrientationDeviation(1, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), null);
    assert.equal(desktopMaximumOrientationDeviation(1, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), null);
});

// Historical geometry used to exercise the pure turn-envelope helper; it is not the current pinned CP04 route.
test('bounds a historical CP04 vertical turn fixture and adds positional uncertainty once', () => {
    const switchPoint = { x: -25, y: 42.441, z: -159.616 };
    const turnEnd = { x: -25, y: 42.441, z: -168.984 };
    const nextTarget = { x: 170, y: 42.441, z: -162 };
    const radius = 6.2;
    const rotationalEnvelope = desktopMaximumOrientationDeviation(radius, switchPoint, turnEnd, nextTarget);
    assert.ok(Number.isFinite(rotationalEnvelope) && rotationalEnvelope >= 0);
    const positionalUncertainty = Math.hypot(
        turnEnd.x - switchPoint.x, turnEnd.y - switchPoint.y, turnEnd.z - switchPoint.z,
    ) / 2;
    const departureEnvelope = positionalUncertainty + rotationalEnvelope;
    assert.equal(departureEnvelope, positionalUncertainty + rotationalEnvelope);
    assert.ok(departureEnvelope < positionalUncertainty + 2 * radius);
});

// Historical geometry used to exercise the pure turn-envelope helper; it is not the current pinned CP04 route.
test('keeps a historical CP04 first-turn fixture finite when its look direction crosses the -Z pole', () => {
    const switchPoint = { x: -20.316, y: 42.441, z: -149.925 };
    const turnEnd = { x: -29.684, y: 42.441, z: -149.925 };
    const nextTarget = { x: -25, y: 42.441, z: -164.3 };
    const hullRadius = 2.342;
    const rotationalEnvelope = desktopMaximumOrientationDeviation(6.2, switchPoint, turnEnd, nextTarget);
    assert.ok(Number.isFinite(rotationalEnvelope));
    assert.equal(desktopTurnIntervalReachesTarget(nextTarget, switchPoint, turnEnd, hullRadius), false);
    assert.ok(rotationalEnvelope >= 0);
});

test('continuous look-at bound stays tighter than full rotation away from the antipodal singularity', () => {
    const switchPoint = { x: 0, y: 0, z: 0 };
    const turnEnd = { x: 8, y: 0, z: 0 };
    const target = { x: 10, y: 0, z: 10 };
    const radius = 1;
    const envelope = desktopMaximumOrientationDeviation(radius, switchPoint, turnEnd, target);
    const quaternionAt = (amount) => {
        const position = {
            x: switchPoint.x + (turnEnd.x - switchPoint.x) * amount,
            y: switchPoint.y + (turnEnd.y - switchPoint.y) * amount,
            z: switchPoint.z + (turnEnd.z - switchPoint.z) * amount,
        };
        const direction = [target.x - position.x, target.y - position.y, target.z - position.z];
        const length = Math.hypot(...direction);
        const [x, y, z] = direction.map((value) => value / length);
        const q = [y, -x, 0, 1 - z];
        const qLength = Math.hypot(...q);
        return q.map((value) => value / qLength);
    };
    const midpoint = quaternionAt(0.5);
    let maximumAngle = 0;
    for (let sample = 0; sample <= 100; sample += 1) {
        const quaternion = quaternionAt(sample / 100);
        const dot = Math.abs(midpoint.reduce((sum, value, index) => sum + value * quaternion[index], 0));
        maximumAngle = Math.max(maximumAngle, 2 * Math.acos(Math.min(1, dot)));
    }
    const requiredDepartureEnvelope = 4 + 2 * radius * Math.sin(maximumAngle / 2);
    const departureEnvelope = 4 + envelope;
    assert.ok(departureEnvelope >= requiredDepartureEnvelope);
    assert.ok(departureEnvelope < 4 + 2 * radius);
    assert.equal(desktopMaximumOrientationDeviation(
        1,
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0.1, y: 0.1, z: 1_000_000 },
    ), null, 'near-antipodal look-at geometry must fail closed');
});

test('reserves a fresh full sample budget for the required route regardless of generic candidate consumption', () => {
    const exhaustedGenericBudget = desktopRoutePreflightPlan({
        requiredRoute: true,
        samplesRemaining: 0,
        maxSamples: 65_536,
    });
    assert.deepEqual(exhaustedGenericBudget, { requiredFirst: true, sampleBudget: 65_536 });
    assert.deepEqual(desktopRoutePreflightPlan({
        requiredRoute: false,
        samplesRemaining: 0,
        maxSamples: 65_536,
    }), { requiredFirst: false, sampleBudget: 0 });
    assert.equal(desktopRoutePreflightPlan({ requiredRoute: true, samplesRemaining: 65_537, maxSamples: 65_536 }), null);
});

test('observes CP04 timeout before reset and deterministically fails the route contract', () => {
    assert.equal(desktopShouldObserveTimeout('neon_circuit', 'CP02'), true);
    assert.equal(desktopShouldObserveTimeout('neon_circuit', 'CP04'), true);
    assert.equal(desktopShouldObserveTimeout('neon_circuit', 'CP03'), false);
    assert.equal(desktopShouldObserveTimeout('other_map', 'CP04'), false);

    const player = { index: 0, alive: true, hp: 100, position: { x: 1, y: 2, z: 3 }, speed: 18 };
    const state = { startedAtMs: 0, lastCheckpointAtMs: 1000, resetCount: 0, nextCheckpointIndex: 4 };
    const system = {
        _route: { routeId: 'neon_circuit_v1', totalCheckpoints: 10,
            rules: { maxSegmentTimeMs: 16_000, resetToLastValid: false, resetOnDeath: true } },
        _registerSegmentTimeout(actualPlayer, actualState, now) {
            assert.equal(actualState.resetCount, 0);
            actualState.resetCount += 1;
            actualState.nextCheckpointIndex = 0;
            return { actualPlayer, now };
        },
    };
    const observer = desktopTimeoutObserver({
        progressSystem: system,
        expectedPlayer: player,
        getContext: () => ({ mapKey: 'neon_circuit', checkpointId: 'CP04', simulationClockMs: 17_050 }),
    });
    system._registerSegmentTimeout(player, state, 17_050);
    const snapshot = observer.getSnapshot();
    assert.equal(snapshot.checkpointId, 'CP04');
    assert.equal(snapshot.simulation.segmentElapsedMs, 16_050);
    assert.equal(snapshot.simulation.maxSegmentTimeMs, 16_000);
    assert.equal(snapshot.progress.resetCount, 0);
    assert.equal(state.resetCount, 1);
    assert.throws(() => desktopFailOnTimeout(snapshot, 'neon_circuit', 'CP04'), /Observed Parcours segment timeout on neon_circuit CP04/);
    assert.equal(desktopFailOnTimeout(null, 'neon_circuit', 'CP04'), false);
    observer.restore();
});

test('per-sample look-at changes along a turn where endpoint quaternion interpolation differs', () => {
    const target = { x: 10, y: 0, z: 10 };
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 8, y: 0, z: 0 };
    const unitDirection = (position) => {
        const x = target.x - position.x;
        const y = target.y - position.y;
        const z = target.z - position.z;
        const length = Math.hypot(x, y, z);
        return { x: x / length, y: y / length, z: z / length };
    };
    const startDirection = unitDirection(from);
    const endDirection = unitDirection(to);
    const endpointInterpolation = {
        x: startDirection.x + endDirection.x,
        y: startDirection.y + endDirection.y,
        z: startDirection.z + endDirection.z,
    };
    const interpolationLength = Math.hypot(endpointInterpolation.x, endpointInterpolation.y, endpointInterpolation.z);
    endpointInterpolation.x /= interpolationLength;
    endpointInterpolation.y /= interpolationLength;
    endpointInterpolation.z /= interpolationLength;
    const actualMidpointLook = unitDirection({ x: 4, y: 0, z: 0 });
    assert.ok(Math.hypot(
        actualMidpointLook.x - endpointInterpolation.x,
        actualMidpointLook.y - endpointInterpolation.y,
        actualMidpointLook.z - endpointInterpolation.z,
    ) > 0.03);
});


test('collinear departure covers every possible origin ray and keeps an explicit numerical margin', () => {
    const resolve = new Function(`return (${resolveCollinearDepartureSweep.toString()});`)();
    const input = { switchPoint: { x: 90, y: 150, z: 112 }, turnEnd: { x: 90, y: 150, z: 121 },
        target: { x: 90, y: 150, z: 200 }, arrivalBand: 2.4, maxMotionDisplacement: 9 };
    const sweep = resolve(input);
    assert.deepEqual(sweep.from, input.switchPoint); assert.deepEqual(sweep.to, input.target);
    assert.ok(sweep.envelope > 0 && sweep.envelope < 1e-8);
    for (let origin = 0; origin <= 100; origin++) for (let along = 0; along <= 100; along++) {
        const point = { x: 90, y: 150, z: (112 + 9 * origin / 100) * (1 - along / 100) + 200 * along / 100 };
        assert.ok(point.z >= sweep.from.z - sweep.envelope && point.z <= sweep.to.z + sweep.envelope);
        assert.equal(point.x, sweep.from.x); assert.equal(point.y, sweep.from.y);
    }
    for (const bad of [
        { target: { x: 90 + 1e-9, y: 150, z: 200 } },
        { target: { x: 90, y: 150, z: 100 } },
        { target: { x: 90, y: 150, z: 120 } },
        { target: { x: 90, y: 150, z: 130 } },
        { turnEnd: input.switchPoint }, { turnEnd: { x: NaN, y: 150, z: 121 } },
        { maxMotionDisplacement: 0 }, { arrivalBand: -1 },
    ]) assert.equal(resolve({ ...input, ...bad }), null);
});


test('collinear departure rejects the clearance boundary and its next representable value', () => {
    const input = { switchPoint: { x: 0, y: 0, z: 0 }, turnEnd: { x: 0, y: 0, z: 10 },
        target: { x: 0, y: 0, z: 22 }, arrivalBand: 2, maxMotionDisplacement: 10 };
    assert.equal(resolveCollinearDepartureSweep(input), null);
    assert.equal(resolveCollinearDepartureSweep({ ...input, target: { x: 0, y: 0, z: 22 + Number.EPSILON * 16 } }), null);
    assert.ok(resolveCollinearDepartureSweep({ ...input, target: { x: 0, y: 0, z: 22.001 } }));
});


test('Frozen CP05 observes the real segment deadline before any reset, alongside existing Neon coverage', () => {
    assert.equal(desktopShouldObserveTimeout('frozen_helix', 'CP05'), true);
    assert.equal(desktopShouldObserveTimeout('frozen_helix', 'CP07'), true);
    assert.equal(desktopShouldObserveTimeout('frozen_helix', 'CP04'), false);
    assert.equal(desktopShouldObserveTimeout('neon_circuit', 'CP04'), true);
});
