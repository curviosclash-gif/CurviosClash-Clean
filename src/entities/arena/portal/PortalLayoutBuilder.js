import * as THREE from 'three';
import {
    createPortalGateVisualRegistry,
    createBoostPortalMesh,
    createPortalMesh,
    createSlingshotGateMesh,
} from '../PortalGateMeshFactory.js';
import {
    CHECKPOINT_BRANCH_COLOR,
    createCheckpointRingMesh,
    createFinishRingMesh,
} from '../CheckpointRingMeshFactory.js';
import { buildRouteFromParcours } from '../../systems/ParcoursProgressUtils.js';
import {
    getMapPlanarAnchors,
    getMapPortalSlots3D,
    portalPositionFromSlot,
    resolvePlanarLevels,
    resolvePlanarElevatorPair,
    resolvePlanarTransitionOrder,
    resolvePortalPosition,
} from '../PortalPlacementOps.js';
import { resolveEntityRuntimeConfig } from '../../../shared/contracts/EntityRuntimeConfig.js';
import { resolvePortalMode, resolvePortalPairCount } from '../../../shared/contracts/PortalAuthoringContract.js';

const PORTAL_EXIT_OFFSET = 1.8;
const PORTAL_NORMAL = new THREE.Vector3(0, 0, 1);
// Authored pairs sit where a designer put them, so a blocked endpoint is rescued by
// stepping off the authored height rather than by sliding far across the arena.
const AUTHORED_PORTAL_RESCUE = Object.freeze({
    verticalOffsets: Object.freeze([0, 2.5, -2.5, 5, -5, 8, -8, 12, -12]),
});

function disposeMeshTreeResources(root) {
    if (!root || typeof root.traverse !== 'function') return;
    const seenGeometries = new Set();
    const seenMaterials = new Set();
    root.traverse((node) => {
        const geometry = node?.geometry;
        if (geometry && !geometry?.userData?.__sharedNoDispose && typeof geometry.dispose === 'function' && !seenGeometries.has(geometry)) {
            seenGeometries.add(geometry);
            geometry.dispose();
        }
        const material = node?.material;
        if (!material) return;
        const materialList = Array.isArray(material) ? material : [material];
        for (const entry of materialList) {
            if (!entry || entry?.userData?.__sharedNoDispose || seenMaterials.has(entry) || typeof entry.dispose !== 'function') continue;
            seenMaterials.add(entry);
            entry.dispose();
        }
    });
}

function asFiniteNumber(value, defaultValue = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : defaultValue;
}

function asPositiveNumber(value, defaultValue = 1) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : defaultValue;
}

function resolvePortalOrientation(forwardValue, rotationValue) {
    const quaternion = new THREE.Quaternion();
    if (Array.isArray(rotationValue) && rotationValue.length >= 3) {
        quaternion.setFromEuler(new THREE.Euler(
            asFiniteNumber(rotationValue[0]),
            asFiniteNumber(rotationValue[1]),
            asFiniteNumber(rotationValue[2])
        ));
        return {
            quaternion,
            forward: PORTAL_NORMAL.clone().applyQuaternion(quaternion).normalize(),
        };
    }
    if (!Array.isArray(forwardValue) || forwardValue.length < 3) return null;
    const forward = new THREE.Vector3(
        asFiniteNumber(forwardValue[0]),
        asFiniteNumber(forwardValue[1]),
        asFiniteNumber(forwardValue[2])
    );
    if (forward.lengthSq() <= 0.000001) return null;
    forward.normalize();
    quaternion.setFromUnitVectors(PORTAL_NORMAL, forward);
    return { quaternion, forward };
}

export class PortalLayoutBuilder {
    constructor(arena) {
        this.arena = arena;
        this._tmpVec = new THREE.Vector3();
        this._tmpVec2 = new THREE.Vector3();
        this._portalMeshCompactMode = false;
        this._visualRegistry = null;
        this._checkpointRingSpinEnabled = true;
        this.arena.portalLayoutWarnings = [];
    }

    build(map, scale) {
        this._resetExistingPortalGateVisuals();
        this._mapDefinition = map || null;
        this._mapScale = asPositiveNumber(scale, 1);
        this._visualRegistry = createPortalGateVisualRegistry(this.arena.renderer);
        this._checkpointRingSpinEnabled = true;
        this._buildPortals(map, scale);
        this._buildSpecialGates(map, scale);
        this._buildExitPortals(map, scale);
        this._buildCheckpointRings(map, scale);
    }

    _resetExistingPortalGateVisuals() {
        this._disposeVisualRegistry();
        this._disposeCheckpointMeshes();
        this.arena.portals = [];
        this.arena.specialGates = [];
        this.arena.exitPortals = [];
        this.arena.checkpointRings = [];
    }

    _disposeVisualRegistry() {
        if (!this._visualRegistry || typeof this._visualRegistry.dispose !== 'function') {
            this._visualRegistry = null;
            return;
        }
        this._visualRegistry.dispose();
        this._visualRegistry = null;
    }

    _disposeCheckpointMeshes() {
        const checkpointRings = Array.isArray(this.arena.checkpointRings)
            ? this.arena.checkpointRings
            : [];
        for (const checkpointRing of checkpointRings) {
            const mesh = checkpointRing?.mesh;
            if (!mesh) continue;
            this.arena.renderer?.removeFromScene?.(mesh);
            disposeMeshTreeResources(mesh);
        }
    }

    get checkpointRingSpinEnabled() {
        return this._checkpointRingSpinEnabled;
    }

    _buildExitPortals(map, scale) {
        this.arena.exitPortals = [];
        if (!map || !map.exitPortal) return;
        const def = map.exitPortal;
        if (!Array.isArray(def.pos)) return;

        const pos = new THREE.Vector3(
            asFiniteNumber(def.pos[0]) * scale,
            asFiniteNumber(def.pos[1]) * scale,
            asFiniteNumber(def.pos[2]) * scale
        );
        const color = Number.isFinite(def.color) ? def.color : 0x00ff88;
        const activateOnClear = def.activateOnClear !== false;

        const mesh = createPortalMesh(pos, color, 'NEUTRAL', this._visualRegistry, {
            compact: false,
            configSource: this.arena,
        });
        if (mesh) {
            const scaleValue = activateOnClear ? 0.75 : 1.4;
            mesh.scale.set(scaleValue, scaleValue, scaleValue);
            mesh.visible = true;
        }

        this.arena.exitPortals.push({
            kind: 'exit',
            pos,
            color,
            mesh,
            active: !activateOnClear,
            activateOnClear,
            cooldowns: new Map(),
            visualPulseRemaining: 0,
        });
    }

    _buildCheckpointRings(map, scale) {
        this.arena.checkpointRings = [];
        if (!map?.parcours) return;
        const route = buildRouteFromParcours(map.parcours);
        if (!route) return;
        this._checkpointRingSpinEnabled = route.rules.animateCheckpoints !== false;

        for (const cp of route.checkpoints) {
            const pos = new THREE.Vector3(
                asFiniteNumber(cp.pos[0]) * scale,
                asFiniteNumber(cp.pos[1]) * scale,
                asFiniteNumber(cp.pos[2]) * scale
            );

            let rotation = null;
            if (cp.forward) {
                const target = new THREE.Vector3(
                    pos.x + cp.forward[0],
                    pos.y + cp.forward[1],
                    pos.z + cp.forward[2]
                );
                const tmpMatrix = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0));
                const quat = new THREE.Quaternion().setFromRotationMatrix(tmpMatrix);
                rotation = new THREE.Euler().setFromQuaternion(quat);
            }

            const number = cp.routeIndex + 1;
            const visualRadius = Math.max(3.2, asPositiveNumber(cp.radius, 4.2) * 0.75) * scale;
            const branchColor = Number(cp.params?.color);
            const mesh = createCheckpointRingMesh(pos, rotation, number, this.arena.renderer, visualRadius, {
                color: cp.isBranchOption
                    ? (Number.isFinite(branchColor) ? branchColor : CHECKPOINT_BRANCH_COLOR)
                    : undefined,
                visualKind: cp.isBranchOption ? 'branch' : 'default',
            });
            if (!mesh) continue;

            this.arena.checkpointRings.push({
                routeIndex: cp.routeIndex,
                checkpointId: cp.id,
                pos,
                mesh,
                isBranchOption: cp.isBranchOption === true,
                branchParentId: cp.branchParentId || null,
                mergeCheckpointId: cp.mergeCheckpointId || null,
            });
        }

        if (route.finish) {
            const fPos = new THREE.Vector3(
                asFiniteNumber(route.finish.pos[0]) * scale,
                asFiniteNumber(route.finish.pos[1]) * scale,
                asFiniteNumber(route.finish.pos[2]) * scale
            );

            let fRotation = null;
            if (route.finish.forward) {
                const target = new THREE.Vector3(
                    fPos.x + route.finish.forward[0],
                    fPos.y + route.finish.forward[1],
                    fPos.z + route.finish.forward[2]
                );
                const tmpMatrix = new THREE.Matrix4().lookAt(fPos, target, new THREE.Vector3(0, 1, 0));
                const quat = new THREE.Quaternion().setFromRotationMatrix(tmpMatrix);
                fRotation = new THREE.Euler().setFromQuaternion(quat);
            }

            const finishVisualRadius = Math.max(4.2, asPositiveNumber(route.finish.radius, 5.5) * 0.75) * scale;
            const mesh = createFinishRingMesh(fPos, fRotation, this.arena.renderer, finishVisualRadius);
            if (mesh) {
                this.arena.checkpointRings.push({
                    routeIndex: -1,
                    checkpointId: route.finish.id,
                    pos: fPos,
                    mesh,
                    isFinish: true,
                });
            }
        }
    }

    _buildSpecialGates(map, scale) {
        this.arena.specialGates = [];
        if (!Array.isArray(map.gates)) return;

        for (const gateDef of map.gates) {
            if (!gateDef || !Array.isArray(gateDef.pos)) continue;

            const pos = new THREE.Vector3(
                asFiniteNumber(gateDef.pos[0]) * scale,
                asFiniteNumber(gateDef.pos[1]) * scale,
                asFiniteNumber(gateDef.pos[2]) * scale
            );

            const rotation = new THREE.Euler(
                (asFiniteNumber(gateDef.rot?.[0]) * Math.PI) / 180,
                (asFiniteNumber(gateDef.rot?.[1]) * Math.PI) / 180,
                (asFiniteNumber(gateDef.rot?.[2]) * Math.PI) / 180
            );

            const forward = new THREE.Vector3(0, 0, 1);
            if (Array.isArray(gateDef.forward)) {
                forward.set(gateDef.forward[0], gateDef.forward[1], gateDef.forward[2]).normalize();
            } else {
                forward.applyEuler(rotation).normalize();
            }

            const up = new THREE.Vector3(0, 1, 0);
            if (Array.isArray(gateDef.up)) {
                up.set(gateDef.up[0], gateDef.up[1], gateDef.up[2]).normalize();
            } else {
                up.applyEuler(rotation).normalize();
            }

            const type = String(gateDef.type || 'boost').toLowerCase();
            const color = Number.isFinite(gateDef.color) ? gateDef.color : (type === 'boost' ? 0xffb34d : 0x7dfbff);

            let mesh;
            if (type === 'boost') {
                mesh = createBoostPortalMesh(pos, rotation, color, this._visualRegistry);
            } else if (type === 'slingshot') {
                mesh = createSlingshotGateMesh(pos, rotation, color, this._visualRegistry);
            }
            if (!mesh) continue;

            if (Array.isArray(gateDef.forward)) {
                this._tmpVec.copy(pos).add(forward);
                mesh.lookAt(this._tmpVec);
                if (Array.isArray(gateDef.up)) {
                    mesh.up.set(gateDef.up[0], gateDef.up[1], gateDef.up[2]);
                    mesh.lookAt(this._tmpVec);
                }
            }

            this.arena.specialGates.push({
                type,
                legacyType: typeof gateDef.legacyType === 'string' ? gateDef.legacyType : undefined,
                warningCode: typeof gateDef.warningCode === 'string' ? gateDef.warningCode : undefined,
                pos,
                rotation,
                quaternion: mesh.quaternion.clone(),
                forward,
                up,
                mesh,
                radius: asPositiveNumber(gateDef.radius, type === 'boost' ? 3.25 : 2.9) * scale,
                cooldowns: new Map(),
                visualPulseRemaining: 0,
                params: gateDef.params || {},
            });
        }
    }

    _buildPortals(map, scale) {
        const config = resolveEntityRuntimeConfig(this.arena);
        this.arena.portals = [];
        this._portalMeshCompactMode = false;
        if (!this.arena.portalsEnabled) return;

        const planarMode = config.GAMEPLAY.PLANAR_MODE === true;
        const hasAuthoredPortals = Array.isArray(map?.portals) && map.portals.length > 0;
        const portalMode = resolvePortalMode(map);
        const wantsAuthoredPortals = !planarMode
            && hasAuthoredPortals
            && (portalMode === 'authored' || portalMode === 'hybrid');
        if (wantsAuthoredPortals) {
            this._portalMeshCompactMode = map.portals.length >= 2;
            for (const def of map.portals) {
                this._createPortalFromDef(def, scale);
            }
        }

        const pairCount = resolvePortalPairCount(config.GAMEPLAY.PORTAL_COUNT);
        const wantsDynamicPortals = planarMode || portalMode === 'dynamic' || portalMode === 'hybrid';
        if (pairCount > 0 && wantsDynamicPortals) {
            this._portalMeshCompactMode = pairCount >= 2;
            const remainingPairs = !planarMode && portalMode === 'hybrid'
                ? Math.max(0, pairCount - this.arena.portals.length)
                : pairCount;
            if (remainingPairs > 0) {
                this._buildFixedDynamicPortals(remainingPairs);
            }
        }

        this._validatePortalPlacements();
    }

    _createPortalFromDef(def, scale) {
        const config = resolveEntityRuntimeConfig(this.arena);
        if (!def || !Array.isArray(def.a) || !Array.isArray(def.b)) return;
        const ax = Number(def.a[0]);
        const ay = Number(def.a[1]);
        const az = Number(def.a[2]);
        const bx = Number(def.b[0]);
        const by = Number(def.b[1]);
        const bz = Number(def.b[2]);
        if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) return;

        const posA = resolvePortalPosition(new THREE.Vector3(ax * scale, ay * scale, az * scale), 11, this.arena, config.PORTAL, AUTHORED_PORTAL_RESCUE);
        const posB = resolvePortalPosition(new THREE.Vector3(bx * scale, by * scale, bz * scale), 29, this.arena, config.PORTAL, AUTHORED_PORTAL_RESCUE);
        if (!posA || !posB) {
            this._warnPortalLayout('Authored portal pair was skipped because no collision-free placement was found.');
            return;
        }
        const color = Number.isFinite(def.color) ? def.color : 0x00ffcc;
        this._addPortalInstance(posA, posB, color, 'NEUTRAL', 'NEUTRAL', {
            visualA: def.modelA || def.model || null,
            visualB: def.modelB || def.model || null,
            orientationA: resolvePortalOrientation(def.forwardA, def.rotationA),
            orientationB: resolvePortalOrientation(def.forwardB, def.rotationB),
        });
    }

    _buildFixedDynamicPortals(pairCount) {
        if (resolveEntityRuntimeConfig(this.arena).GAMEPLAY.PLANAR_MODE) {
            this._buildFixedPlanarPortals(pairCount);
        } else {
            this._buildFixed3DPortals(pairCount);
        }
    }

    _buildFixed3DPortals(pairCount) {
        const config = resolveEntityRuntimeConfig(this.arena);
        const colors = [0x00ffcc, 0xff00cc, 0xffff00, 0x00ccff, 0xff8844, 0x66ff44, 0x9b7bff, 0xff5f7a, 0x7dffef, 0xd4ff66];
        const slots = getMapPortalSlots3D(this.arena.currentMapKey);
        if (slots.length < 2) return;

        for (let i = 0; i < pairCount; i++) {
            const slotAIdx = (i * 2) % slots.length;
            const slotA = slots[slotAIdx];
            
            let slotBIdx = (i * 2 + 5) % slots.length;
            if (slotBIdx === slotAIdx) {
                slotBIdx = (slotBIdx + 1) % slots.length;
            }
            const slotB = slots[slotBIdx];
            
            let slotBAltIdx = (i * 2 + 7) % slots.length;
            while (slotBAltIdx === slotAIdx || slotBAltIdx === slotBIdx) {
                slotBAltIdx = (slotBAltIdx + 1) % slots.length;
            }
            const slotBAlt = slots[slotBAltIdx];

            const posA = portalPositionFromSlot(slotA, i * 13 + 5, this.arena, config.PORTAL);
            let posB = portalPositionFromSlot(slotB, i * 17 + 9, this.arena, config.PORTAL);
            if (!posA || !posB) continue;
            if (posA.distanceToSquared(posB) < 64) {
                posB = portalPositionFromSlot(slotBAlt, i * 23 + 3, this.arena, config.PORTAL);
            }
            if (!posB) continue;

            this._addPortalInstance(posA, posB, colors[i % colors.length], 'NEUTRAL', 'NEUTRAL');
        }
    }

    _buildFixedPlanarPortals(pairCount) {
        const config = resolveEntityRuntimeConfig(this.arena);
        const colors = [0x00ffcc, 0xff00cc, 0xffff00, 0x00ccff, 0xff8844, 0x66ff44, 0x9b7bff, 0xff5f7a, 0x7dffef, 0xd4ff66];
        const anchors = getMapPlanarAnchors(this.arena.currentMapKey);
        const levels = this.getPortalLevels();
        if (anchors.length === 0 || levels.length < 2) return;

        const transitionOrder = resolvePlanarTransitionOrder(levels, this.arena.bounds);
        for (let i = 0; i < pairCount; i++) {
            const anchor = anchors[i % anchors.length];
            const levelBand = transitionOrder[i % transitionOrder.length];
            const lowY = levels[levelBand];
            const highY = levels[levelBand + 1];
            const pair = resolvePlanarElevatorPair(anchor[0], anchor[1], lowY, highY, i * 29 + 7, this.arena, config.PORTAL);
            if (!pair) continue;
            this._addPortalInstance(pair.low, pair.high, colors[i % colors.length], 'UP', 'DOWN');
        }
    }

    _addPortalInstance(posA, posB, color, dirA = 'NEUTRAL', dirB = 'NEUTRAL', options = {}) {
        if (!this._canAddPortalPair(posA, posB, options)) return false;
        const portalMeshOptions = this._portalMeshCompactMode
            ? { compact: true, configSource: this.arena }
            : { configSource: this.arena };
        const meshA = createPortalMesh(posA, color, dirA, this._visualRegistry, {
            ...portalMeshOptions,
            visualType: options.visualA,
            quaternion: options.orientationA?.quaternion,
        });
        const meshB = createPortalMesh(posB, color, dirB, this._visualRegistry, {
            ...portalMeshOptions,
            visualType: options.visualB,
            quaternion: options.orientationB?.quaternion,
        });
        this.arena.portals.push({
            posA,
            posB,
            meshA,
            meshB,
            color,
            forwardA: options.orientationA?.forward || null,
            forwardB: options.orientationB?.forward || null,
            cooldowns: new Map(),
            visualPulseRemaining: 0,
        });
        return true;
    }

    _canAddPortalPair(posA, posB, options = {}) {
        if (!posA || !posB) return false;
        const config = resolveEntityRuntimeConfig(this.arena);
        const portalConfig = config.PORTAL;
        const planarMode = config.GAMEPLAY.PLANAR_MODE === true;
        const minPairDistance = planarMode
            ? asPositiveNumber(portalConfig.MIN_PAIR_DISTANCE_PLANAR, 4)
            : asPositiveNumber(portalConfig.MIN_PAIR_DISTANCE, 15);
        if (posA.distanceToSquared(posB) < minPairDistance * minPairDistance) {
            this._warnPortalLayout('Portal pair was skipped because its endpoints are too close.');
            return false;
        }

        const endpointClearance = Math.max(4, asPositiveNumber(portalConfig.RADIUS, 4));
        const endpointClearanceSq = endpointClearance * endpointClearance;
        for (const portal of this.arena.portals) {
            if (posA.distanceToSquared(portal.posA) < endpointClearanceSq
                || posA.distanceToSquared(portal.posB) < endpointClearanceSq
                || posB.distanceToSquared(portal.posA) < endpointClearanceSq
                || posB.distanceToSquared(portal.posB) < endpointClearanceSq) {
                this._warnPortalLayout('Portal pair was skipped because an endpoint overlaps another portal.');
                return false;
            }
        }

        const arrivalRadius = Math.max(0.5, asPositiveNumber(portalConfig.RADIUS, 4) * 0.5);
        const arrivals = [
            [posA, options.orientationA?.forward],
            [posB, options.orientationB?.forward],
        ];
        for (const [position, forward] of arrivals) {
            if (!forward) continue;
            for (const directionSign of [-1, 1]) {
                this._tmpVec2.copy(position).addScaledVector(forward, PORTAL_EXIT_OFFSET * directionSign);
                if (this.arena.checkCollision(this._tmpVec2, arrivalRadius)) {
                    this._warnPortalLayout('Portal pair was skipped because an oriented exit is blocked.');
                    return false;
                }
            }
        }
        return true;
    }

    _validatePortalPlacements() {
        return this.arena.portalLayoutWarnings;
    }

    _warnPortalLayout(message) {
        if (!this.arena.portalLayoutWarnings.includes(message)) {
            this.arena.portalLayoutWarnings.push(message);
            console.warn(`[PortalLayoutBuilder] ${message}`);
        }
    }

    getPortalLevelsFallback() {
        const config = resolveEntityRuntimeConfig(this.arena);
        return resolvePlanarLevels(
            [],
            config.GAMEPLAY.PLANAR_LEVEL_COUNT,
            this.arena.bounds
        );
    }

    getPortalLevels() {
        const config = resolveEntityRuntimeConfig(this.arena);
        const map = this._mapDefinition || this.arena.runtimeMapDefinition || config.MAPS[this.arena.currentMapKey];
        return resolvePlanarLevels(
            map?.portalLevels,
            config.GAMEPLAY.PLANAR_LEVEL_COUNT,
            this.arena.bounds,
            this._mapScale
        );
    }
}
