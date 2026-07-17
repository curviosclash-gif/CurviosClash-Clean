import * as THREE from 'three';
import { resolveMapAuthoringStatus } from '../EditorMapSerializer.js';
import {
    createEditorAuthoringDocument,
    getDefaultEditorLayerId,
    parseEditorAuthoringDocument,
} from '../EditorAuthoringDocument.js';
import { EDITOR_PREFABS, getEditorPrefabById } from './EditorPrefabCatalog.js';

const AUTOSAVE_STORAGE_KEY = 'curviosclash.editor.autosave.v1';
const PLAYTEST_RETURN_STORAGE_KEY = 'curviosclash.editor.playtest-return.v1';
const AUTOSAVE_DELAY_MS = 450;
const OUTLINER_ROW_HEIGHT = 36;
const OUTLINER_OVERSCAN = 5;

const TYPE_LABELS = Object.freeze({
    hard: 'Hartblock', foam: 'Schaumblock', tunnel: 'Tunnel', portal: 'Portal',
    spawn: 'Spawn', item: 'Pickup', aircraft: 'Flugobjekt', glb: 'GLB-Modell', checkpoint: 'Parcours',
});

function listObjects(editor) {
    return Array.from(editor?.core?.objectsContainer?.children || [])
        .filter((object) => editor.isManagedObjectAlive(object));
}

function formatObjectLabel(object) {
    const type = String(object?.userData?.type || 'object');
    const subType = String(object?.userData?.subType || '').trim();
    return `${TYPE_LABELS[type] || type}${subType ? ` · ${subType}` : ''}`;
}

function cloneWorkspaceMetadata(editor) {
    const metadata = {};
    for (const object of listObjects(editor)) {
        const id = object.userData?.id;
        if (!id) continue;
        metadata[id] = {
            type: object.userData?.type,
            groupId: String(object.userData?.groupId || ''),
            locked: object.userData?.editorLocked === true,
            visible: typeof object.userData?.editorObjectVisible === 'boolean'
                ? object.userData.editorObjectVisible
                : object.visible !== false,
            editorLayerId: String(object.userData?.editorLayerId || getDefaultEditorLayerId(object.userData?.type)),
            portalPartnerId: String(object.userData?.portalPartnerId || ''),
            checkpointOrder: Number.isFinite(Number(object.userData?.checkpointOrder))
                ? Number(object.userData.checkpointOrder)
                : null,
        };
    }
    return metadata;
}

function applyWorkspaceMetadata(editor, metadata = {}) {
    if (!metadata || typeof metadata !== 'object') return;
    for (const [id, value] of Object.entries(metadata)) {
        const object = editor.mapManager?.getObjectById?.(id);
        if (!object || !value || typeof value !== 'object') continue;
        object.userData.groupId = String(value.groupId || '');
        object.userData.editorLocked = value.locked === true;
        object.userData.editorObjectVisible = value.visible !== false;
        object.userData.editorLayerId = String(value.editorLayerId || getDefaultEditorLayerId(object.userData?.type));
        object.userData.portalPartnerId = String(value.portalPartnerId || '');
        if (value.checkpointOrder !== null && value.checkpointOrder !== '' && Number.isFinite(Number(value.checkpointOrder))) object.userData.checkpointOrder = Number(value.checkpointOrder);
        object.visible = value.visible !== false;
    }
    editor.refreshLayerState?.();
    editor.syncTransformControlAttachment?.();
    editor.updateRelationshipVisuals?.();
}

function readAutosave() {
    try {
        const parsed = JSON.parse(localStorage.getItem(AUTOSAVE_STORAGE_KEY) || 'null');
        return parsed && typeof parsed.json === 'string' ? parsed : null;
    } catch { return null; }
}

function removeAutosave() {
    try { localStorage.removeItem(AUTOSAVE_STORAGE_KEY); } catch { /* optional */ }
}

function getBlockingBoxes(objects) {
    return objects.filter((object) => object.userData?.type === 'hard' || object.userData?.type === 'foam')
        .map((object) => ({ object, box: new THREE.Box3().setFromObject(object) }));
}

function buildValidationItems(editor) {
    const objects = listObjects(editor);
    const status = resolveMapAuthoringStatus(editor.mapManager);
    const arena = editor.getArenaSizeForExport();
    const halfW = arena.width * 0.5;
    const halfD = arena.depth * 0.5;
    const outside = objects.filter((object) => {
        const box = new THREE.Box3().setFromObject(object);
        const bounds = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
        if (!box.isEmpty() && bounds.every(Number.isFinite)) {
            return box.min.x < -halfW || box.max.x > halfW
                || box.min.z < -halfD || box.max.z > halfD
                || box.min.y < 0 || box.max.y > arena.height;
        }
        return Math.abs(Number(object.position?.x) || 0) > halfW
            || Math.abs(Number(object.position?.z) || 0) > halfD
            || (Number(object.position?.y) || 0) < 0
            || (Number(object.position?.y) || 0) > arena.height;
    });
    const boxes = getBlockingBoxes(objects);
    const spawns = objects.filter((object) => object.userData?.type === 'spawn');
    const portals = objects.filter((object) => object.userData?.type === 'portal');
    const checkpoints = objects.filter((object) => object.userData?.type === 'checkpoint')
        .sort((left, right) => (Number(left.userData?.checkpointOrder) || 0) - (Number(right.userData?.checkpointOrder) || 0));
    const overlappingSpawns = new Set();
    for (let left = 0; left < spawns.length; left += 1) {
        for (let right = left + 1; right < spawns.length; right += 1) {
            if (spawns[left].position.distanceTo(spawns[right].position) < 120) {
                overlappingSpawns.add(spawns[left].userData.id);
                overlappingSpawns.add(spawns[right].userData.id);
            }
        }
    }
    const trappedSpawns = spawns.filter((spawn) => boxes.some(({ box }) => box.containsPoint(spawn.position)));
    const blockedPortals = portals.filter((portal) => boxes.some(({ box }) => box.containsPoint(portal.position)));
    const blockedCheckpoints = checkpoints.filter((checkpoint) => boxes.some(({ box }) => box.containsPoint(checkpoint.position)));
    const unreachableCheckpoints = new Set(blockedCheckpoints.map((entry) => entry.userData.id));
    const maxSegmentDistance = Math.max(arena.width, arena.depth, arena.height * 2) * 0.72;
    for (let index = 1; index < checkpoints.length; index += 1) {
        if (checkpoints[index - 1].position.distanceTo(checkpoints[index].position) > maxSegmentDistance) {
            unreachableCheckpoints.add(checkpoints[index].userData.id);
        }
    }
    const unpairedPortals = portals.filter((portal) => {
        const partner = editor.mapManager?.getObjectById?.(String(portal.userData?.portalPartnerId || ''));
        return !partner || partner.userData?.type !== 'portal';
    });
    const assetText = String(editor.dom?.assetStatusText?.textContent || '');
    const assetsDegraded = /placeholder|fehler|timeout/i.test(assetText);

    return [
        { code: 'player-spawn', ok: status.playerSpawnPlaced, label: status.playerSpawnPlaced ? 'Spieler-Spawn vorhanden' : 'Spieler-Spawn fehlt', objectIds: [] },
        { code: 'bot-spawns', ok: status.botSpawnCount > 0, label: status.botSpawnCount > 0 ? `${status.botSpawnCount} Bot-Spawn(s)` : 'Keine Bot-Spawns', objectIds: [] },
        { code: 'portal-pairs', ok: portals.length % 2 === 0 && unpairedPortals.length === 0, label: unpairedPortals.length === 0 && portals.length % 2 === 0 ? 'Portale sind explizit gepaart' : `${Math.max(unpairedPortals.length, portals.length % 2)} Portal(e) ohne Partner`, objectIds: unpairedPortals.map((entry) => entry.userData.id) },
        { code: 'parcours-finish', ok: !status.parcoursEnabled || status.parcourHasFinish, label: !status.parcoursEnabled || status.parcourHasFinish ? 'Parcours ist vollstaendig' : 'Parcours-Finish fehlt', objectIds: [] },
        { code: 'outside-arena', ok: outside.length === 0, label: outside.length === 0 ? 'Objekte liegen im Arena-Rahmen' : `${outside.length} Objekt(e) ausserhalb der Arena`, objectIds: outside.map((entry) => entry.userData.id) },
        { code: 'spawn-overlap', ok: overlappingSpawns.size === 0, label: overlappingSpawns.size === 0 ? 'Spawn-Abstaende sind frei' : `${overlappingSpawns.size} Spawn(s) ueberlappen`, objectIds: [...overlappingSpawns] },
        { code: 'spawn-trapped', ok: trappedSpawns.length === 0, label: trappedSpawns.length === 0 ? 'Spawns sind nicht eingeschlossen' : `${trappedSpawns.length} Spawn(s) in Geometrie`, objectIds: trappedSpawns.map((entry) => entry.userData.id) },
        { code: 'portal-blocked', ok: blockedPortals.length === 0, label: blockedPortals.length === 0 ? 'Portalzentren sind frei' : `${blockedPortals.length} Portal(e) blockiert`, objectIds: blockedPortals.map((entry) => entry.userData.id) },
        { code: 'checkpoint-reachability', ok: unreachableCheckpoints.size === 0, label: unreachableCheckpoints.size === 0 ? 'Parcours-Segmente wirken erreichbar' : `${unreachableCheckpoints.size} Checkpoint(s) blockiert oder zu weit entfernt`, objectIds: [...unreachableCheckpoints] },
        { code: 'assets', ok: !assetsDegraded, label: assetsDegraded ? 'Assets verwenden Fallbacks' : 'Assets sind bereit', objectIds: [] },
    ];
}

function offsetClipboardPayload(editor, object, offset = null) {
    const payload = editor.createClipboardPayload(object);
    const delta = offset || new THREE.Vector3(editor.useSnap ? editor.snapSize : 30, 0, editor.useSnap ? editor.snapSize : 30);
    const position = object.position.clone().add(delta);
    if (payload.pointA?.isVector3) payload.pointA.add(delta);
    if (payload.pointB?.isVector3) payload.pointB.add(delta);
    delete payload.sourcePos;
    return { payload, position };
}

function normalizePrefabExtraProps(extraProps = {}) {
    const result = { ...extraProps };
    if (Array.isArray(result.pointA)) result.pointA = new THREE.Vector3().fromArray(result.pointA);
    if (Array.isArray(result.pointB)) result.pointB = new THREE.Vector3().fromArray(result.pointB);
    return result;
}

export function bindEditorWorkspaceControls(editor) {
    if (!editor) return;
    const dom = editor.dom || {};
    const markedIds = new Set();
    let dirty = false;
    let savedStateSignature = null;
    let autosaveTimer = null;
    let modalResolve = null;
    let lastStatus = 'Editor bereit.';
    let lastStatusLevel = 'info';
    let outlinerFrame = null;
    let workspaceFrame = null;
    let draggedCheckpointId = '';
    let lastIssueSignature = '';
    let pendingRecovery = readAutosave();
    let modalReturnFocus = null;
    const pageShell = document.querySelector('.wrap');

    const issueGroup = new THREE.Group();
    issueGroup.name = 'editor-problem-markers';
    issueGroup.userData.editorOverlay = true;
    editor.core.scene.add(issueGroup);
    const issueGeometry = new THREE.SphereGeometry(1, 10, 8);
    const issueMaterial = new THREE.MeshBasicMaterial({ color: 0xff3344, wireframe: true, depthTest: false, transparent: true, opacity: 0.9 });

    const notify = (message, level = 'info') => {
        lastStatus = String(message || '');
        lastStatusLevel = level;
        if (dom.workspaceStatusMessage) {
            dom.workspaceStatusMessage.textContent = lastStatus;
            dom.workspaceStatusMessage.dataset.level = lastStatusLevel;
        }
    };

    const updateIssueMarkers = (items) => {
        const issueIds = [...new Set(items.filter((item) => !item.ok).flatMap((item) => item.objectIds || []))].sort();
        const signature = issueIds.map((id) => {
            const object = editor.mapManager?.getObjectById?.(id);
            return `${id}:${Math.round(object?.position?.x || 0)},${Math.round(object?.position?.y || 0)},${Math.round(object?.position?.z || 0)}`;
        }).join('|');
        if (signature === lastIssueSignature) return;
        lastIssueSignature = signature;
        issueGroup.clear();
        for (const id of issueIds) {
            const object = editor.mapManager?.getObjectById?.(id);
            if (!object) continue;
            const marker = new THREE.Mesh(issueGeometry, issueMaterial);
            marker.position.copy(object.position);
            marker.scale.setScalar(55);
            marker.renderOrder = 100;
            marker.userData.problemForObjectId = id;
            issueGroup.add(marker);
        }
    };

    const renderValidation = () => {
        const items = buildValidationItems(editor);
        const warningCount = items.filter((item) => !item.ok).length;
        if (dom.validationStateBadge) {
            dom.validationStateBadge.textContent = warningCount === 0 ? 'Map bereit' : `${warningCount} Hinweis(e)`;
            dom.validationStateBadge.style.color = warningCount === 0 ? '#86efac' : '#fde68a';
        }
        if (dom.validationList) {
            const fragment = document.createDocumentFragment();
            for (const item of items) {
                const li = document.createElement('li');
                li.classList.toggle('is-warning', !item.ok);
                if (!item.ok && item.objectIds?.length) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = item.label;
                    button.addEventListener('click', () => {
                        const object = editor.mapManager?.getObjectById?.(item.objectIds[0]);
                        if (object) {
                            editor.selectObject(object);
                            editor.core.focusObject?.(object);
                        }
                    });
                    li.appendChild(button);
                } else li.textContent = item.label;
                fragment.appendChild(li);
            }
            dom.validationList.replaceChildren(fragment);
        }
        updateIssueMarkers(items);
        editor.lastValidationItems = items;
        return items;
    };

    const renderDirty = () => {
        if (!dom.dirtyStateBadge) return;
        dom.dirtyStateBadge.textContent = dirty ? 'Ungespeichert' : 'Gespeichert';
        dom.dirtyStateBadge.style.color = dirty ? '#fde68a' : '#86efac';
    };

    const createDocument = (jsonText) => createEditorAuthoringDocument({
        map: JSON.parse(jsonText),
        workspaceMetadata: cloneWorkspaceMetadata(editor),
        layerState: editor.captureLayerState?.(),
        viewState: editor.captureEditorViewState?.(),
    });

    const captureStateSignature = () => {
        if (!editor.mapManager) return null;
        return JSON.stringify([
            editor.mapManager.generateJSONExport(editor.getArenaSizeForExport()),
            cloneWorkspaceMetadata(editor),
            editor.captureLayerState?.() || null,
        ]);
    };

    const writeAutosave = () => {
        if (!dirty || !editor.mapManager || pendingRecovery) return;
        try {
            const json = editor.mapManager.generateJSONExport(editor.getArenaSizeForExport());
            const documentValue = createDocument(json);
            localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify({
                savedAt: new Date().toISOString(), json,
                workspaceMetadata: documentValue.authoring.workspaceMetadata,
                layerState: documentValue.authoring.layerState,
                viewState: documentValue.authoring.viewState,
            }));
            notify('Arbeitsstand automatisch gesichert.', 'success');
        } catch (error) { notify(`Autosave fehlgeschlagen: ${error.message}`, 'error'); }
    };

    const scheduleAutosave = () => {
        if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
        autosaveTimer = window.setTimeout(() => { autosaveTimer = null; writeAutosave(); }, AUTOSAVE_DELAY_MS);
    };

    const markDirty = (reason = 'Map geaendert.') => {
        dirty = true;
        renderDirty();
        notify(reason, 'info');
        scheduleAutosave();
    };

    const markSaved = (message = 'Map gespeichert.') => {
        savedStateSignature = captureStateSignature();
        dirty = false;
        renderDirty();
        if (!pendingRecovery) {
            removeAutosave();
            dom.recoveryBanner?.classList.remove('is-visible');
        }
        notify(message, 'success');
    };

    const initializeSavedState = () => {
        savedStateSignature = captureStateSignature();
        dirty = false;
        renderDirty();
    };

    const reconcileDirtyState = (reason) => {
        const currentStateSignature = captureStateSignature();
        if (savedStateSignature !== null && currentStateSignature === savedStateSignature) {
            dirty = false;
            renderDirty();
            if (!pendingRecovery) removeAutosave();
            notify(`${reason} Gespeicherter Stand wiederhergestellt.`, 'success');
            return false;
        }
        markDirty(reason);
        return true;
    };

    const getFilteredObjects = () => {
        const query = String(dom.objectSearch?.value || '').trim().toLocaleLowerCase('de');
        const typeFilter = String(dom.objectTypeFilter?.value || '');
        return listObjects(editor).filter((object) => {
            const type = String(object.userData?.type || '');
            if (typeFilter && type !== typeFilter) return false;
            if (!query) return true;
            return `${object.userData?.id || ''} ${formatObjectLabel(object)} ${object.userData?.groupId || ''} ${object.userData?.editorLayerId || ''}`
                .toLocaleLowerCase('de').includes(query);
        });
    };

    const updateMarkedActions = () => {
        const hasLockedObject = [...markedIds].some((id) => editor.isObjectLocked?.(editor.mapManager?.getObjectById?.(id)));
        if (dom.btnGroupMarked) dom.btnGroupMarked.disabled = markedIds.size < 2 || hasLockedObject;
        if (dom.btnDeleteMarked) dom.btnDeleteMarked.disabled = markedIds.size === 0 || hasLockedObject;
        if (dom.btnDuplicateMarked) dom.btnDuplicateMarked.disabled = markedIds.size === 0;
        if (dom.btnTransformMarked) dom.btnTransformMarked.disabled = markedIds.size === 0 || hasLockedObject;
    };

    const renderOutliner = () => {
        outlinerFrame = null;
        if (!dom.objectList) return;
        const allObjects = listObjects(editor);
        const objects = getFilteredObjects();
        markedIds.forEach((id) => { if (!editor.mapManager?.hasObjectId?.(id)) markedIds.delete(id); });
        const viewportHeight = dom.objectList.clientHeight || 220;
        const visibleCount = Math.ceil(viewportHeight / OUTLINER_ROW_HEIGHT) + OUTLINER_OVERSCAN * 2;
        const startIndex = Math.min(
            Math.max(0, objects.length - visibleCount),
            Math.max(0, Math.floor(dom.objectList.scrollTop / OUTLINER_ROW_HEIGHT) - OUTLINER_OVERSCAN),
        );
        const endIndex = Math.min(objects.length, startIndex + visibleCount);
        const fragment = document.createDocumentFragment();
        if (objects.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'objectListEmpty';
            empty.textContent = allObjects.length === 0 ? 'Noch keine Objekte platziert.' : 'Keine passenden Objekte.';
            fragment.appendChild(empty);
        } else {
            const topSpacer = document.createElement('div');
            topSpacer.className = 'objectListSpacer';
            topSpacer.style.height = `${startIndex * OUTLINER_ROW_HEIGHT}px`;
            fragment.appendChild(topSpacer);
        }

        for (const object of objects.slice(startIndex, endIndex)) {
            const id = String(object.userData?.id || '');
            const row = document.createElement('div');
            row.className = 'objectRow';
            if (object.userData?.type === 'checkpoint') {
                row.draggable = true;
                row.addEventListener('dragstart', () => { draggedCheckpointId = id; });
                row.addEventListener('dragover', (event) => event.preventDefault());
                row.addEventListener('drop', (event) => {
                    event.preventDefault();
                    if (!draggedCheckpointId || draggedCheckpointId === id) return;
                    editor.executeHistoryMutation('Reorder checkpoint', () => editor.reorderCheckpointById?.(draggedCheckpointId, id));
                    draggedCheckpointId = '';
                });
            }

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = markedIds.has(id);
            checkbox.setAttribute('aria-label', `${id} fuer Mehrfachaktion markieren`);
            checkbox.addEventListener('change', () => {
                const groupId = String(object.userData?.groupId || '');
                const affected = groupId ? allObjects.filter((entry) => entry.userData?.groupId === groupId) : [object];
                affected.forEach((entry) => checkbox.checked ? markedIds.add(entry.userData.id) : markedIds.delete(entry.userData.id));
                updateMarkedActions();
            });

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'objectRowMain';
            button.classList.toggle('active', editor.selectedObject === object);
            const flags = [object.userData?.editorLocked || object.userData?.editorLayerLocked ? 'gesperrt' : '', object.visible === false ? 'ausgeblendet' : '', object.userData?.groupId ? `Gruppe ${object.userData.groupId}` : '', object.userData?.editorLayerId || ''].filter(Boolean).join(', ');
            button.textContent = `${formatObjectLabel(object)} · ${id}`;
            button.title = flags || `${Math.round(object.position.x)}, ${Math.round(object.position.y)}, ${Math.round(object.position.z)}`;
            button.addEventListener('click', () => editor.selectObject(object));
            button.addEventListener('dblclick', () => editor.core.focusObject?.(object));

            const meta = document.createElement('span');
            meta.className = 'objectRowMeta';
            meta.textContent = `${object.visible === false ? '○' : '●'}${object.userData?.editorLocked || object.userData?.editorLayerLocked ? ' L' : ''}`;
            row.append(checkbox, button, meta);
            fragment.appendChild(row);
        }
        if (objects.length > 0) {
            const bottomSpacer = document.createElement('div');
            bottomSpacer.className = 'objectListSpacer';
            bottomSpacer.style.height = `${Math.max(0, objects.length - endIndex) * OUTLINER_ROW_HEIGHT}px`;
            fragment.appendChild(bottomSpacer);
        }
        dom.objectList.replaceChildren(fragment);

        const selected = editor.selectedObject && editor.isManagedObjectAlive(editor.selectedObject) ? editor.selectedObject : null;
        if (dom.btnDelSelected) dom.btnDelSelected.disabled = !selected || editor.isObjectLocked?.(selected);
        if (dom.btnDuplicateSelected) dom.btnDuplicateSelected.disabled = !selected;
        if (dom.btnToggleSelectedVisibility) {
            dom.btnToggleSelectedVisibility.disabled = !selected;
            dom.btnToggleSelectedVisibility.textContent = selected?.userData?.editorObjectVisible === false ? 'Einblenden' : 'Ausblenden';
        }
        if (dom.btnToggleSelectedLock) {
            dom.btnToggleSelectedLock.disabled = !selected;
            dom.btnToggleSelectedLock.textContent = selected?.userData?.editorLocked ? 'Entsperren' : 'Sperren';
        }
        updateMarkedActions();
    };

    const scheduleOutliner = () => {
        if (outlinerFrame !== null) return;
        outlinerFrame = window.requestAnimationFrame(renderOutliner);
    };

    const refresh = () => {
        renderDirty();
        editor.refreshLayerState?.();
        editor.initializeRelationships?.();
        editor.updateRelationshipVisuals?.();
        renderValidation();
        renderOutliner();
        notify(lastStatus, lastStatusLevel);
    };

    const scheduleRefresh = () => {
        if (workspaceFrame !== null) return;
        workspaceFrame = window.requestAnimationFrame(() => { workspaceFrame = null; refresh(); });
    };

    const closeModal = (result) => {
        dom.editorModalBackdrop?.classList.remove('is-open');
        dom.editorModalBackdrop?.setAttribute('aria-hidden', 'true');
        if (pageShell) pageShell.inert = false;
        const resolve = modalResolve;
        modalResolve = null;
        resolve?.(result);
        modalReturnFocus?.focus?.();
        modalReturnFocus = null;
    };

    const openModal = ({ title, message, confirmLabel = 'Bestaetigen', value = null, danger = false } = {}) => {
        if (!dom.editorModalBackdrop || modalResolve) return Promise.resolve(null);
        dom.editorModalTitle.textContent = title || 'Bestaetigen';
        dom.editorModalMessage.textContent = message || '';
        dom.btnEditorModalConfirm.textContent = confirmLabel;
        dom.btnEditorModalConfirm.classList.toggle('dangerAction', danger);
        const hasInput = value !== null;
        dom.editorModalInput.hidden = !hasInput;
        dom.editorModalInput.value = hasInput ? String(value || '') : '';
        modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (pageShell) pageShell.inert = true;
        dom.editorModalBackdrop.setAttribute('aria-hidden', 'false');
        dom.editorModalBackdrop.classList.add('is-open');
        window.setTimeout(() => (hasInput ? dom.editorModalInput : dom.btnEditorModalConfirm)?.focus(), 0);
        return new Promise((resolve) => {
            modalResolve = (confirmed) => resolve(confirmed ? (hasInput ? String(dom.editorModalInput.value || '').trim() : true) : null);
        });
    };

    const duplicateObjects = (objects) => {
        const offset = new THREE.Vector3(editor.useSnap ? editor.snapSize : 30, 0, editor.useSnap ? editor.snapSize : 30);
        const newGroupId = objects.length > 1 ? `group_${Date.now().toString(36)}` : '';
        const idMap = new Map();
        const duplicates = [];
        for (const object of objects) {
            const { payload, position } = offsetClipboardPayload(editor, object, offset);
            if (newGroupId) payload.groupId = newGroupId;
            const duplicate = editor.mapManager.createMesh(payload.type, payload.subType, position.x, position.y, position.z, payload.sizeInfo, payload);
            if (duplicate) {
                idMap.set(object.userData.id, duplicate.userData.id);
                duplicates.push(duplicate);
            }
        }
        duplicates.forEach((duplicate) => {
            const oldPartner = String(duplicate.userData?.portalPartnerId || '');
            if (idMap.has(oldPartner)) duplicate.userData.portalPartnerId = idMap.get(oldPartner);
        });
        editor.updateRelationshipVisuals?.();
        return duplicates;
    };

    const transformMarked = ({ dx, dy, dz, rotationDegrees, scale }) => {
        const objects = [...markedIds].map((id) => editor.mapManager?.getObjectById?.(id)).filter(Boolean);
        if (!objects.length) return;
        const center = new THREE.Vector3();
        objects.forEach((object) => center.add(object.position));
        center.multiplyScalar(1 / objects.length);
        const radians = rotationDegrees * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        for (const object of objects) {
            const relX = (object.position.x - center.x) * scale;
            const relY = (object.position.y - center.y) * scale;
            const relZ = (object.position.z - center.z) * scale;
            object.position.set(
                center.x + relX * cos - relZ * sin + dx,
                center.y + relY + dy,
                center.z + relX * sin + relZ * cos + dz,
            );
            object.rotation.y += radians;
            object.scale.multiplyScalar(scale);
            editor.mapManager.notifyObjectMutated(object, { workspace: false });
        }
    };

    const renderPrefabs = () => {
        if (!dom.prefabList) return;
        const fragment = document.createDocumentFragment();
        for (const prefab of EDITOR_PREFABS) {
            const card = document.createElement('div');
            card.className = 'prefabCard';
            const text = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = prefab.label;
            const description = document.createElement('small');
            description.textContent = prefab.description;
            text.append(title, description);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'small';
            button.textContent = 'Einsetzen';
            button.addEventListener('click', () => {
                const selectedPrefab = getEditorPrefabById(prefab.id);
                if (!selectedPrefab || !editor.mapManager) return;
                if (selectedPrefab.parts.some((part) => editor.isLayerLocked?.(getDefaultEditorLayerId(part.type)))) {
                    notify('Eine von der Vorlage verwendete Ebene ist gesperrt.', 'warn');
                    return;
                }
                const anchor = editor.core.orbit.target;
                editor.executeHistoryMutation(`Insert prefab ${prefab.label}`, () => {
                    const groupId = `prefab_${prefab.id}_${Date.now().toString(36)}`;
                    editor.mapManager.withSceneMutation(() => {
                        for (const part of selectedPrefab.parts) {
                            const extra = normalizePrefabExtraProps(part.extraProps);
                            if (extra.pointA) extra.pointA.add(new THREE.Vector3(anchor.x, 0, anchor.z));
                            if (extra.pointB) extra.pointB.add(new THREE.Vector3(anchor.x, 0, anchor.z));
                            editor.mapManager.createMesh(part.type, part.subType, anchor.x + part.x, part.y, anchor.z + part.z, part.sizeInfo, {
                                ...extra,
                                groupId,
                                editorLayerId: getDefaultEditorLayerId(part.type),
                            });
                        }
                    });
                    editor.normalizeCheckpointOrder?.();
                });
                notify(`${prefab.label} eingesetzt.`, 'success');
            });
            card.append(text, button);
            fragment.appendChild(card);
        }
        dom.prefabList.replaceChildren(fragment);
    };

    dom.btnEditorModalCancel?.addEventListener('click', () => closeModal(false));
    dom.btnEditorModalConfirm?.addEventListener('click', () => closeModal(true));
    dom.editorModalBackdrop?.addEventListener('click', (event) => { if (event.target === dom.editorModalBackdrop) closeModal(false); });
    dom.editorModalBackdrop?.addEventListener('keydown', (event) => {
        if (!modalResolve) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeModal(false);
            return;
        }
        if (event.key === 'Enter' && event.target === dom.editorModalInput) {
            event.preventDefault();
            closeModal(true);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...dom.editorModalBackdrop.querySelectorAll('button:not([disabled]), input:not([disabled]):not([hidden])')];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
    dom.objectSearch?.addEventListener('input', renderOutliner);
    dom.objectTypeFilter?.addEventListener('change', renderOutliner);
    dom.objectList?.addEventListener('scroll', scheduleOutliner, { passive: true });

    dom.btnDuplicateSelected?.addEventListener('click', () => {
        const selected = editor.selectedObject;
        if (!selected || !editor.isManagedObjectAlive(selected)) return;
        editor.executeHistoryMutation('Duplicate object', () => {
            const [duplicate] = duplicateObjects([selected]);
            if (duplicate) editor.selectObject(duplicate);
        });
    });

    dom.btnToggleSelectedVisibility?.addEventListener('click', () => {
        const selected = editor.selectedObject;
        if (!selected || !editor.isManagedObjectAlive(selected)) return;
        editor.executeHistoryMutation('Toggle object visibility', () => {
            const current = typeof selected.userData.editorObjectVisible === 'boolean' ? selected.userData.editorObjectVisible : selected.visible !== false;
            selected.userData.editorObjectVisible = !current;
            editor.refreshLayerState?.();
            editor.mapManager.notifyObjectMutated(selected);
        });
    });

    dom.btnToggleSelectedLock?.addEventListener('click', () => {
        const selected = editor.selectedObject;
        if (!selected || !editor.isManagedObjectAlive(selected)) return;
        editor.executeHistoryMutation('Toggle object lock', () => {
            selected.userData.editorLocked = selected.userData.editorLocked !== true;
            editor.syncTransformControlAttachment();
            editor.mapManager.notifyObjectMutated(selected);
            editor.showPropPanel(selected);
        });
    });

    dom.btnGroupMarked?.addEventListener('click', () => {
        const objects = [...markedIds].map((id) => editor.mapManager?.getObjectById?.(id)).filter(Boolean);
        if (objects.some((object) => editor.isObjectLocked?.(object))) {
            notify('Gesperrte Objekte koennen nicht gruppiert werden.', 'warn');
            return;
        }
        const groupId = `group_${Date.now().toString(36)}`;
        editor.executeHistoryMutation('Group objects', () => editor.mapManager.withSceneMutation(() => {
            markedIds.forEach((id) => {
                const object = editor.mapManager.getObjectById(id);
                if (object) { object.userData.groupId = groupId; editor.mapManager.notifyObjectMutated(object); }
            });
        }));
        notify(`${markedIds.size} Objekte gruppiert.`, 'success');
    });

    dom.btnDuplicateMarked?.addEventListener('click', () => editor.executeHistoryMutation('Duplicate group', () => {
        const objects = [...markedIds].map((id) => editor.mapManager?.getObjectById?.(id)).filter(Boolean);
        const duplicates = duplicateObjects(objects);
        markedIds.clear();
        duplicates.forEach((object) => markedIds.add(object.userData.id));
    }));

    dom.btnTransformMarked?.addEventListener('click', async () => {
        const objects = [...markedIds].map((id) => editor.mapManager?.getObjectById?.(id)).filter(Boolean);
        if (objects.some((object) => editor.isObjectLocked?.(object))) {
            notify('Gesperrte Objekte koennen nicht transformiert werden.', 'warn');
            return;
        }
        const value = await openModal({
            title: 'Gruppe transformieren',
            message: 'Werte als X, Y, Z, Rotation in Grad, Skalierung eingeben.',
            confirmLabel: 'Anwenden', value: '0, 0, 0, 0, 1',
        });
        if (value === null) return;
        const values = value.split(/[;,\s]+/).filter(Boolean).map(Number);
        if (values.length !== 5 || values.some((entry) => !Number.isFinite(entry)) || values[4] <= 0) {
            notify('Bitte genau fuenf gueltige Werte und eine Skalierung groesser 0 eingeben.', 'error');
            return;
        }
        editor.executeHistoryMutation('Transform group', () => transformMarked({ dx: values[0], dy: values[1], dz: values[2], rotationDegrees: values[3], scale: values[4] }));
    });

    dom.btnDeleteMarked?.addEventListener('click', async () => {
        const objects = [...markedIds].map((id) => editor.mapManager?.getObjectById?.(id)).filter(Boolean);
        if (objects.some((object) => editor.isObjectLocked?.(object))) {
            notify('Gesperrte Objekte koennen nicht geloescht werden.', 'warn');
            return;
        }
        const confirmed = await openModal({ title: 'Markierte Objekte loeschen?', message: `${markedIds.size} Objekt(e) werden aus der Map entfernt.`, confirmLabel: 'Objekte loeschen', danger: true });
        if (!confirmed) return;
        editor.executeHistoryMutation('Delete marked objects', () => editor.mapManager.withSceneMutation(() => {
            for (const id of [...markedIds]) {
                const object = editor.mapManager.getObjectById(id);
                if (object) editor.mapManager.removeObject(object);
            }
            markedIds.clear();
        }));
    });

    [['perspective', dom.btnViewPerspective], ['top', dom.btnViewTop], ['front', dom.btnViewFront], ['side', dom.btnViewSide]]
        .forEach(([mode, button]) => button?.addEventListener('click', () => {
            editor.core.setViewMode?.(mode);
            notify(`Kamera: ${mode}.`, 'info');
        }));
    dom.btnFocusSelection?.addEventListener('click', () => {
        if (!editor.core.focusObject?.(editor.selectedObject)) notify('Bitte zuerst ein Objekt auswaehlen.', 'warn');
    });

    dom.btnRestoreAutosave?.addEventListener('click', () => {
        const autosave = pendingRecovery;
        if (!autosave) return;
        try {
            editor.executeHistoryMutation('Restore autosave', () => {
                editor.mapManager.importFromJSON(autosave.json, { onArenaSize: (arenaSize) => { editor.setArenaSizeInputs(arenaSize); editor.syncArenaValues?.(); } });
                applyWorkspaceMetadata(editor, autosave.workspaceMetadata);
                editor.applyLayerState?.(autosave.layerState);
                editor.restoreEditorViewState?.(autosave.viewState);
            });
            pendingRecovery = null;
            removeAutosave();
            dom.recoveryBanner?.classList.remove('is-visible');
            markDirty('Autosave wiederhergestellt.');
        } catch (error) { notify(`Autosave konnte nicht geladen werden: ${error.message}`, 'error'); }
    });
    dom.btnDismissAutosave?.addEventListener('click', () => {
        pendingRecovery = null;
        removeAutosave();
        dom.recoveryBanner?.classList.remove('is-visible');
        notify('Autosave verworfen.', 'info');
        if (dirty) scheduleAutosave();
    });
    window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

    editor.captureEditorViewState = () => ({
        camera: editor.core.captureViewState?.() || null,
        selectedObjectId: editor.selectedObject?.userData?.id || null,
    });
    editor.restoreEditorViewState = (state) => {
        if (!state) return false;
        editor.core.restoreViewState?.(state.camera);
        const selected = state.selectedObjectId ? editor.mapManager?.getObjectById?.(state.selectedObjectId) : null;
        if (selected) editor.selectObject(selected);
        return true;
    };
    editor.capturePlaytestReturnState = () => {
        try {
            const json = editor.mapManager.generateJSONExport(editor.getArenaSizeForExport());
            localStorage.setItem(PLAYTEST_RETURN_STORAGE_KEY, JSON.stringify({
                savedAt: new Date().toISOString(),
                dirty,
                viewState: editor.captureEditorViewState(),
                editorDocument: editor.createEditorDocument(json),
                issues: (editor.lastValidationItems || []).filter((item) => !item.ok).map((item) => ({ code: item.code, objectIds: item.objectIds })),
            }));
            return true;
        } catch { return false; }
    };
    editor.createEditorDocument = createDocument;
    editor.resolveEditorImportText = (text) => {
        const parsed = parseEditorAuthoringDocument(text);
        return { ...parsed, jsonText: JSON.stringify(parsed.map, null, 2) };
    };
    editor.applyEditorImportState = (parsed) => {
        applyWorkspaceMetadata(editor, parsed?.workspaceMetadata);
        editor.applyLayerState?.(parsed?.layerState);
        editor.restoreEditorViewState?.(parsed?.viewState);
    };
    editor.restorePlaytestReturnIfRequested = () => {
        if (!new URLSearchParams(window.location.search).has('returnFromPlaytest') || !editor.mapManager) return false;
        try {
            const stored = JSON.parse(localStorage.getItem(PLAYTEST_RETURN_STORAGE_KEY) || 'null');
            if (!stored?.editorDocument) return false;
            const parsed = parseEditorAuthoringDocument(stored.editorDocument);
            editor.withHistorySuspended(() => {
                editor.mapManager.importFromJSON(JSON.stringify(parsed.map), {
                    onArenaSize: (arenaSize) => { editor.setArenaSizeInputs(arenaSize); editor.syncArenaValues?.(); },
                });
                applyWorkspaceMetadata(editor, parsed.workspaceMetadata);
                editor.applyLayerState?.(parsed.layerState);
                editor.restoreEditorViewState?.(stored.viewState || parsed.viewState);
            });
            const restoreMessage = 'Playtest-Arbeitsstand und Kamera wiederhergestellt; Probleme sind markiert.';
            if (stored.dirty === false) markSaved(restoreMessage);
            else markDirty(restoreMessage);
            renderValidation();
            return true;
        } catch (error) {
            notify(`Playtest-Rueckkehr konnte nicht wiederhergestellt werden: ${error.message}`, 'error');
            return false;
        }
    };
    editor.markDirty = markDirty;
    editor.markSaved = markSaved;
    editor.initializeSavedState = initializeSavedState;
    editor.reconcileDirtyState = reconcileDirtyState;
    editor.notify = notify;
    editor.refreshWorkspace = refresh;
    editor.scheduleWorkspaceRefresh = scheduleRefresh;
    editor.renderWorkspaceValidation = renderValidation;
    editor.captureWorkspaceMetadata = () => cloneWorkspaceMetadata(editor);
    editor.applyWorkspaceMetadata = (metadata) => applyWorkspaceMetadata(editor, metadata);
    editor.isDirty = () => dirty;
    editor.confirmAction = (options) => openModal(options);
    editor.requestText = (options) => openModal(options);

    renderPrefabs();
    dom.recoveryBanner?.classList.toggle('is-visible', !!pendingRecovery);
    refresh();
}
