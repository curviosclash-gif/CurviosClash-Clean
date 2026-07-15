const DISTANCE_EPSILON = 1e-8;
const RAY_EPSILON = 1e-7;
const RAY_X = 1;
const RAY_Y = 0.3713906763541037;
const RAY_Z = 0.529112894374401;

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

export function createStaticMeshCollider(mesh) {
    const geometry = mesh?.geometry;
    const position = geometry?.getAttribute?.('position');
    if (!position || position.itemSize < 3 || position.count < 3 || mesh?.isSkinnedMesh) return null;

    const index = geometry.getIndex?.() || null;
    const elementCount = index ? index.count : position.count;
    const drawRange = resolveDrawRange(geometry, elementCount);
    if (drawRange.count < 3) return null;

    return {
        position,
        index,
        start: drawRange.start,
        count: drawRange.count,
        matrixElements: new Float64Array(mesh.matrixWorld.elements),
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

export function sphereIntersectsStaticMeshCollider(collider, point, radius = 0, outNormal = null) {
    if (!collider?.position || !point) return false;

    const position = collider.position;
    const matrix = collider.matrixElements;
    const sphereRadius = Math.max(0, Number(radius) || 0);
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
        const ia = vertexIndexAt(collider, offset);
        const ib = vertexIndexAt(collider, offset + 1);
        const ic = vertexIndexAt(collider, offset + 2);

        const lax = position.getX(ia); const lay = position.getY(ia); const laz = position.getZ(ia);
        const lbx = position.getX(ib); const lby = position.getY(ib); const lbz = position.getZ(ib);
        const lcx = position.getX(ic); const lcy = position.getY(ic); const lcz = position.getZ(ic);

        const ax = matrix[0] * lax + matrix[4] * lay + matrix[8] * laz + matrix[12];
        const ay = matrix[1] * lax + matrix[5] * lay + matrix[9] * laz + matrix[13];
        const az = matrix[2] * lax + matrix[6] * lay + matrix[10] * laz + matrix[14];
        const bx = matrix[0] * lbx + matrix[4] * lby + matrix[8] * lbz + matrix[12];
        const by = matrix[1] * lbx + matrix[5] * lby + matrix[9] * lbz + matrix[13];
        const bz = matrix[2] * lbx + matrix[6] * lby + matrix[10] * lbz + matrix[14];
        const cx = matrix[0] * lcx + matrix[4] * lcy + matrix[8] * lcz + matrix[12];
        const cy = matrix[1] * lcx + matrix[5] * lcy + matrix[9] * lcz + matrix[13];
        const cz = matrix[2] * lcx + matrix[6] * lcy + matrix[10] * lcz + matrix[14];

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
