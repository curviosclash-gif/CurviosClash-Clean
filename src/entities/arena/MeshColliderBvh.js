// Shared triangle math and the BVH used by both static and dynamic mesh colliders.
// Extracted from StaticMeshCollider.js to keep either module within the size budget.

export const DISTANCE_EPSILON = 1e-8;
export const RAY_EPSILON = 1e-7;
export const RAY_X = 1;
export const RAY_Y = 0.3713906763541037;
export const RAY_Z = 0.529112894374401;
const BVH_MIN_TRIANGLES = 24;
const BVH_LEAF_TRIANGLES = 12;

export function buildStaticMeshBvh(worldTriangles) {
    const triangleCount = Math.trunc(worldTriangles.length / 9);
    if (triangleCount < BVH_MIN_TRIANGLES) return null;
    const triangleOrder = Array.from({ length: triangleCount }, (_value, index) => index);
    const triangleCenters = new Float32Array(triangleCount * 3);
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
        const offset = triangleIndex * 9;
        triangleCenters[triangleIndex * 3] = (
            worldTriangles[offset] + worldTriangles[offset + 3] + worldTriangles[offset + 6]
        ) / 3;
        triangleCenters[triangleIndex * 3 + 1] = (
            worldTriangles[offset + 1] + worldTriangles[offset + 4] + worldTriangles[offset + 7]
        ) / 3;
        triangleCenters[triangleIndex * 3 + 2] = (
            worldTriangles[offset + 2] + worldTriangles[offset + 5] + worldTriangles[offset + 8]
        ) / 3;
    }

    const nodes = [];
    const buildNode = (start, end) => {
        let minX = Infinity; let minY = Infinity; let minZ = Infinity;
        let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
        let centerMinX = Infinity; let centerMinY = Infinity; let centerMinZ = Infinity;
        let centerMaxX = -Infinity; let centerMaxY = -Infinity; let centerMaxZ = -Infinity;
        for (let orderIndex = start; orderIndex < end; orderIndex++) {
            const triangleIndex = triangleOrder[orderIndex];
            const offset = triangleIndex * 9;
            for (let vertex = 0; vertex < 3; vertex++) {
                const vertexOffset = offset + vertex * 3;
                minX = Math.min(minX, worldTriangles[vertexOffset]);
                minY = Math.min(minY, worldTriangles[vertexOffset + 1]);
                minZ = Math.min(minZ, worldTriangles[vertexOffset + 2]);
                maxX = Math.max(maxX, worldTriangles[vertexOffset]);
                maxY = Math.max(maxY, worldTriangles[vertexOffset + 1]);
                maxZ = Math.max(maxZ, worldTriangles[vertexOffset + 2]);
            }
            const centerOffset = triangleIndex * 3;
            centerMinX = Math.min(centerMinX, triangleCenters[centerOffset]);
            centerMinY = Math.min(centerMinY, triangleCenters[centerOffset + 1]);
            centerMinZ = Math.min(centerMinZ, triangleCenters[centerOffset + 2]);
            centerMaxX = Math.max(centerMaxX, triangleCenters[centerOffset]);
            centerMaxY = Math.max(centerMaxY, triangleCenters[centerOffset + 1]);
            centerMaxZ = Math.max(centerMaxZ, triangleCenters[centerOffset + 2]);
        }

        const nodeIndex = nodes.length;
        const node = { minX, minY, minZ, maxX, maxY, maxZ, start, count: end - start, left: -1, right: -1 };
        nodes.push(node);
        if (node.count <= BVH_LEAF_TRIANGLES) return nodeIndex;

        const spanX = centerMaxX - centerMinX;
        const spanY = centerMaxY - centerMinY;
        const spanZ = centerMaxZ - centerMinZ;
        const axis = spanY > spanX && spanY >= spanZ ? 1 : (spanZ > spanX ? 2 : 0);
        const sorted = triangleOrder.slice(start, end).sort((left, right) => (
            triangleCenters[left * 3 + axis] - triangleCenters[right * 3 + axis]
        ));
        for (let index = 0; index < sorted.length; index++) {
            triangleOrder[start + index] = sorted[index];
        }
        const middle = start + Math.floor((end - start) / 2);
        node.left = buildNode(start, middle);
        node.right = buildNode(middle, end);
        node.count = 0;
        return nodeIndex;
    };

    buildNode(0, triangleCount);
    return {
        nodes,
        triangleOrder: Uint32Array.from(triangleOrder),
    };
}

export function setCollisionNormal(outNormal, point, closestX, closestY, closestZ, inside, fallbackX, fallbackY, fallbackZ) {
    if (!outNormal) return;
    const direction = inside ? -1 : 1;
    let nx = (point.x - closestX) * direction;
    let ny = (point.y - closestY) * direction;
    let nz = (point.z - closestZ) * direction;
    let lengthSq = nx * nx + ny * ny + nz * nz;

    if (lengthSq <= DISTANCE_EPSILON) {
        nx = fallbackX;
        ny = fallbackY;
        nz = fallbackZ;
        lengthSq = nx * nx + ny * ny + nz * nz;
    }

    if (lengthSq <= DISTANCE_EPSILON) {
        outNormal.set(0, 1, 0);
        return;
    }
    const inverseLength = 1 / Math.sqrt(lengthSq);
    outNormal.set(nx * inverseLength, ny * inverseLength, nz * inverseLength);
}

function pointAabbDistanceSq(point, node) {
    const dx = point.x < node.minX ? node.minX - point.x : (point.x > node.maxX ? point.x - node.maxX : 0);
    const dy = point.y < node.minY ? node.minY - point.y : (point.y > node.maxY ? point.y - node.maxY : 0);
    const dz = point.z < node.minZ ? node.minZ - point.z : (point.z > node.maxZ ? point.z - node.maxZ : 0);
    return dx * dx + dy * dy + dz * dz;
}

function rayIntersectsAabb(point, node) {
    let minDistance = (node.minX - point.x) / RAY_X;
    let maxDistance = (node.maxX - point.x) / RAY_X;
    minDistance = Math.max(minDistance, (node.minY - point.y) / RAY_Y);
    maxDistance = Math.min(maxDistance, (node.maxY - point.y) / RAY_Y);
    if (maxDistance < minDistance) return false;
    minDistance = Math.max(minDistance, (node.minZ - point.z) / RAY_Z);
    maxDistance = Math.min(maxDistance, (node.maxZ - point.z) / RAY_Z);
    if (maxDistance < minDistance) return false;
    return maxDistance > RAY_EPSILON;
}

function updateClosestTriangle(worldTriangles, triangleIndex, point, closestResult) {
    const offset = triangleIndex * 9;
    const ax = worldTriangles[offset]; const ay = worldTriangles[offset + 1]; const az = worldTriangles[offset + 2];
    const bx = worldTriangles[offset + 3]; const by = worldTriangles[offset + 4]; const bz = worldTriangles[offset + 5];
    const cx = worldTriangles[offset + 6]; const cy = worldTriangles[offset + 7]; const cz = worldTriangles[offset + 8];
    const abx = bx - ax; const aby = by - ay; const abz = bz - az;
    const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
    const normalX = aby * acz - abz * acy;
    const normalY = abz * acx - abx * acz;
    const normalZ = abx * acy - aby * acx;
    if (normalX * normalX + normalY * normalY + normalZ * normalZ <= DISTANCE_EPSILON) return false;

    const apx = point.x - ax; const apy = point.y - ay; const apz = point.z - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let tx; let ty; let tz;
    if (d1 <= 0 && d2 <= 0) {
        tx = ax; ty = ay; tz = az;
    } else {
        const bpx = point.x - bx; const bpy = point.y - by; const bpz = point.z - bz;
        const d3 = abx * bpx + aby * bpy + abz * bpz;
        const d4 = acx * bpx + acy * bpy + acz * bpz;
        if (d3 >= 0 && d4 <= d3) {
            tx = bx; ty = by; tz = bz;
        } else {
            const vc = d1 * d4 - d3 * d2;
            if (vc <= 0 && d1 >= 0 && d3 <= 0) {
                const v = d1 / (d1 - d3);
                tx = ax + v * abx; ty = ay + v * aby; tz = az + v * abz;
            } else {
                const cpx = point.x - cx; const cpy = point.y - cy; const cpz = point.z - cz;
                const d5 = abx * cpx + aby * cpy + abz * cpz;
                const d6 = acx * cpx + acy * cpy + acz * cpz;
                if (d6 >= 0 && d5 <= d6) {
                    tx = cx; ty = cy; tz = cz;
                } else {
                    const vb = d5 * d2 - d1 * d6;
                    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
                        const w = d2 / (d2 - d6);
                        tx = ax + w * acx; ty = ay + w * acy; tz = az + w * acz;
                    } else {
                        const va = d3 * d6 - d5 * d4;
                        if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
                            const edgeCx = cx - bx; const edgeCy = cy - by; const edgeCz = cz - bz;
                            const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                            tx = bx + w * edgeCx; ty = by + w * edgeCy; tz = bz + w * edgeCz;
                        } else {
                            const inverseDenominator = 1 / (va + vb + vc);
                            const v = vb * inverseDenominator;
                            const w = vc * inverseDenominator;
                            tx = ax + abx * v + acx * w;
                            ty = ay + aby * v + acy * w;
                            tz = az + abz * v + acz * w;
                        }
                    }
                }
            }
        }
    }
    const dx = point.x - tx; const dy = point.y - ty; const dz = point.z - tz;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > closestResult[0]) return false;
    closestResult[0] = distanceSq;
    closestResult[1] = tx; closestResult[2] = ty; closestResult[3] = tz;
    closestResult[4] = normalX; closestResult[5] = normalY; closestResult[6] = normalZ;
    return true;
}

function rayIntersectsTriangle(worldTriangles, triangleIndex, point) {
    const offset = triangleIndex * 9;
    const ax = worldTriangles[offset]; const ay = worldTriangles[offset + 1]; const az = worldTriangles[offset + 2];
    const abx = worldTriangles[offset + 3] - ax;
    const aby = worldTriangles[offset + 4] - ay;
    const abz = worldTriangles[offset + 5] - az;
    const acx = worldTriangles[offset + 6] - ax;
    const acy = worldTriangles[offset + 7] - ay;
    const acz = worldTriangles[offset + 8] - az;
    const hx = RAY_Y * acz - RAY_Z * acy;
    const hy = RAY_Z * acx - RAY_X * acz;
    const hz = RAY_X * acy - RAY_Y * acx;
    const determinant = abx * hx + aby * hy + abz * hz;
    if (Math.abs(determinant) <= RAY_EPSILON) return false;
    const inverseDeterminant = 1 / determinant;
    const apx = point.x - ax; const apy = point.y - ay; const apz = point.z - az;
    const u = (apx * hx + apy * hy + apz * hz) * inverseDeterminant;
    if (u < 0 || u > 1) return false;
    const qx = apy * abz - apz * aby;
    const qy = apz * abx - apx * abz;
    const qz = apx * aby - apy * abx;
    const v = (RAY_X * qx + RAY_Y * qy + RAY_Z * qz) * inverseDeterminant;
    if (v < 0 || u + v > 1) return false;
    return (acx * qx + acy * qy + acz * qz) * inverseDeterminant > RAY_EPSILON;
}

function findClosestBvhTriangle(collider, point, maximumDistanceSq, stopOnFirst = false) {
    const { nodes, triangleOrder } = collider.bvh;
    const stack = collider.queryStack;
    const closestResult = collider.closestResult;
    closestResult[0] = maximumDistanceSq;
    stack.length = 0;
    stack.push(0);
    let found = false;
    while (stack.length > 0) {
        const node = nodes[stack.pop()];
        if (pointAabbDistanceSq(point, node) > closestResult[0] + DISTANCE_EPSILON) continue;
        if (node.count > 0) {
            const end = node.start + node.count;
            for (let orderIndex = node.start; orderIndex < end; orderIndex++) {
                if (updateClosestTriangle(collider.worldTriangles, triangleOrder[orderIndex], point, closestResult)) {
                    found = true;
                    if (stopOnFirst) return true;
                }
            }
            continue;
        }
        stack.push(node.left, node.right);
    }
    return found;
}

function countBvhRayIntersections(collider, point) {
    const { nodes, triangleOrder } = collider.bvh;
    const stack = collider.queryStack;
    stack.length = 0;
    stack.push(0);
    let intersections = 0;
    while (stack.length > 0) {
        const node = nodes[stack.pop()];
        if (!rayIntersectsAabb(point, node)) continue;
        if (node.count > 0) {
            const end = node.start + node.count;
            for (let orderIndex = node.start; orderIndex < end; orderIndex++) {
                if (rayIntersectsTriangle(collider.worldTriangles, triangleOrder[orderIndex], point)) {
                    intersections += 1;
                }
            }
            continue;
        }
        stack.push(node.left, node.right);
    }
    return intersections;
}

// Nearest ray hit while a traversal runs: distance, point, normal. Ray queries never nest,
// so one module level buffer keeps the query allocation-free.
const RAY_HIT_STATE = new Float64Array(7);
const RAY_SLAB_LIMIT = 1e20;

// A zero or denormal direction component would turn the slab test into 0 * Infinity = NaN.
// Capping the reciprocal keeps the arithmetic finite and the test conservative.
function safeReciprocal(value) {
    if (value > RAY_EPSILON || value < -RAY_EPSILON) return 1 / value;
    return value < 0 ? -RAY_SLAB_LIMIT : RAY_SLAB_LIMIT;
}

function rayIntersectsNodeSlab(node, origin, inverseX, inverseY, inverseZ, maxDistance) {
    const tx1 = (node.minX - origin.x) * inverseX;
    const tx2 = (node.maxX - origin.x) * inverseX;
    let nearest = Math.min(tx1, tx2);
    let farthest = Math.max(tx1, tx2);

    const ty1 = (node.minY - origin.y) * inverseY;
    const ty2 = (node.maxY - origin.y) * inverseY;
    nearest = Math.max(nearest, Math.min(ty1, ty2));
    farthest = Math.min(farthest, Math.max(ty1, ty2));

    const tz1 = (node.minZ - origin.z) * inverseZ;
    const tz2 = (node.maxZ - origin.z) * inverseZ;
    nearest = Math.max(nearest, Math.min(tz1, tz2));
    farthest = Math.min(farthest, Math.max(tz1, tz2));

    return farthest >= Math.max(nearest, 0) && nearest <= maxDistance;
}

// Moeller-Trumbore. Keeps the nearest hit in RAY_HIT_STATE and orients the face normal back
// towards the ray, which is what a wall impact needs.
function raycastTriangle(worldTriangles, triangleIndex, origin, direction) {
    const offset = triangleIndex * 9;
    const ax = worldTriangles[offset]; const ay = worldTriangles[offset + 1]; const az = worldTriangles[offset + 2];
    const abx = worldTriangles[offset + 3] - ax;
    const aby = worldTriangles[offset + 4] - ay;
    const abz = worldTriangles[offset + 5] - az;
    const acx = worldTriangles[offset + 6] - ax;
    const acy = worldTriangles[offset + 7] - ay;
    const acz = worldTriangles[offset + 8] - az;

    const hx = direction.y * acz - direction.z * acy;
    const hy = direction.z * acx - direction.x * acz;
    const hz = direction.x * acy - direction.y * acx;
    const determinant = abx * hx + aby * hy + abz * hz;
    if (Math.abs(determinant) <= RAY_EPSILON) return false;

    const inverseDeterminant = 1 / determinant;
    const apx = origin.x - ax; const apy = origin.y - ay; const apz = origin.z - az;
    const u = (apx * hx + apy * hy + apz * hz) * inverseDeterminant;
    if (u < 0 || u > 1) return false;
    const qx = apy * abz - apz * aby;
    const qy = apz * abx - apx * abz;
    const qz = apx * aby - apy * abx;
    const v = (direction.x * qx + direction.y * qy + direction.z * qz) * inverseDeterminant;
    if (v < 0 || u + v > 1) return false;
    const distance = (acx * qx + acy * qy + acz * qz) * inverseDeterminant;
    if (distance <= RAY_EPSILON || distance >= RAY_HIT_STATE[0]) return false;

    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const lengthSq = nx * nx + ny * ny + nz * nz;
    if (lengthSq <= DISTANCE_EPSILON) return false;
    const inverseLength = 1 / Math.sqrt(lengthSq);
    nx *= inverseLength; ny *= inverseLength; nz *= inverseLength;
    if (nx * direction.x + ny * direction.y + nz * direction.z > 0) {
        nx = -nx; ny = -ny; nz = -nz;
    }

    RAY_HIT_STATE[0] = distance;
    RAY_HIT_STATE[1] = origin.x + direction.x * distance;
    RAY_HIT_STATE[2] = origin.y + direction.y * distance;
    RAY_HIT_STATE[3] = origin.z + direction.z * distance;
    RAY_HIT_STATE[4] = nx; RAY_HIT_STATE[5] = ny; RAY_HIT_STATE[6] = nz;
    return true;
}

/**
 * Nearest triangle hit along a ray, in the collider's own space. `direction` must be
 * normalized; `outHit` is a reusable { distance, x, y, z, nx, ny, nz } record. Colliders below
 * the BVH threshold are scanned linearly - they hold a handful of triangles at most.
 */
export function raycastBvhCollider(collider, origin, direction, maxDistance, outHit = null) {
    const worldTriangles = collider?.worldTriangles;
    if (!worldTriangles || !origin || !direction) return false;
    const limit = Number(maxDistance);
    if (!Number.isFinite(limit) || limit <= RAY_EPSILON) return false;

    RAY_HIT_STATE[0] = limit;
    let found = false;
    const bvh = collider.bvh;
    if (!bvh) {
        const triangleCount = Math.trunc(worldTriangles.length / 9);
        for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
            if (raycastTriangle(worldTriangles, triangleIndex, origin, direction)) found = true;
        }
    } else {
        const { nodes, triangleOrder } = bvh;
        const inverseX = safeReciprocal(direction.x);
        const inverseY = safeReciprocal(direction.y);
        const inverseZ = safeReciprocal(direction.z);
        const stack = collider.queryStack;
        stack.length = 0;
        stack.push(0);
        while (stack.length > 0) {
            const node = nodes[stack.pop()];
            if (!rayIntersectsNodeSlab(node, origin, inverseX, inverseY, inverseZ, RAY_HIT_STATE[0])) continue;
            if (node.count > 0) {
                const end = node.start + node.count;
                for (let orderIndex = node.start; orderIndex < end; orderIndex++) {
                    if (raycastTriangle(worldTriangles, triangleOrder[orderIndex], origin, direction)) found = true;
                }
                continue;
            }
            stack.push(node.left, node.right);
        }
    }

    if (!found) return false;
    if (outHit) {
        outHit.distance = RAY_HIT_STATE[0];
        outHit.x = RAY_HIT_STATE[1];
        outHit.y = RAY_HIT_STATE[2];
        outHit.z = RAY_HIT_STATE[3];
        outHit.nx = RAY_HIT_STATE[4];
        outHit.ny = RAY_HIT_STATE[5];
        outHit.nz = RAY_HIT_STATE[6];
    }
    return true;
}

export function sphereIntersectsBvhCollider(collider, point, radius, outNormal) {
    const radiusSq = radius * radius;
    const surfaceHit = findClosestBvhTriangle(
        collider,
        point,
        radiusSq + DISTANCE_EPSILON,
        !outNormal,
    );
    if (surfaceHit && !outNormal) return true;
    const inside = (countBvhRayIntersections(collider, point) & 1) === 1;
    if (!surfaceHit && !inside) return false;
    if (outNormal) {
        if (!surfaceHit) findClosestBvhTriangle(collider, point, Infinity);
        const result = collider.closestResult;
        setCollisionNormal(outNormal, point, result[1], result[2], result[3], inside, result[4], result[5], result[6]);
    }
    return true;
}
