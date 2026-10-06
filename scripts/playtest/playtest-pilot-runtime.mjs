/* global window */
// The test pilot that runs inside the game renderer, once per fixed simulation step.
// It turns a goal (direct maneuver, waypoints, the parcours route, an opponent, a
// pickup, a combat tactic or one of the game's own bot policies) into the input a
// player's device would deliver: analog pitch/yaw/roll plus button presses. The input
// enters the game below every input source (getKeyboardInput of that device), so it
// takes the regular path, including the LAN guest forwarding. Positions, hits and
// checkpoint progress stay entirely the game's own.
//
// installPilotRuntime is serialised into the page with page.evaluate, so it must not
// reference anything outside its own body.

export const PILOT_VERSION = '1.1.0';

export function installPilotRuntime(version) {
    if (window.__playtestPilotRuntime?.version === version) return window.__playtestPilotRuntime.describe();

    const TAU = Math.PI * 2;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
    const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

    const game = () => window.GAME_INSTANCE;
    const manager = () => game()?.entityManager || null;
    const arenaOf = () => game()?.arena || manager()?.arena || null;

    const runtime = {
        version,
        spec: null,
        playerIndex: 0,
        status: 'idle',
        reason: null,
        frames: 0,
        startedFrame: 0,
        deviceInputs: new Map(),
        decisions: [],
        counters: { frames: 0, replans: 0, avoidances: 0, mgFrames: 0, rockets: 0, boosts: 0, items: 0 },
        nav: { path: null, pathIndex: 0, target: null, targetKey: null, plannedFrame: -1, blockedFrames: 0, search: null },
        botPolicy: null,
        lastCommand: null,
        lastRaw: null,
        trace: [],
        lastAhead: Infinity,
        mouthChoice: new Map(),
        passageExit: null,
        mapUnitHunter: null,
    };

    const note = (kind, data = {}) => {
        runtime.decisions.push({ frame: runtime.frames, kind, ...data });
        if (runtime.decisions.length > 120) runtime.decisions.shift();
    };

    const findPlayer = (index) => (manager()?.players || []).find((player) => player?.index === index) || null;
    const localDeviceIndex = (playerIndex) => {
        const session = manager()?.runtimeConfig?.session || game()?.runtimeConfig?.session || {};
        const localIndex = Number.isInteger(session.localPlayerIndex) ? session.localPlayerIndex : 0;
        return Math.max(0, playerIndex - localIndex);
    };

    // ---- geometry helpers -------------------------------------------------------------
    const vec = (player, x = 0, y = 0, z = 0) => new player.position.constructor(x, y, z);
    const toLocal = (player, point) => {
        const relative = vec(player, point[0], point[1], point[2]).sub(player.position);
        const distance = relative.length();
        relative.applyQuaternion(player.quaternion.clone().invert());
        return { right: relative.x, up: relative.y, ahead: -relative.z, distance };
    };
    const forwardOf = (player) => vec(player, 0, 0, -1).applyQuaternion(player.quaternion);
    const asArray = (value) => (Array.isArray(value) ? value : [value.x, value.y, value.z]);

    const collisionRadius = (player) => finite(player.hitboxRadius, 1) + 2.4;
    // Plans keep a wider berth: the ship cannot stop and overshoots corners by about its
    // turn radius. Narrow passages fall back to the tight radius.
    const planningRadius = (player) => finite(player.hitboxRadius, 1) + 5.5;
    const blockedAt = (player, point, radius) => {
        const arena = arenaOf();
        if (!arena?.checkCollisionFast) return false;
        return arena.checkCollisionFast(vec(player, point[0], point[1], point[2]), radius) === true;
    };
    const segmentClear = (player, from, to, radius, step = 2) => {
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        const dz = to[2] - from[2];
        const length = Math.hypot(dx, dy, dz);
        const count = Math.max(1, Math.ceil(length / step));
        for (let index = 1; index <= count; index += 1) {
            const t = index / count;
            if (blockedAt(player, [from[0] + dx * t, from[1] + dy * t, from[2] + dz * t], radius)) return false;
        }
        return true;
    };

    // ---- A* path planning on a lazily evaluated voxel grid ------------------------------
    // Binary min-heap on f; the open list of A* must never be scanned linearly, or a long
    // search freezes the renderer that also runs the game.
    const createHeap = () => {
        const items = [];
        return {
            get size() { return items.length; },
            push(item) {
                items.push(item);
                let index = items.length - 1;
                while (index > 0) {
                    const parent = (index - 1) >> 1;
                    if (items[parent].f <= items[index].f) break;
                    [items[parent], items[index]] = [items[index], items[parent]];
                    index = parent;
                }
            },
            pop() {
                const top = items[0];
                const last = items.pop();
                if (items.length) {
                    items[0] = last;
                    let index = 0;
                    for (;;) {
                        const left = index * 2 + 1;
                        const right = left + 1;
                        let smallest = index;
                        if (left < items.length && items[left].f < items[smallest].f) smallest = left;
                        if (right < items.length && items[right].f < items[smallest].f) smallest = right;
                        if (smallest === index) break;
                        [items[smallest], items[index]] = [items[index], items[smallest]];
                        index = smallest;
                    }
                }
                return top;
            },
        };
    };

    // A* that can run in slices: step(budgetMs) continues where the last call stopped
    // and returns null until the search is finished. A plan never has to fit one frame.
    const createPathSearch = (player, start, goal, { cell = 6, maxNodes = 20000, avoid = [], clearance = null } = {}) => {
        const radius = clearance ?? collisionRadius(player);
        // Numeric cell keys: string keys made the search several times slower.
        const key = (x, y, z) => ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
        const toCell = (point) => point.map((value) => Math.round(value / cell));
        const toPoint = (c) => c.map((value) => value * cell);
        const startCell = toCell(start);
        const goalCell = toCell(goal);
        const free = new Map();
        const isFree = (c) => {
            const k = key(c[0], c[1], c[2]);
            let value = free.get(k);
            if (value === undefined) {
                value = !blockedAt(player, toPoint(c), radius);
                free.set(k, value);
            }
            return value;
        };
        const avoidCost = (point) => {
            let cost = 0;
            for (const zone of avoid) {
                const d = Math.hypot(point[0] - zone.pos[0], point[1] - zone.pos[1], point[2] - zone.pos[2]);
                if (d < zone.radius) cost += zone.cost;
            }
            return cost;
        };
        const h = (c) => Math.hypot(c[0] - goalCell[0], c[1] - goalCell[1], c[2] - goalCell[2]);
        const open = createHeap();
        open.push({ c: startCell, g: 0, f: h(startCell) });
        const came = new Map();
        const best = new Map([[key(...startCell), 0]]);
        const neighbours = [];
        for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) {
            // Faces and edges only (18 neighbours); corner steps add cost, not routes.
            if ((x || y || z) && Math.abs(x) + Math.abs(y) + Math.abs(z) <= 2) neighbours.push([x, y, z, Math.hypot(x, y, z)]);
        }
        let expanded = 0;
        let reached = null;
        let closest = { c: startCell, h: h(startCell) };
        let spentMs = 0;
        const build = (partial) => {
            const cells = [reached];
            let cursor = reached;
            while (came.has(key(...cursor))) {
                cursor = came.get(key(...cursor));
                cells.unshift(cursor);
            }
            const points = cells.map(toPoint);
            if (!partial) points[points.length - 1] = goal.slice();
            // String pulling: keep only the corners a straight flight cannot cut.
            const pulled = [start.slice()];
            let anchor = 0;
            while (anchor < points.length - 1) {
                let far = anchor + 1;
                while (far + 1 < points.length && segmentClear(player, pulled[pulled.length - 1], points[far + 1], radius, 3)) far += 1;
                pulled.push(points[far]);
                anchor = far;
            }
            return { ok: true, partial, expanded, ms: Math.round(spentMs), points: pulled };
        };
        return {
            step(budgetMs = Infinity) {
                const sliceStart = performance.now();
                while (open.size && expanded < maxNodes) {
                    if ((expanded & 31) === 0 && performance.now() - sliceStart > budgetMs) {
                        spentMs += performance.now() - sliceStart;
                        return null;
                    }
                    const current = open.pop();
                    if (current.g > (best.get(key(...current.c)) ?? Infinity)) continue;
                    expanded += 1;
                    const distanceLeft = h(current.c);
                    if (distanceLeft < closest.h) closest = { c: current.c, h: distanceLeft };
                    if (distanceLeft <= 1) { reached = current.c; break; }
                    for (const [x, y, z, stepCost] of neighbours) {
                        const next = [current.c[0] + x, current.c[1] + y, current.c[2] + z];
                        if (!isFree(next)) continue;
                        const nextKey = key(...next);
                        const g = current.g + stepCost + avoidCost(toPoint(next));
                        if (g >= (best.get(nextKey) ?? Infinity)) continue;
                        best.set(nextKey, g);
                        came.set(nextKey, current.c);
                        // Slightly greedy (1.4): far fewer nodes, paths only a little longer.
                        open.push({ c: next, g, f: g + h(next) * 1.4 });
                    }
                }
                spentMs += performance.now() - sliceStart;
                if (reached) return build(false);
                // Space exhausted: fly the part that brings us closest, replan from there.
                if (closest.h < h(startCell) - 1) {
                    reached = closest.c;
                    return build(true);
                }
                return { ok: false, expanded, ms: Math.round(spentMs) };
            },
        };
    };

    // ---- steering ------------------------------------------------------------------------
    const turnRate = (player) => finite(player.turnSpeed, 2.4);
    const steerToward = (player, point, gain = 2.2) => {
        const local = toLocal(player, point);
        const yawError = Math.atan2(-local.right, Math.max(1e-3, local.ahead));
        const horizontal = Math.hypot(local.ahead, local.right);
        const pitchError = Math.atan2(local.up, Math.max(1e-3, horizontal));
        // Behind the ship atan2 is near +-pi: turn hard toward the nearer side.
        const behind = local.ahead < 0;
        const turn = behind ? (local.right >= 0 ? 1 : -1) : clamp(-yawError * gain / turnRate(player) * 2.4, -1, 1);
        const climb = clamp(pitchError * gain / turnRate(player) * 2.4, -1, 1);
        return { turn, climb, local };
    };

    // Look ahead along the current heading; when the flight path runs into geometry, pick
    // the free direction closest to the wanted one (a cone of candidates around the nose).
    const avoidObstacles = (player, command, { imminentOnly = false } = {}) => {
        const radius = collisionRadius(player);
        const speed = Math.max(10, finite(player.speed, 22));
        // Time to react grows with speed: about 1.2 s of flight, never less than a turn radius.
        const horizon = clamp(speed * 1.2, 18, 70);
        const forward = forwardOf(player);
        const origin = asArray(player.position);
        const probe = (direction, distance) => {
            for (let d = 3; d <= distance; d += 2) {
                if (blockedAt(player, [origin[0] + direction.x * d, origin[1] + direction.y * d, origin[2] + direction.z * d], radius)) return d;
            }
            return Infinity;
        };
        const ahead = probe(forward, horizon);
        runtime.lastAhead = ahead;
        // When the way to the next plan point is free, the plan already steers around the
        // geometry; only an impact right ahead overrides it.
        if (ahead === Infinity || (imminentOnly && ahead > 7)) { runtime.nav.blockedFrames = 0; return command; }
        runtime.nav.blockedFrames += 1;
        const right = vec(player, 1, 0, 0).applyQuaternion(player.quaternion);
        const up = vec(player, 0, 1, 0).applyQuaternion(player.quaternion);
        let best = null;
        // Right in front of a wall the most open way wins; further out, the goal direction counts.
        const emergency = ahead < 9;
        for (const angle of emergency ? [0.7, 1.05, 1.4, 1.75] : [0.35, 0.7, 1.05, 1.4]) {
            for (let k = 0; k < 8; k += 1) {
                const around = (k / 8) * TAU;
                const sideways = Math.sin(angle);
                const direction = forward.clone().multiplyScalar(Math.cos(angle))
                    .addScaledVector(right, Math.cos(around) * sideways)
                    .addScaledVector(up, Math.sin(around) * sideways).normalize();
                const clearDistance = probe(direction, horizon);
                // Prefer clear directions that agree with what the goal asked for.
                const agreement = -Math.cos(around) * command.turn + Math.sin(around) * command.climb;
                const score = (clearDistance === Infinity ? 100 : clearDistance) + agreement * (emergency ? 1 : 6) - angle * (emergency ? 1 : 4);
                if (!best || score > best.score) best = { score, around, angle, clearDistance };
            }
            if (best?.clearDistance === Infinity) break;
        }
        if (!best) return command;
        runtime.counters.avoidances += 1;
        if (runtime.nav.blockedFrames === 1) note('avoid', { wallAhead: round(ahead, 1), turnTo: round(best.around, 2), cone: round(best.angle, 2) });
        return {
            ...command,
            turn: clamp(-Math.cos(best.around) * 1.4, -1, 1),
            climb: clamp(Math.sin(best.around) * 1.4, -1, 1),
            avoiding: true,
        };
    };

    // Follow a planned path to `goal`. A new plan starts when the target changes, moves, or
    // every `replanEvery` frames; it is searched in 4 ms slices over several frames (wide
    // berth first, tight radius if that finds nothing) while the ship keeps flying.
    const SEARCH_SLICE_MS = 4;
    const navigateTo = (player, goal, targetKey, { avoid = [], replanEvery = 30 } = {}) => {
        const nav = runtime.nav;
        const here = asArray(player.position);
        const radius = collisionRadius(player);
        const goalMoved = !nav.target || Math.hypot(goal[0] - nav.target[0], goal[1] - nav.target[1], goal[2] - nav.target[2]) > 4;
        const keyChanged = nav.targetKey !== targetKey;
        if (keyChanged || ((goalMoved || runtime.frames - nav.plannedFrame >= replanEvery) && !nav.search)) {
            if (keyChanged) nav.path = null;
            nav.target = goal.slice();
            nav.targetKey = targetKey;
            nav.plannedFrame = runtime.frames;
            const wide = planningRadius(player);
            if (segmentClear(player, here, goal, wide, 3)) {
                nav.path = [here, goal.slice()];
                nav.pathIndex = 1;
                nav.search = null;
            } else {
                nav.search = { current: createPathSearch(player, here, goal, { avoid, clearance: wide }), tight: false, wideResult: null, goal: goal.slice(), avoid };
            }
        }
        if (nav.search) {
            let result = nav.search.current.step(SEARCH_SLICE_MS);
            if (result && (!result.ok || result.partial) && !nav.search.tight) {
                nav.search.wideResult = result;
                nav.search.tight = true;
                nav.search.current = createPathSearch(player, here, nav.search.goal, { avoid: nav.search.avoid });
                result = null;
            }
            if (result) {
                const wideResult = nav.search.wideResult;
                const chosen = result.ok && (!result.partial || !wideResult?.ok) ? result : (wideResult?.ok ? wideResult : result);
                runtime.counters.replans += 1;
                nav.path = chosen.ok ? chosen.points : [here, nav.search.goal];
                nav.pathIndex = 1;
                if (nav.targetKey !== runtime.lastPlannedKey) {
                    note('plan', { target: targetKey, ok: chosen.ok, partial: chosen.partial === true, tight: nav.search.tight, corners: nav.path.length, expanded: chosen.expanded, ms: chosen.ms });
                    runtime.lastPlannedKey = nav.targetKey;
                }
                nav.search = null;
            }
        }
        if (!nav.path) {
            // Still searching for a first plan to this target: head for it, avoidance on.
            return avoidObstacles(player, steerToward(player, goal));
        }
        // Pure pursuit: aim at the first path corner that is not yet close.
        const lookahead = clamp(finite(player.speed, 22) * 0.45, 7, 16);
        while (nav.pathIndex < nav.path.length - 1) {
            const corner = nav.path[nav.pathIndex];
            if (Math.hypot(corner[0] - here[0], corner[1] - here[1], corner[2] - here[2]) > lookahead) break;
            nav.pathIndex += 1;
        }
        const aim = nav.path[Math.min(nav.pathIndex, nav.path.length - 1)];
        const toAim = aim.map((value, index) => value - here[index]);
        const toAimLength = Math.hypot(...toAim) || 1;
        const reach = Math.min(toAimLength, 40);
        const aimClear = segmentClear(player, here, here.map((value, index) => value + toAim[index] / toAimLength * reach), radius, 3);
        return avoidObstacles(player, steerToward(player, aim), { imminentOnly: aimClear });
    };

    // ---- goals ----------------------------------------------------------------------------
    const parcoursGoal = (player) => {
        const em = manager();
        const route = em?.getParcoursRouteSnapshot?.();
        const progress = em?._parcoursProgressSystem?.getPlayerProgressSnapshot?.(player.index);
        if (!route?.enabled || !progress) return { error: 'no parcours route on this map/mode' };
        if (progress.completed) return { done: true, progress };
        const expected = progress.expectedCheckpointIds || [];
        const byId = new Map((route.checkpoints || []).map((checkpoint) => [checkpoint.id, checkpoint]));
        if (route.finish) byId.set('FINISH', { id: 'FINISH', ...route.finish });
        const here = asArray(player.position);
        const preferred = runtime.spec?.branch ? expected.filter((id) => id.includes(runtime.spec.branch)) : [];
        const candidates = (preferred.length ? preferred : expected).map((id) => byId.get(id)).filter(Boolean);
        if (!candidates.length) return { error: `expected checkpoints ${expected.join(',')} not in route` };
        candidates.sort((a, b) => Math.hypot(...asArray(a.pos).map((v, i) => v - here[i])) - Math.hypot(...asArray(b.pos).map((v, i) => v - here[i])));
        const target = candidates[0];
        // Rings that are not due now cost time if crossed; plan around them.
        const avoid = (route.checkpoints || [])
            .filter((checkpoint) => !expected.includes(checkpoint.id))
            .map((checkpoint) => ({ pos: asArray(checkpoint.pos), radius: finite(checkpoint.radius, 10) + 3, cost: 6 }));
        // A checkpoint inside a passage counts before its far mouth: fly out of the passage
        // first instead of turning inside it toward the next target.
        const committed = runtime.passageExit;
        if (committed && committed.checkpointId !== target.id) {
            const along = committed.axis.reduce((sum, value, i) => sum + (here[i] - committed.exit[i]) * value, 0);
            if (along < -2) return { target: committed.exit, key: `${committed.checkpointId}:exit`, avoid, progress };
            runtime.passageExit = null;
        }
        const gate = throughGate(player, target);
        if (gate.phase === 'through' && gate.exit && gate.axis) runtime.passageExit = { checkpointId: target.id, exit: gate.exit, axis: gate.axis };
        return { target: gate.point, key: `${target.id}:${gate.phase}`, avoid, progress, gate };
    };

    // A checkpoint inside a passage (a tunnel box or a hollow tube) is flown through along
    // the passage axis: first to a point in front of the mouth on the ship's side, then
    // straight through to a point behind the far mouth. Other checkpoints are crossed along
    // their own forward direction.
    const passageAround = (point) => {
        const arena = arenaOf();
        const Vector = window.GAME_INSTANCE.entityManager.humanPlayers?.[0]?.position?.constructor;
        for (const obstacle of arena?.obstacles || []) {
            if (obstacle?.tunnel && obstacle.box?.containsPoint && Vector
                && obstacle.box.containsPoint(new Vector(point[0], point[1], point[2]))) {
                const axisName = String(obstacle.tunnel.axis || 'x').toLowerCase();
                const index = axisName === 'y' ? 1 : axisName === 'z' ? 2 : 0;
                const min = asArray(obstacle.box.min);
                const max = asArray(obstacle.box.max);
                const mouthA = point.slice();
                const mouthB = point.slice();
                mouthA[index] = min[index];
                mouthB[index] = max[index];
                return { mouthA, mouthB, radius: finite(obstacle.tunnel.radius, 5), kind: 'tunnel' };
            }
            const tube = obstacle?.tube;
            if (tube && Number.isFinite(tube.ax) && Number.isFinite(tube.innerRadius)) {
                const a = [tube.ax, tube.ay, tube.az];
                const b = [tube.bx, tube.by, tube.bz];
                const ab = b.map((value, i) => value - a[i]);
                const lengthSq = ab.reduce((sum, value) => sum + value * value, 0);
                if (lengthSq < 1e-3) continue;
                const t = point.reduce((sum, value, i) => sum + (value - a[i]) * ab[i], 0) / lengthSq;
                if (t < 0 || t > 1) continue;
                const closest = a.map((value, i) => value + ab[i] * t);
                if (Math.hypot(...point.map((value, i) => value - closest[i])) > tube.innerRadius) continue;
                return { mouthA: a, mouthB: b, radius: tube.innerRadius, kind: 'tube' };
            }
        }
        return null;
    };
    const throughGate = (player, checkpoint) => {
        const center = asArray(checkpoint.pos);
        const here = asArray(player.position);
        const passage = passageAround(center);
        const unit = (vector) => {
            const length = Math.hypot(...vector) || 1;
            return vector.map((value) => value / length);
        };
        const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
        let entryMouth = center;
        let exitMouth = center;
        let axis;
        if (passage) {
            axis = unit(passage.mouthB.map((value, i) => value - passage.mouthA[i]));
            // Enter at the mouth with the shorter way (ship -> mouth -> checkpoint); the choice
            // sticks for this checkpoint, so the ship does not swing between both mouths.
            const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
            let fromB = runtime.mouthChoice.get(checkpoint.id);
            if (fromB === undefined) {
                fromB = distance(here, passage.mouthB) + distance(passage.mouthB, center)
                    < distance(here, passage.mouthA) + distance(passage.mouthA, center);
                runtime.mouthChoice.set(checkpoint.id, fromB);
            }
            if (fromB) axis = axis.map((value) => -value);
            entryMouth = fromB ? passage.mouthB : passage.mouthA;
            exitMouth = fromB ? passage.mouthA : passage.mouthB;
        } else {
            // A plain checkpoint is a sphere that counts from both sides: fly straight in.
            return { point: center, phase: 'direct' };
        }
        const lead = passage ? 16 : 22;
        const entry = entryMouth.map((value, i) => value - axis[i] * lead);
        const exit = exitMouth.map((value, i) => value + axis[i] * (passage ? 14 : 18));
        const fromEntry = here.map((value, i) => value - entry[i]);
        const along = dot(fromEntry, axis);
        const lateral = Math.hypot(...fromEntry.map((value, i) => value - axis[i] * along));
        const corridor = passage ? passage.radius * 0.45 : finite(checkpoint.radius, 10) * 0.6;
        // Inside the passage the ship stays on the through leg even when it drifts a little.
        const inside = passage && along > lead && lateral < passage.radius * 0.8;
        const lined = inside || (along > -4 && lateral < corridor);
        if (!lined) return { point: entry, phase: 'approach' };
        // Pursue a point on the axis a little ahead: this pulls the ship onto the centre
        // line instead of letting it drift toward a wall on the way to the far exit.
        const exitAlong = dot(exit.map((value, i) => value - entry[i]), axis);
        const pursuit = Math.min(exitAlong, Math.max(0, along) + 18);
        return { point: entry.map((value, i) => value + axis[i] * pursuit), phase: 'through', exit, axis };
    };

    const opponentOf = (player, wanted) => {
        const players = (manager()?.players || []).filter((other) => other && other !== player && other.alive !== false);
        if (Number.isInteger(wanted)) return players.find((other) => other.index === wanted) || null;
        const here = player.position;
        players.sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
        return players[0] || null;
    };

    const leadPoint = (player, target) => {
        // The machine gun hits almost at once; a short lead covers the turn delay.
        const projectileSpeed = finite(runtime.spec?.projectileSpeed, 600);
        const relative = target.position.clone().sub(player.position);
        const time = clamp(relative.length() / projectileSpeed, 0, 1.2);
        const velocity = target.velocity || vec(player);
        return asArray(target.position.clone().addScaledVector(velocity, time));
    };

    const lineOfSight = (player, point) => {
        const arena = arenaOf();
        if (!arena?.raycast) return true;
        const origin = player.position.clone();
        const direction = vec(player, point[0], point[1], point[2]).sub(origin);
        const distance = direction.length();
        if (distance < 1e-3) return true;
        const hit = arena.raycast(origin, direction.normalize(), distance);
        return !hit?.hit || hit.distance >= distance - 1;
    };

    const combatCommand = (player, tactic, wantedTarget) => {
        const target = opponentOf(player, wantedTarget);
        if (!target) return { command: { turn: 0, climb: 0 }, info: { target: null } };
        const aim = leadPoint(player, target);
        const local = toLocal(player, aim);
        const offNose = Math.acos(clamp(local.ahead / Math.max(1e-3, local.distance), -1, 1));
        const hpRatio = finite(player.hp, 1) / Math.max(1, finite(player.maxHp, 100));
        const evasive = tactic === 'evasive' || (tactic === 'balanced' && hpRatio < 0.3);
        let command;
        if (evasive && local.distance < 40) {
            // Break away: fly to a point opposite the threat, then turn back in.
            const away = asArray(player.position.clone().multiplyScalar(2).sub(target.position));
            command = navigateTo(player, away, `evade-${target.index}`, { replanEvery: 20 });
        } else {
            command = navigateTo(player, aim, `target-${target.index}`, { replanEvery: 10 });
        }
        const sight = lineOfSight(player, aim);
        // MG: in range (152) with the human aim assist cone (19 degrees) in reach.
        const range = finite(runtime.spec?.mgRange, 140);
        command.fireMG = sight && offNose < 0.3 && local.distance < range;
        // Homing rockets lock within 48 degrees and 140 units; one per second at most.
        const rocketReady = runtime.frames - (runtime.lastRocketFrame ?? -1e9) >= 60;
        command.fireRocket = sight && rocketReady && offNose < 0.6 && local.distance < 130 && local.distance > 15;
        if (command.fireRocket) runtime.lastRocketFrame = runtime.frames;
        command.boost = tactic === 'aggressive' && local.distance > 80 && offNose < 0.3 && runtime.frames % 90 === 0;
        return { command, info: { target: target.index, distance: Math.round(local.distance), offNoseDeg: Math.round(offNose * 180 / Math.PI), sight } };
    };

    const pickupCommand = (player, wantedType) => {
        const em = manager();
        const pickups = (em?.pickups || em?._pickupSystem?.pickups || em?.powerupManager?.items || [])
            .filter((entry) => entry && entry.active !== false && entry.collected !== true && (entry.mesh?.position || entry.position))
            .filter((entry) => !wantedType || String(entry.type || entry.itemType) === wantedType);
        if (!pickups.length) return null;
        const positionOf = (entry) => asArray(entry.position || entry.mesh.position);
        const here = asArray(player.position);
        pickups.sort((a, b) => Math.hypot(...positionOf(a).map((v, i) => v - here[i])) - Math.hypot(...positionOf(b).map((v, i) => v - here[i])));
        const target = pickups[0];
        return { target: positionOf(target), key: `pickup-${target.id ?? target.type}`, type: target.type || target.itemType };
    };

    // The game's bot target selection also scores map units for a ship with this flag.
    const releaseMapUnitHunter = () => {
        if (runtime.mapUnitHunter) runtime.mapUnitHunter.botTargetsMapUnits = false;
        runtime.mapUnitHunter = null;
    };
    const setMapUnitHunting = (player, enabled) => {
        if (runtime.mapUnitHunter && runtime.mapUnitHunter !== player) releaseMapUnitHunter();
        player.botTargetsMapUnits = enabled;
        runtime.mapUnitHunter = enabled ? player : null;
    };

    const botCommand = (player) => {
        const em = manager();
        const inputSystem = em?._playerInputSystem;
        if (!runtime.botPolicy || runtime.botPolicy.__manager !== em) {
            runtime.botPolicy = em.botPolicyRegistry.create(runtime.spec.policy || em.botPolicyType, {
                difficulty: runtime.spec.difficulty || em.botDifficulty, recorder: null, runtimeConfig: em.runtimeConfig,
                runtimeProfiler: em.runtimeProfiler, entityRuntimeConfig: em.entityRuntimeConfig,
                bridgeEnabled: em.botBridgeEnabled, activeGameMode: em.combatModeType,
                isDesktopRuntime: em.botIsDesktopRuntime, runtimeRng: em.runtimeRng,
            });
            runtime.botPolicy.__manager = em;
        }
        const wasRamped = player.controlRampEnabled;
        let action = null;
        try {
            const context = inputSystem._resolveRuntimeContext(player, 1 / 60, em, { includeObservationContext: true });
            context.observation = inputSystem._buildBotObservation(player, runtime.botPolicy, context);
            action = runtime.botPolicy.update.length <= 3
                ? runtime.botPolicy.update(1 / 60, player, context)
                : runtime.botPolicy.update(1 / 60, player, context.arena, context.players, context.projectiles);
        } finally {
            player.controlRampEnabled = wasRamped;
        }
        return { action: action || {} };
    };

    // ---- semantic command -> raw device input ----------------------------------------------
    const neutral = () => ({
        pitchUp: false, pitchDown: false, yawLeft: false, yawRight: false, rollLeft: false, rollRight: false,
        boost: false, boostPressed: false, slowMo: false, slowMoPressed: false, cameraSwitch: false,
        useItem: false, shootRocket: false, shootMG: false, nextItem: false, dropItem: false, shootItem: false,
    });
    const toRaw = (player, command) => {
        const raw = neutral();
        // A real player compensates the own invert settings; the pilot does the same.
        const pitchSign = (player.invertPitchBase ? -1 : 1) * (player.invertControls ? -1 : 1);
        const yawSign = player.invertControls ? -1 : 1;
        raw.pitchAxis = clamp(finite(command.climb) * pitchSign, -1, 1);
        raw.yawAxis = clamp(-finite(command.turn) * yawSign, -1, 1);
        raw.rollAxis = clamp(finite(command.roll), -1, 1);
        raw.shootMG = command.fireMG === true;
        raw.shootRocket = command.fireRocket === true;
        raw.boostPressed = command.boost === true;
        raw.boost = command.boost === true;
        raw.useItem = command.useItem === true;
        raw.nextItem = command.nextItem === true;
        if (raw.shootMG) runtime.counters.mgFrames += 1;
        if (raw.shootRocket) runtime.counters.rockets += 1;
        if (raw.boostPressed) runtime.counters.boosts += 1;
        if (raw.useItem) runtime.counters.items += 1;
        return raw;
    };
    const fromBotAction = (player, action) => {
        const raw = neutral();
        const pitchSign = (player.invertPitchBase ? -1 : 1) * (player.invertControls ? -1 : 1);
        const yawSign = player.invertControls ? -1 : 1;
        const axis = (value, positive, negative) => (Number.isFinite(value) ? value : (positive ? 1 : 0) - (negative ? 1 : 0));
        raw.pitchAxis = clamp(axis(action.pitchAxis, action.pitchUp, action.pitchDown) * pitchSign, -1, 1);
        raw.yawAxis = clamp(axis(action.yawAxis, action.yawLeft, action.yawRight) * yawSign, -1, 1);
        raw.rollAxis = clamp(axis(action.rollAxis, action.rollLeft, action.rollRight), -1, 1);
        raw.shootMG = action.shootMG === true;
        raw.shootRocket = action.shootRocket === true;
        raw.boostPressed = action.boost === true && !runtime.lastRaw?.boost;
        raw.boost = action.boost === true;
        raw.useItem = Number.isInteger(action.useItem) && action.useItem >= 0;
        raw.nextItem = action.nextItem === true;
        return raw;
    };

    const finish = (status, reason) => {
        runtime.status = status;
        runtime.reason = reason;
        note('finish', { status, reason });
    };

    // ---- per simulation step ----------------------------------------------------------------
    const tick = () => {
        const spec = runtime.spec;
        runtime.deviceInputs.clear();
        if (!spec || runtime.status !== 'active') return;
        const g = game();
        if (g?.state !== 'PLAYING') return;
        runtime.frames += 1;
        const player = findPlayer(runtime.playerIndex);
        const device = localDeviceIndex(runtime.playerIndex);
        if (!player) { finish('failed', `player ${runtime.playerIndex} not in match`); return; }
        if (player.alive === false) { runtime.deviceInputs.set(device, neutral()); return; }
        runtime.counters.frames += 1;
        let command = { turn: 0, climb: 0 };
        let raw = null;
        switch (spec.mode) {
            case 'maneuver': {
                command = { ...spec.input };
                // Button presses fire on the first frame only, like a key tap.
                if (runtime.frames - runtime.startedFrame > 1) { command.boost = false; command.fireRocket = false; command.useItem = false; command.nextItem = false; }
                if (runtime.frames - runtime.startedFrame >= spec.frames) finish('done', 'maneuver held for its duration');
                break;
            }
            case 'waypoints': {
                const points = spec.points || [];
                const index = runtime.waypointIndex || 0;
                if (index >= points.length) { finish('done', 'all waypoints reached'); break; }
                const point = points[index];
                const here = asArray(player.position);
                if (Math.hypot(point[0] - here[0], point[1] - here[1], point[2] - here[2]) <= finite(spec.arriveRadius, 8)) {
                    runtime.waypointIndex = index + 1;
                    note('waypoint', { index });
                    break;
                }
                command = navigateTo(player, point, `wp-${index}`);
                break;
            }
            case 'parcours': {
                const goal = parcoursGoal(player);
                if (goal.error) { finish('failed', goal.error); break; }
                if (goal.done) { finish('done', 'parcours completed'); break; }
                if (runtime.lastCheckpointKey !== goal.key) {
                    note('checkpoint-target', { id: goal.key, passed: goal.progress.passedCheckpointIds?.length ?? null });
                    runtime.lastCheckpointKey = goal.key;
                }
                command = navigateTo(player, goal.target, goal.key, { avoid: goal.avoid });
                break;
            }
            case 'pursue':
            case 'combat': {
                const result = combatCommand(player, spec.mode === 'pursue' ? 'pursue' : (spec.tactic || 'balanced'), spec.target);
                command = result.command;
                runtime.combatInfo = result.info;
                break;
            }
            case 'pickup': {
                const goal = pickupCommand(player, spec.type);
                if (!goal) { finish('done', spec.type ? `no ${spec.type} pickup left` : 'no pickup left'); break; }
                command = navigateTo(player, goal.target, goal.key);
                break;
            }
            case 'bot': {
                setMapUnitHunting(player, spec.huntMapUnits === true);
                raw = fromBotAction(player, botCommand(player).action);
                break;
            }
            default:
                finish('failed', `unknown pilot mode ${spec.mode}`);
        }
        if (!raw) raw = toRaw(player, command);
        runtime.lastCommand = command;
        runtime.lastRaw = raw;
        if (runtime.frames % 10 === 0) {
            const nav = runtime.nav;
            runtime.trace.push({
                f: runtime.frames, pos: asArray(player.position).map(Math.round), spd: round(finite(player.speed), 1),
                hp: round(finite(player.hp), 0), tgt: nav.targetKey, aim: nav.path?.[nav.pathIndex]?.map(Math.round) || null,
                turn: round(finite(command.turn)), climb: round(finite(command.climb)), av: command.avoiding === true,
                wall: Number.isFinite(runtime.lastAhead) ? Math.round(runtime.lastAhead) : null,
            });
            if (runtime.trace.length > 2400) runtime.trace.shift();
        }
        runtime.deviceInputs.set(device, raw);
    };

    const api = {
        version,
        tick,
        configure(spec) {
            releaseMapUnitHunter();
            runtime.spec = spec && spec.mode !== 'off' ? spec : null;
            runtime.playerIndex = Number.isInteger(spec?.player) ? spec.player : 0;
            runtime.status = runtime.spec ? 'active' : 'idle';
            runtime.reason = null;
            runtime.startedFrame = runtime.frames;
            runtime.waypointIndex = 0;
            runtime.botPolicy = null;
            runtime.nav = { path: null, pathIndex: 0, target: null, targetKey: null, plannedFrame: -1, blockedFrames: 0, search: null };
            runtime.deviceInputs.clear();
            runtime.trace = [];
            runtime.mouthChoice = new Map();
            runtime.passageExit = null;
            note('configure', { mode: spec?.mode || 'off', player: runtime.playerIndex });
            return api.describe();
        },
        /** Changes goal details (target, tactic, branch, points) without restarting the run. */
        update(changes) {
            if (!runtime.spec) return api.describe();
            runtime.spec = { ...runtime.spec, ...changes };
            runtime.nav.targetKey = null;
            note('update', { keys: Object.keys(changes || {}) });
            return api.describe();
        },
        stop(reason = 'stopped') {
            if (runtime.status === 'active') finish('stopped', reason);
            releaseMapUnitHunter();
            runtime.spec = null;
            runtime.deviceInputs.clear();
            return api.describe();
        },
        /** Flight trace (every 10th step) since a pilot frame, for diagnosis. */
        traceSince(frame = 0) {
            return runtime.trace.filter((entry) => entry.f > frame);
        },
        inputFor(device) {
            return runtime.deviceInputs.get(device) || null;
        },
        describe() {
            return {
                version, status: runtime.status, reason: runtime.reason, mode: runtime.spec?.mode || 'off',
                player: runtime.playerIndex, framesActive: runtime.frames - runtime.startedFrame,
                counters: { ...runtime.counters }, lastCommand: runtime.lastCommand && {
                    turn: round(finite(runtime.lastCommand.turn)), climb: round(finite(runtime.lastCommand.climb)),
                    avoiding: runtime.lastCommand.avoiding === true,
                },
                lastInput: runtime.lastRaw && {
                    pitchAxis: round(finite(runtime.lastRaw.pitchAxis)), yawAxis: round(finite(runtime.lastRaw.yawAxis)),
                    shootMG: runtime.lastRaw.shootMG, boostPressed: runtime.lastRaw.boostPressed,
                },
                combat: runtime.spec?.mode === 'combat' || runtime.spec?.mode === 'pursue' ? runtime.combatInfo || null : undefined,
                decisions: runtime.decisions.slice(-12),
            };
        },
    };
    window.__playtestPilotRuntime = api;
    return api.describe();
}
