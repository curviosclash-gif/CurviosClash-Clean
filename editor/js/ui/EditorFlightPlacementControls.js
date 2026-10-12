import * as THREE from 'three';
import {
    FLIGHT_PLACEMENT_DEFAULT_DISTANCE_INDEX,
    FLIGHT_PLACEMENT_DISTANCE_RADII,
    isTwoPointFlightTool,
    resolveCrosshairTarget,
    resolveFlightFacing,
    resolveSurfaceContactOffset,
    resolveTwoPointBox,
} from '../EditorFlightPlacement.js';
import { createEditorMesh } from '../EditorMeshFactory.js';
import { getEditorTurretAuthoringScale } from './EditorTurretProperties.js';
import { getCurrentToolSubtype, isYLayerEnabled } from './EditorFormState.js';

const GHOST_OPACITY = 0.42;
// Same radius the ground drawing gives a new tunnel.
const TUNNEL_RADIUS = 160;
const FACING_TOOLS = new Set(['checkpoint', 'portal']);
const MESH_FORWARD = new THREE.Vector3(0, 0, 1);

function isHiddenOrOutline(object) {
    for (let node = object; node; node = node.parent) {
        if (node.visible === false || node.userData?.isSelectionOutline) return true;
    }
    return false;
}

/**
 * Building from the cockpit: the crosshair aims, a translucent copy of the chosen part
 * shows where it lands, a click (or Enter) sets it. Blocks and tunnels take two clicks,
 * start and end, so they can span any direction in the air.
 */
export function bindEditorFlightPlacementControls(editor, flight) {
    const core = editor?.core;
    if (!core || !flight) return;
    const dom = editor.dom || {};
    const raycaster = new THREE.Raycaster();
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    const bounds = new THREE.Box3();

    let distanceIndex = FLIGHT_PLACEMENT_DEFAULT_DISTANCE_INDEX;
    let target = null;
    let ghost = null;
    let ghostMaterials = [];
    let ghostKey = '';
    let draft = null;

    const fallbackDistance = () => (
        FLIGHT_PLACEMENT_DISTANCE_RADII[distanceIndex] * (Number(flight.getParams()?.hitboxRadius) || 10)
    );

    const castCrosshair = () => {
        core.camera.getWorldPosition(origin);
        core.camera.getWorldDirection(direction);
        raycaster.set(origin, direction);
        const surfaces = core.objectsContainer.children.filter((object) => (
            object.visible !== false && object !== draft?.mesh
        ));
        surfaces.push(isYLayerEnabled(editor) ? core.yGroundMesh : core.groundMesh);
        for (const hit of raycaster.intersectObjects(surfaces, true)) {
            if (isHiddenOrOutline(hit.object)) continue;
            let normal = null;
            if (hit.face) {
                normal = hit.face.normal.clone()
                    .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
                    .normalize();
                // A back face still has to push the object towards the ship.
                if (normal.dot(direction) > 0) normal.negate();
            }
            return { point: hit.point, normal, object: hit.object };
        }
        return null;
    };

    const placementExtras = (tool) => ({
        ...(tool === 'turret' ? { turretAuthoringScale: getEditorTurretAuthoringScale(editor) } : {}),
        ...resolveFlightFacing(tool, direction),
    });

    const disposeGhost = () => {
        if (!ghost) return;
        core.scene.remove(ghost);
        editor.mapManager?.disposeObjectResources?.(ghost);
        ghostMaterials.forEach((material) => material.dispose());
        ghost = null;
        ghostMaterials = [];
        ghostKey = '';
    };

    const createGhost = (tool, subType) => {
        const mesh = createEditorMesh(editor.mapManager, tool, subType, 0, 0, 0, 0, placementExtras(tool), {
            register: false,
            updateUi: false,
            attachSelectionOutlines: false,
        });
        if (!mesh) return null;
        // The shared editor materials stay untouched; the copy gets its own see-through ones.
        mesh.traverse((node) => {
            if (!node.isMesh || !node.material) return;
            const toGhost = (material) => {
                const copy = material.clone();
                copy.transparent = true;
                copy.opacity = Math.min(Number(copy.opacity) || 1, GHOST_OPACITY);
                copy.depthWrite = false;
                ghostMaterials.push(copy);
                return copy;
            };
            node.material = Array.isArray(node.material) ? node.material.map(toGhost) : toGhost(node.material);
        });
        mesh.name = 'editorFlightPlacementGhost';
        core.scene.add(mesh);
        return mesh;
    };

    const syncGhost = () => {
        const tool = editor.currentTool;
        const wantsGhost = !draft && tool !== 'select' && !isTwoPointFlightTool(tool);
        const subType = wantsGhost ? getCurrentToolSubtype(editor) : null;
        const key = wantsGhost ? `${tool}:${subType ?? ''}` : '';
        if (key !== ghostKey) {
            disposeGhost();
            if (wantsGhost) {
                ghost = createGhost(tool, subType);
                ghostKey = ghost ? key : '';
            }
        }
        if (!ghost || !target) return;
        ghost.position.copy(target.point);
        if (FACING_TOOLS.has(tool)) ghost.quaternion.setFromUnitVectors(MESH_FORWARD, direction);
        if (target.onSurface && target.normal) {
            ghost.updateMatrixWorld(true);
            bounds.setFromObject(ghost);
            ghost.position.addScaledVector(
                target.normal,
                resolveSurfaceContactOffset(bounds, target.point, target.normal)
            );
        }
    };

    const blockLimits = () => ({
        minSize: editor.useSnap ? editor.snapSize : 10,
        defaultHeight: editor.ARENA_H * 0.7,
    });

    const syncDraft = () => {
        if (!draft || !target) return;
        if (!editor.isManagedObjectAlive(draft.mesh)) {
            cancelDraft();
            return;
        }
        if (draft.tool === 'tunnel') {
            if (draft.start.distanceTo(target.point) > 0.1) {
                editor.mapManager.alignTunnelSegment(draft.mesh, draft.start, target.point.clone(), TUNNEL_RADIUS);
            }
            return;
        }
        const box = resolveTwoPointBox(draft.start, target.point, blockLimits());
        draft.mesh.position.copy(box.center);
        draft.mesh.scale.set(box.sizeX, box.sizeY, box.sizeZ);
        Object.assign(draft.mesh.userData, {
            sizeX: box.sizeX,
            sizeY: box.sizeY,
            sizeZ: box.sizeZ,
            sizeInfo: Math.max(box.sizeX, box.sizeY, box.sizeZ) * 0.5,
        });
    };

    const syncHud = () => {
        if (!dom.shipFlightTarget) return;
        const where = target?.onSurface ? 'Fläche' : `frei, ${Math.round(fallbackDistance())} voraus`;
        dom.shipFlightTarget.textContent = draft
            ? `Ziel: ${where} · zweiter Klick setzt das Ende`
            : `Ziel: ${where}`;
    };

    function cancelDraft() {
        if (!draft) return;
        const { mesh } = draft;
        draft = null;
        editor.cancelHistoryGesture('draw');
        if (editor.isManagedObjectAlive(mesh)) editor.mapManager?.removeObject?.(mesh);
    }

    const refuseLockedLayer = () => {
        if (!editor.isActiveLayerLocked?.()) return false;
        editor.notify?.('Die aktive Ebene ist gesperrt.', 'warn');
        return true;
    };

    const startDraft = (tool) => {
        if (refuseLockedLayer()) return;
        const start = target.point.clone();
        const limits = blockLimits();
        editor.beginHistoryGesture('draw', `Create ${tool}`);
        const mesh = editor.mapManager.createMesh(tool, getCurrentToolSubtype(editor), start.x, start.y, start.z, 0, {
            sizeX: limits.minSize,
            sizeZ: limits.minSize,
            sizeY: limits.defaultHeight,
            pointA: start.clone(),
            pointB: start.clone(),
        });
        if (!mesh) {
            editor.cancelHistoryGesture('draw');
            return;
        }
        editor.selectObject(null);
        editor.setSelectionOutline(mesh, 0xffff00, 0.65);
        draft = { tool, start, mesh };
        syncDraft();
    };

    const finishDraft = () => {
        const { mesh } = draft;
        draft = null;
        if (!editor.isManagedObjectAlive(mesh)) {
            editor.cancelHistoryGesture('draw');
            return;
        }
        editor.mapManager?.notifyObjectMutated?.(mesh, { workspace: false });
        editor.setSelectionOutline(mesh, 0x000000, 0.2);
        editor.selectObject(mesh);
        editor.commitHistoryGesture('draw');
    };

    const placeSingle = (tool) => {
        if (refuseLockedLayer()) return;
        const subType = getCurrentToolSubtype(editor);
        const position = ghost ? ghost.position : target.point;
        let created = null;
        editor.executeHistoryMutation(`Create ${tool}`, () => {
            created = editor.mapManager.createMesh(
                tool, subType, position.x, position.y, position.z, 0, placementExtras(tool)
            );
        });
        if (created) editor.selectObject(created);
    };

    const selectUnderCrosshair = () => {
        const hit = castCrosshair();
        editor.clearMarkedObjects?.();
        editor.selectObject(hit ? editor.resolveSelectableObject(hit.object) : null);
    };

    const primaryAction = () => {
        if (!flight.isActive() || !target || !editor.mapManager) return;
        const tool = editor.currentTool;
        if (tool === 'select') selectUnderCrosshair();
        else if (draft) finishDraft();
        else if (isTwoPointFlightTool(tool)) startDraft(tool);
        else placeSingle(tool);
    };

    const secondaryAction = () => {
        if (!flight.isActive()) return;
        if (draft) cancelDraft();
        else selectUnderCrosshair();
    };

    flight.onFrame(() => {
        const hit = castCrosshair();
        target = resolveCrosshairTarget({
            origin,
            direction,
            hit,
            fallbackDistance: fallbackDistance(),
            snapSize: editor.useSnap ? editor.snapSize : 0,
        });
        syncDraft();
        syncGhost();
        syncHud();
    });
    flight.onStop(() => {
        cancelDraft();
        disposeGhost();
        target = null;
    });

    core.container.addEventListener('pointerdown', (e) => {
        if (!flight.isActive() || !flight.isMouseLocked()) return;
        e.preventDefault();
        if (e.button === 0) primaryAction();
        else if (e.button === 2) secondaryAction();
    });
    core.container.addEventListener('contextmenu', (e) => {
        if (flight.isActive()) e.preventDefault();
    });
    core.container.addEventListener('wheel', (e) => {
        if (!flight.isActive() || !e.ctrlKey) return;
        const step = e.deltaY < 0 ? 1 : -1;
        distanceIndex = Math.max(0, Math.min(FLIGHT_PLACEMENT_DISTANCE_RADII.length - 1, distanceIndex + step));
    }, { passive: false });
    // Enter sets without the mouse, also when the browser refused the pointer lock.
    document.addEventListener('keydown', (e) => {
        if (!flight.isActive() || e.repeat || (e.code !== 'Enter' && e.code !== 'NumpadEnter')) return;
        e.preventDefault();
        primaryAction();
    });

    editor.getFlightPlacementTarget = () => (target ? {
        point: target.point.toArray(),
        onSurface: target.onSurface,
        drafting: !!draft,
        ghostPosition: ghost ? ghost.position.toArray() : null,
    } : null);
}
