import {
    EDITOR_LAYER_DEFINITIONS,
    createDefaultLayerState,
    getDefaultEditorLayerId,
    normalizeLayerState,
} from '../EditorAuthoringDocument.js';

function listObjects(editor) {
    return Array.from(editor?.core?.objectsContainer?.children || [])
        .filter((object) => editor.isManagedObjectAlive(object));
}

export function bindEditorLayerControls(editor) {
    if (!editor) return;
    const dom = editor.dom || {};
    let state = createDefaultLayerState();

    const applyLayerState = () => {
        const soloIds = EDITOR_LAYER_DEFINITIONS
            .filter((entry) => state.layers[entry.id].solo)
            .map((entry) => entry.id);
        for (const object of listObjects(editor)) {
            const layerId = object.userData.editorLayerId || getDefaultEditorLayerId(object.userData?.type);
            object.userData.editorLayerId = layerId;
            if (typeof object.userData.editorObjectVisible !== 'boolean') {
                object.userData.editorObjectVisible = object.visible !== false;
            }
            const layer = state.layers[layerId] || state.layers.gameplay;
            const layerVisible = layer.visible && (soloIds.length === 0 || soloIds.includes(layerId));
            object.userData.editorLayerHidden = !layerVisible;
            object.userData.editorLayerLocked = layer.locked === true;
            object.visible = object.userData.editorObjectVisible !== false && layerVisible;
        }
        editor.syncTransformControlAttachment?.();
        if (editor.selectedObject) editor.showPropPanel?.(editor.selectedObject);
        editor.updateRelationshipVisuals?.();
    };

    const render = () => {
        if (!dom.layerList) return;
        const fragment = document.createDocumentFragment();
        for (const definition of EDITOR_LAYER_DEFINITIONS) {
            const layer = state.layers[definition.id];
            const row = document.createElement('div');
            row.className = 'layerRow';
            row.dataset.layerId = definition.id;
            row.classList.toggle('active', state.activeLayerId === definition.id);

            const select = document.createElement('button');
            select.type = 'button';
            select.className = 'small';
            select.textContent = definition.label;
            select.title = 'Als aktive Platzierungs-Ebene verwenden';
            select.addEventListener('click', () => {
                state.activeLayerId = definition.id;
                render();
                editor.markDirty?.(`Aktive Ebene: ${definition.label}.`);
            });

            const visibility = document.createElement('button');
            visibility.type = 'button';
            visibility.className = 'small';
            visibility.textContent = layer.visible ? 'Auge' : 'Aus';
            visibility.setAttribute('aria-label', `${definition.label} ${layer.visible ? 'ausblenden' : 'einblenden'}`);
            visibility.addEventListener('click', () => editor.executeHistoryMutation('Toggle layer visibility', () => {
                layer.visible = !layer.visible;
                applyLayerState();
                render();
            }));

            const lock = document.createElement('button');
            lock.type = 'button';
            lock.className = 'small';
            lock.textContent = layer.locked ? 'Fest' : 'Frei';
            lock.setAttribute('aria-label', `${definition.label} ${layer.locked ? 'entsperren' : 'sperren'}`);
            lock.addEventListener('click', () => editor.executeHistoryMutation('Toggle layer lock', () => {
                layer.locked = !layer.locked;
                applyLayerState();
                render();
            }));

            const solo = document.createElement('button');
            solo.type = 'button';
            solo.className = 'small';
            solo.textContent = layer.solo ? 'Solo an' : 'Solo';
            solo.setAttribute('aria-pressed', layer.solo ? 'true' : 'false');
            solo.addEventListener('click', () => editor.executeHistoryMutation('Toggle layer solo', () => {
                layer.solo = !layer.solo;
                applyLayerState();
                render();
            }));
            row.append(select, visibility, lock, solo);
            fragment.appendChild(row);
        }
        dom.layerList.replaceChildren(fragment);
    };

    editor.captureLayerState = () => normalizeLayerState(state);
    editor.applyLayerState = (nextState) => {
        state = normalizeLayerState(nextState);
        applyLayerState();
        render();
    };
    editor.refreshLayerState = () => {
        applyLayerState();
        render();
    };
    editor.getActiveLayerMetadata = (type) => ({
        editorLayerId: state.activeLayerId || getDefaultEditorLayerId(type),
        editorObjectVisible: true,
    });
    editor.isLayerLocked = (layerId) => state.layers[layerId]?.locked === true;
    editor.isActiveLayerLocked = () => editor.isLayerLocked(state.activeLayerId);
    editor.mapManager?.setAuthoringMetadataProvider?.((type) => editor.getActiveLayerMetadata(type));
    render();
}
