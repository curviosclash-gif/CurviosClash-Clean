import * as THREE from 'three';

import {
    DISTANCE_EPSILON,
    RAY_EPSILON,
    RAY_X,
    RAY_Y,
    RAY_Z,
    buildStaticMeshBvh,
    setCollisionNormal,
    sphereIntersectsBvhCollider,
} from './MeshColliderBvh.js';

const SCALE_EPSILON = 1e-6;

// Scratch state for dynamic colliders. Queries never nest, so module level is safe.
const DYNAMIC_QUERY_POINT = { x: 0, y: 0, z: 0 };
const DYNAMIC_QUERY_NORMAL = new THREE.Vector3();
const DYNAMIC_INVERSE_MATRIX = new THREE.Matrix4();

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

function resolveColliderGeometry(mesh) {
    const geometry = mesh?.geometry;
    const position = geometry?.getAttribute?.('position');
    if (!position || position.itemSize < 3 || position.count < 3 || mesh?.isSkinnedMesh) return null;

    const index = geometry.getIndex?.() || null;
    const elementCount = index ? index.count : position.count;
    const drawRange = resolveDrawRange(geometry, elementCount);
    if (drawRange.count < 3) return null;
    return { position, index, drawRange };
}

// Extracts the draw range as a flat triangle soup. Passing matrixElements bakes the
// vertices into world space; passing null keeps them in the mesh's own local space.
function extractTriangles(position, index, drawRange, matrixElements) {
    const triangles = new Float32Array(drawRange.count * 3);
    const end = drawRange.start + drawRange.count;
    for (let offset = drawRange.start; offset < end; offset++) {
        const vertexIndex = index ? index.getX(offset) : offset;
        const x = position.getX(vertexIndex);
        const y = position.getY(vertexIndex);
        const z = position.getZ(vertexIndex);
        const targetOffset = (offset - drawRange.start) * 3;
        if (matrixElements) {
            triangles[targetOffset] = matrixElements[0] * x + matrixElements[4] * y + matrixElements[8] * z + matrixElements[12];
            triangles[targetOffset + 1] = matrixElements[1] * x + matrixElements[5] * y + matrixElements[9] * z + matrixElements[13];
            triangles[targetOffset + 2] = matrixElements[2] * x + matrixElements[6] * y + matrixElements[10] * z + matrixElements[14];
        } else {
            triangles[targetOffset] = x;
            triangles[targetOffset + 1] = y;
            triangles[targetOffset + 2] = z;
        }
    }
    return triangles;
}

export function createStaticMeshCollider(mesh) {
    const resolved = resolveColliderGeometry(mesh);
    if (!resolved) return null;
    const { position, index, drawRange } = resolved;

    const matrixElements = new Float64Array(mesh.matrixWorld.elements);
    const worldTriangles = extractTriangles(position, index, drawRange, matrixElements);

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

/**
 * Collider for a mesh that an animation clip moves at runtime.
 *
 * The triangles and the BVH stay in the mesh's local space so they remain valid for
 * every animation frame — only the world matrix changes. Queries are transformed into
 * local space instead, which costs one point transform rather than a BVH rebuild.
 * Skinned meshes are rejected: their geometry deforms, so a rigid local hull would lie.
 */
export function createDynamicMeshCollider(mesh) {
    const resolved = resolveColliderGeometry(mesh);
    if (!resolved) return null;
    const { position, index, drawRange } = resolved;

    const localTriangles = extractTriangles(position, index, drawRange, null);
    const collider = {
        position,
        index,
        start: drawRange.start,
        count: drawRange.count,
        matrixElements: new Float64Array(16),
        worldTriangles: localTriangles,
        bvh: buildStaticMeshBvh(localTriangles),
        queryStack: [],
        closestResult: new Float64Array(7),
        dynamic: true,
        mesh,
        localBounds: new THREE.Box3().setFromArray(localTriangles),
        inverseElements: new Float64Array(16),
        localRadiusScale: 0,
    };
    refreshDynamicMeshCollider(collider);
    return collider;
}

/**
 * Re-reads the mesh's current world matrix. Call once per frame after the animation
 * mixer advanced and the world matrices were updated. When outBox is given it receives
 * the collider's current world AABB for broadphase use.
 */
export function refreshDynamicMeshCollider(collider, outBox = null) {
    const matrix = collider?.dynamic ? collider.mesh?.matrixWorld : null;
    if (!matrix) return false;

    const elements = matrix.elements;
    collider.matrixElements.set(elements);
    DYNAMIC_INVERSE_MATRIX.copy(matrix).invert();
    collider.inverseElements.set(DYNAMIC_INVERSE_MATRIX.elements);

    // A world-space probe radius maps to different local radii per axis under non-uniform
    // scale. The smallest axis yields the largest local radius, which over-approximates the
    // collider rather than letting entities slip through it.
    const scaleX = Math.hypot(elements[0], elements[1], elements[2]);
    const scaleY = Math.hypot(elements[4], elements[5], elements[6]);
    const scaleZ = Math.hypot(elements[8], elements[9], elements[10]);
    const minScale = Math.min(scaleX, scaleY, scaleZ);
    collider.localRadiusScale = minScale > SCALE_EPSILON ? 1 / minScale : 0;

    if (outBox) outBox.copy(collider.localBounds).applyMatrix4(matrix);
    return collider.localRadiusScale > 0;
}

// Rotates a local-space surface normal back into world space via the inverse transpose,
// which stays correct under non-uniform scale.
function transformNormalToWorld(inverseElements, localNormal, outNormal) {
    const x = localNormal.x;
    const y = localNormal.y;
    const z = localNormal.z;
    outNormal.set(
        inverseElements[0] * x + inverseElements[1] * y + inverseElements[2] * z,
        inverseElements[4] * x + inverseElements[5] * y + inverseElements[6] * z,
        inverseElements[8] * x + inverseElements[9] * y + inverseElements[10] * z,
    );
    if (outNormal.lengthSq() <= DISTANCE_EPSILON) {
        outNormal.set(0, 1, 0);
        return;
    }
    outNormal.normalize();
}

function vertexIndexAt(collider, offset) {
    return collider.index ? collider.index.getX(offset) : offset;
}

export function sphereIntersectsStaticMeshCollider(collider, point, radius = 0, outNormal = null) {
    if (!collider?.position || !point) return false;
    if (!collider.dynamic) return sphereIntersectsColliderSpace(collider, point, radius, outNormal);

    // Dynamic colliders store their triangles in local space, so move the probe there.
    const radiusScale = collider.localRadiusScale;
    if (!(radiusScale > 0)) return false;
    const inverse = collider.inverseElements;
    const localPoint = DYNAMIC_QUERY_POINT;
    localPoint.x = inverse[0] * point.x + inverse[4] * point.y + inverse[8] * point.z + inverse[12];
    localPoint.y = inverse[1] * point.x + inverse[5] * point.y + inverse[9] * point.z + inverse[13];
    localPoint.z = inverse[2] * point.x + inverse[6] * point.y + inverse[10] * point.z + inverse[14];

    const localNormal = outNormal ? DYNAMIC_QUERY_NORMAL : null;
    const localRadius = Math.max(0, Number(radius) || 0) * radiusScale;
    if (!sphereIntersectsColliderSpace(collider, localPoint, localRadius, localNormal)) return false;
    if (outNormal) transformNormalToWorld(inverse, localNormal, outNormal);
    return true;
}

function sphereIntersectsColliderSpace(collider, point, radius = 0, outNormal = null) {
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
