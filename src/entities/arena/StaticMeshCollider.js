const DISTANCE_EPSILON = 1e-8;
const RAY_EPSILON = 1e-7;
const RAY_X = 1;
const RAY_Y = 0.3713906763541037;
const RAY_Z = 0.529112894374401;
const BVH_MIN_TRIANGLES = 24;
const BVH_LEAF_TRIANGLES = 12;

function resolveDrawRange(geometry, elementCount) {
    const start = Math.max(0, Math.trunc(Number(geometry?.drawRange?.start) || 0));
    const requestedCount = Number(geometry?.drawRange?.count);
    const count = Number.isFinite(requestedCount)
        ? Math.max(0, Math.min(elementCount - start, Math.trunc(requestedCount)))
        : Math.max(0, elementCount - start);
    return {
        start,
        count: count - (count % 3),
    };
}

function buildStaticMeshBvh(worldTriangles) {
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

export function createStaticMeshCollider(mesh) {
    const geometry = mesh?.geometry;
    const position = geometry?.getAttribute?.('position');
    if (!position || position.itemSize < 3 || position.count < 3 || mesh?.isSkinnedMesh) return null;

    const index = geometry.getIndex?.() || null;
    const elementCount = index ? index.count : position.count;
    const drawRange = resolveDrawRange(geometry, elementCount);
    if (drawRange.count < 3) return null;

    const matrixElements = new Float64Array(mesh.matrixWorld.elements);
    const worldTriangles = new Float32Array(drawRange.count * 3);
    for (let offset = drawRange.start; offset < drawRange.start + drawRange.count; offset++) {
        const vertexIndex = index ? index.getX(offset) : offset;
        const x = position.getX(vertexIndex);
        const y = position.getY(vertexIndex);
        const z = position.getZ(vertexIndex);
        const targetOffset = (offset - drawRange.start) * 3;
        worldTriangles[targetOffset] = matrixElements[0] * x + matrixElements[4] * y + matrixElements[8] * z + matrixElements[12];
        worldTriangles[targetOffset + 1] = matrixElements[1] * x + matrixElements[5] * y + matrixElements[9] * z + matrixElements[13];
        worldTriangles[targetOffset + 2] = matrixElements[2] * x + matrixElements[6] * y + matrixElements[10] * z + matrixElements[14];
    }

    return {
        position,
        index,
        start: drawRange.start,
        count: drawRange.count,
        matrixElements,
        worldTriangles,
        bvh: buildStaticMeshBvh(worldTriangles),
        queryStack: [],
        closestResult: new Float64Array(7),
    };
}

function vertexIndexAt(collider, offset) {
    return collider.index ? collider.index.getX(offset) : offset;
}

function setCollisionNormal(outNormal, point, closestX, closestY, closestZ, inside, fallbackX, fallbackY, fallbackZ) {
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

function sphereIntersectsBvhCollider(collider, point, radius, outNormal) {
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

export function sphereIntersectsStaticMeshCollider(collider, point, radius = 0, outNormal = null) {
    if (!collider?.position || !point) return false;

    const position = collider.position;
    const matrix = collider.matrixElements;
    const worldTriangles = collider.worldTriangles;
    const sphereRadius = Math.max(0, Number(radius) || 0);
    if (collider.bvh) {
        return sphereIntersectsBvhCollider(collider, point, sphereRadius, outNormal);
    }
    const radiusSq = sphereRadius * sphereRadius;
    let surfaceHit = false;
    let rayIntersections = 0;
    let closestDistanceSq = Infinity;
    let closestX = point.x;
    let closestY = point.y;
    let closestZ = point.z;
    let closestNormalX = 0;
    let closestNormalY = 1;
    let closestNormalZ = 0;

    const end = collider.start + collider.count;
    for (let offset = collider.start; offset < end; offset += 3) {
        let ax; let ay; let az;
        let bx; let by; let bz;
        let cx; let cy; let cz;
        if (worldTriangles) {
            const triangleOffset = (offset - collider.start) * 3;
            ax = worldTriangles[triangleOffset];
            ay = worldTriangles[triangleOffset + 1];
            az = worldTriangles[triangleOffset + 2];
            bx = worldTriangles[triangleOffset + 3];
            by = worldTriangles[triangleOffset + 4];
            bz = worldTriangles[triangleOffset + 5];
            cx = worldTriangles[triangleOffset + 6];
            cy = worldTriangles[triangleOffset + 7];
            cz = worldTriangles[triangleOffset + 8];
        } else {
            const ia = vertexIndexAt(collider, offset);
            const ib = vertexIndexAt(collider, offset + 1);
            const ic = vertexIndexAt(collider, offset + 2);
            const lax = position.getX(ia); const lay = position.getY(ia); const laz = position.getZ(ia);
            const lbx = position.getX(ib); const lby = position.getY(ib); const lbz = position.getZ(ib);
            const lcx = position.getX(ic); const lcy = position.getY(ic); const lcz = position.getZ(ic);
            ax = matrix[0] * lax + matrix[4] * lay + matrix[8] * laz + matrix[12];
            ay = matrix[1] * lax + matrix[5] * lay + matrix[9] * laz + matrix[13];
            az = matrix[2] * lax + matrix[6] * lay + matrix[10] * laz + matrix[14];
            bx = matrix[0] * lbx + matrix[4] * lby + matrix[8] * lbz + matrix[12];
            by = matrix[1] * lbx + matrix[5] * lby + matrix[9] * lbz + matrix[13];
            bz = matrix[2] * lbx + matrix[6] * lby + matrix[10] * lbz + matrix[14];
            cx = matrix[0] * lcx + matrix[4] * lcy + matrix[8] * lcz + matrix[12];
            cy = matrix[1] * lcx + matrix[5] * lcy + matrix[9] * lcz + matrix[13];
            cz = matrix[2] * lcx + matrix[6] * lcy + matrix[10] * lcz + matrix[14];
        }

        const abx = bx - ax; const aby = by - ay; const abz = bz - az;
        const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
        const triangleNormalX = aby * acz - abz * acy;
        const triangleNormalY = abz * acx - abx * acz;
        const triangleNormalZ = abx * acy - aby * acx;
        const triangleAreaSq = triangleNormalX * triangleNormalX
            + triangleNormalY * triangleNormalY
            + triangleNormalZ * triangleNormalZ;
        if (triangleAreaSq <= DISTANCE_EPSILON) continue;

        const apx = point.x - ax; const apy = point.y - ay; const apz = point.z - az;
        const d1 = abx * apx + aby * apy + abz * apz;
        const d2 = acx * apx + acy * apy + acz * apz;
        let tx;
        let ty;
        let tz;

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

        const dx = point.x - tx;
        const dy = point.y - ty;
        const dz = point.z - tz;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq < closestDistanceSq) {
            closestDistanceSq = distanceSq;
            closestX = tx; closestY = ty; closestZ = tz;
            closestNormalX = triangleNormalX;
            closestNormalY = triangleNormalY;
            closestNormalZ = triangleNormalZ;
        }
        if (distanceSq <= radiusSq + DISTANCE_EPSILON) {
            surfaceHit = true;
            if (!outNormal) return true;
        }

        const hx = RAY_Y * acz - RAY_Z * acy;
        const hy = RAY_Z * acx - RAY_X * acz;
        const hz = RAY_X * acy - RAY_Y * acx;
        const determinant = abx * hx + aby * hy + abz * hz;
        if (Math.abs(determinant) <= RAY_EPSILON) continue;
        const inverseDeterminant = 1 / determinant;
        const u = (apx * hx + apy * hy + apz * hz) * inverseDeterminant;
        if (u < 0 || u > 1) continue;
        const qx = apy * abz - apz * aby;
        const qy = apz * abx - apx * abz;
        const qz = apx * aby - apy * abx;
        const v = (RAY_X * qx + RAY_Y * qy + RAY_Z * qz) * inverseDeterminant;
        if (v < 0 || u + v > 1) continue;
        const distance = (acx * qx + acy * qy + acz * qz) * inverseDeterminant;
        if (distance > RAY_EPSILON) rayIntersections += 1;
    }

    const inside = (rayIntersections & 1) === 1;
    if (!surfaceHit && !inside) return false;
    setCollisionNormal(
        outNormal,
        point,
        closestX,
        closestY,
        closestZ,
        inside,
        closestNormalX,
        closestNormalY,
        closestNormalZ,
    );
    return true;
}
