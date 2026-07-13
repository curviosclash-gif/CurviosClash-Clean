import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBoxWithTunnel } from '../TunnelGeometry.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

function asPositiveNumber(value, defaultValue = 1) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : defaultValue;
}

function normalizeTunnelAxis(axis) {
    if (axis === 'x' || axis === 'y' || axis === 'z') return axis;
    return 'z';
}

function resolveTunnelRadius(tunnelRadius, width, height, depth, axis) {
    const tunnelAxis = normalizeTunnelAxis(axis);
    const crossA = tunnelAxis === 'x' ? height : width;
    const crossB = tunnelAxis === 'z' ? height : depth;
    const maxRadius = Math.max(0.001, Math.min(crossA, crossB) * 0.5 - 1e-4);
    const fallback = Math.max(0.35, Math.min(crossA, crossB) * 0.3);
    const radius = asPositiveNumber(tunnelRadius, fallback);
    return Math.min(radius, maxRadius);
}

function resolveStandaloneTunnelWallThickness(innerRadius) {
    return Math.max(0.25, Math.min(1.2, innerRadius * 0.18));
}

function removeAndDisposeObject(arena, key) {
    const obj = arena[key];
    if (!obj) return;
    arena.renderer.removeFromScene(obj);
    if (obj.geometry?.dispose) {
        obj.geometry.dispose();
    }
    arena[key] = null;
}

export class ArenaGeometryCompilePipeline {
    constructor(arena) {
        this.arena = arena;
    }

    beginBuildStage() {
        const arena = this.arena;
        arena.obstacles = [];
        arena._clearLoadedGlbScene?.();
        arena._clearAuthoredAircraftDecorations?.();
        arena._glbLoadError = null;
        arena._glbLoadWarnings = [];

        removeAndDisposeObject(arena, '_floorMesh');
        removeAndDisposeObject(arena, '_mergedWallMesh');
        removeAndDisposeObject(arena, '_mergedObstacleMesh');
        removeAndDisposeObject(arena, '_mergedFoamMesh');
        removeAndDisposeObject(arena, '_mergedObstacleEdges');
        removeAndDisposeObject(arena, '_mergedFoamEdges');
        removeAndDisposeObject(arena, 'particles');

        arena._pendingWallGeos = [];
        arena._pendingObstacleGeos = [];
        arena._pendingFoamGeos = [];
        arena._pendingObstacleEdgeGeos = [];
        arena._pendingFoamEdgeGeos = [];
    }

    compileWallStage({ sx, sy, sz, scale }) {
        const t = resolveGameplayConfig(this.arena).ARENA.WALL_THICKNESS * scale;
        const halfX = sx / 2;
        const halfY = sy / 2;
        const halfZ = sz / 2;
        this._addWall(0, halfY, halfZ + t / 2, sx + 2 * t, sy, t);
        this._addWall(0, halfY, -halfZ - t / 2, sx + 2 * t, sy, t);
        this._addWall(-halfX - t / 2, halfY, 0, t, sy, sz);
        this._addWall(halfX + t / 2, halfY, 0, t, sy, sz);
        this._addWall(0, sy + t / 2, 0, sx, t, sz);
    }

    compileObstacleStage({ obstacleDefs, scale }) {
        const arena = this.arena;
        for (const obs of obstacleDefs) {
            const obstacleKind = String(obs.kind || 'hard').toLowerCase();
            const isFoamObstacle = obstacleKind === 'foam';
            const obstacleOptions = {
                kind: isFoamObstacle ? 'foam' : 'hard',
            };

            if (String(obs.shape || '').toLowerCase() === 'tube') {
                const start = Array.isArray(obs.start) ? obs.start : [];
                const end = Array.isArray(obs.end) ? obs.end : [];
                const innerRadius = Number(obs.radius);
                if (start.length < 3 || end.length < 3) continue;
                if (![start[0], start[1], start[2], end[0], end[1], end[2], innerRadius].every(Number.isFinite)) continue;
                this._addStandaloneTunnel(
                    start[0] * scale,
                    start[1] * scale,
                    start[2] * scale,
                    end[0] * scale,
                    end[1] * scale,
                    end[2] * scale,
                    innerRadius * scale,
                    obstacleOptions,
                );
                continue;
            }

            if (!obs || !Array.isArray(obs.pos) || !Array.isArray(obs.size)) continue;
            const px = Number(obs.pos[0]);
            const py = Number(obs.pos[1]);
            const pz = Number(obs.pos[2]);
            const ox = Number(obs.size[0]);
            const oy = Number(obs.size[1]);
            const oz = Number(obs.size[2]);
            if (![px, py, pz, ox, oy, oz].every(Number.isFinite)) continue;
            if (ox <= 0 || oy <= 0 || oz <= 0) continue;

            const hasTunnel = obs.tunnel && typeof obs.tunnel === 'object';
            if (hasTunnel) {
                const tunnelRadius = Number(obs.tunnel.radius);
                const tunnelAxis = normalizeTunnelAxis(String(obs.tunnel.axis || 'z').toLowerCase());
                this._addObstacleWithTunnel(
                    px * scale,
                    py * scale,
                    pz * scale,
                    ox * scale,
                    oy * scale,
                    oz * scale,
                    tunnelRadius * scale,
                    tunnelAxis,
                    obstacleOptions,
                );
                continue;
            }

            this._addObstacle(
                px * scale,
                py * scale,
                pz * scale,
                ox * scale,
                oy * scale,
                oz * scale,
                obstacleOptions,
            );
        }
    }

    flushMergeStage(materialBundle) {
        const arena = this.arena;

        const addMergedMesh = (geos, material, isShadowCaster = false) => {
            if (geos.length === 0) return null;
            const merged = mergeGeometries(geos, false);
            if (!merged) return null;
            const mesh = new THREE.Mesh(merged, material);
            mesh.castShadow = isShadowCaster;
            mesh.receiveShadow = true;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            arena.renderer.addToScene(mesh);
            geos.forEach((g) => g.dispose());
            return mesh;
        };

        const addMergedLines = (geos, material) => {
            if (geos.length === 0) return null;
            const merged = mergeGeometries(geos, false);
            if (!merged) return null;
            const lines = new THREE.LineSegments(merged, material);
            lines.matrixAutoUpdate = false;
            lines.updateMatrix();
            arena.renderer.addToScene(lines);
            geos.forEach((g) => g.dispose());
            return lines;
        };

        arena._mergedWallMesh = addMergedMesh(arena._pendingWallGeos, materialBundle.wallMat, true);
        arena._mergedObstacleMesh = addMergedMesh(arena._pendingObstacleGeos, materialBundle.obstacleMat, true);
        arena._mergedFoamMesh = addMergedMesh(arena._pendingFoamGeos, materialBundle.foamMat, true);
        arena._mergedObstacleEdges = addMergedLines(arena._pendingObstacleEdgeGeos, materialBundle.obstacleEdgeMat);
        arena._mergedFoamEdges = addMergedLines(arena._pendingFoamEdgeGeos, materialBundle.foamEdgeMat);

        arena._pendingWallGeos = [];
        arena._pendingObstacleGeos = [];
        arena._pendingFoamGeos = [];
        arena._pendingObstacleEdgeGeos = [];
        arena._pendingFoamEdgeGeos = [];
    }

    _addWall(x, y, z, w, h, d) {
        const arena = this.arena;
        const geo = new THREE.BoxGeometry(w, h, d);

        const box = new THREE.Box3(
            new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
            new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)
        );
        arena.obstacles.push({ box, isWall: true, kind: 'wall' });

        const worldGeo = geo.clone();
        const translationMatrix = new THREE.Matrix4().makeTranslation(x, y, z);
        worldGeo.applyMatrix4(translationMatrix);
        arena._pendingWallGeos.push(worldGeo);

        geo.dispose();
    }

    _addObstacle(x, y, z, w, h, d, options = {}) {
        const arena = this.arena;
        const kind = typeof options.kind === 'string' ? options.kind : 'hard';
        const isFoam = kind === 'foam';

        const geo = new THREE.BoxGeometry(w, h, d);
        const translationMatrix = new THREE.Matrix4().makeTranslation(x, y, z);

        const box = new THREE.Box3(
            new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
            new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)
        );
        arena.obstacles.push({ box, isWall: false, kind });

        const worldGeo = geo.clone();
        worldGeo.applyMatrix4(translationMatrix);
        if (isFoam) {
            arena._pendingFoamGeos.push(worldGeo);
        } else {
            arena._pendingObstacleGeos.push(worldGeo);
        }

        const edgeGeo = new THREE.EdgesGeometry(geo);
        const worldEdgeGeo = edgeGeo.clone();
        worldEdgeGeo.applyMatrix4(translationMatrix);

        if (isFoam) {
            arena._pendingFoamEdgeGeos.push(worldEdgeGeo);
        } else {
            arena._pendingObstacleEdgeGeos.push(worldEdgeGeo);
        }

        edgeGeo.dispose();
        geo.dispose();
    }

    _addStandaloneTunnel(ax, ay, az, bx, by, bz, innerRadius, options = {}) {
        const arena = this.arena;
        const kind = typeof options.kind === 'string' ? options.kind : 'hard';
        const isFoam = kind === 'foam';
        const start = new THREE.Vector3(ax, ay, az);
        const end = new THREE.Vector3(bx, by, bz);
        const axis = end.clone().sub(start);
        const length = axis.length();
        if (!Number.isFinite(length) || length <= 0.001) return;

        const safeInnerRadius = asPositiveNumber(innerRadius, 1);
        const wallThickness = resolveStandaloneTunnelWallThickness(safeInnerRadius);
        const outerRadius = safeInnerRadius + wallThickness;

        const midpoint = start.clone().lerp(end, 0.5);
        axis.divideScalar(length);

        const geo = new THREE.CylinderGeometry(outerRadius, outerRadius, length, 28, 1, true);
        const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
        const transform = new THREE.Matrix4().compose(midpoint, rotation, new THREE.Vector3(1, 1, 1));
        geo.applyMatrix4(transform);

        const box = new THREE.Box3().setFromPoints([start, end]).expandByScalar(outerRadius);
        arena.obstacles.push({
            box,
            isWall: false,
            kind,
            tube: {
                ax,
                ay,
                az,
                bx,
                by,
                bz,
                innerRadius: safeInnerRadius,
                outerRadius,
                lengthSq: length * length,
            },
        });

        const worldGeo = geo.clone();
        if (isFoam) {
            arena._pendingFoamGeos.push(worldGeo);
        } else {
            arena._pendingObstacleGeos.push(worldGeo);
        }

        const edgeGeo = new THREE.EdgesGeometry(geo);
        if (isFoam) {
            arena._pendingFoamEdgeGeos.push(edgeGeo);
        } else {
            arena._pendingObstacleEdgeGeos.push(edgeGeo);
        }

        geo.dispose();
    }

    _addObstacleWithTunnel(x, y, z, w, h, d, tunnelRadius, tunnelAxis, options = {}) {
        const arena = this.arena;
        const kind = typeof options.kind === 'string' ? options.kind : 'hard';
        const isFoam = kind === 'foam';
        const axis = normalizeTunnelAxis(tunnelAxis);
        const radius = resolveTunnelRadius(tunnelRadius, w, h, d, axis);

        const geo = createBoxWithTunnel(w, h, d, radius, axis);
        const translationMatrix = new THREE.Matrix4().makeTranslation(x, y, z);

        const box = new THREE.Box3(
            new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
            new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)
        );

        arena.obstacles.push({
            box,
            isWall: false,
            kind,
            tunnel: { cx: x, cy: y, cz: z, radius, axis },
        });

        const worldGeo = geo.clone();
        worldGeo.applyMatrix4(translationMatrix);
        if (isFoam) {
            arena._pendingFoamGeos.push(worldGeo);
        } else {
            arena._pendingObstacleGeos.push(worldGeo);
        }

        const edgeGeo = new THREE.EdgesGeometry(geo);
        const worldEdgeGeo = edgeGeo.clone();
        worldEdgeGeo.applyMatrix4(translationMatrix);
        if (isFoam) {
            arena._pendingFoamEdgeGeos.push(worldEdgeGeo);
        } else {
            arena._pendingObstacleEdgeGeos.push(worldEdgeGeo);
        }

        edgeGeo.dispose();
        geo.dispose();
    }
}
