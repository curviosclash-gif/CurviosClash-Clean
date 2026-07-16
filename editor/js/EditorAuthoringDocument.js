export const EDITOR_AUTHORING_DOCUMENT_VERSION = 'curvios-editor-document.v1';

export const EDITOR_LAYER_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'geometry', label: 'Geometrie' }),
    Object.freeze({ id: 'gameplay', label: 'Gameplay' }),
    Object.freeze({ id: 'spawns', label: 'Spawns' }),
    Object.freeze({ id: 'portals', label: 'Portale' }),
    Object.freeze({ id: 'pickups', label: 'Pickups' }),
    Object.freeze({ id: 'decoration', label: 'Dekoration' }),
]);

const LAYER_IDS = new Set(EDITOR_LAYER_DEFINITIONS.map((entry) => entry.id));

export function getDefaultEditorLayerId(type) {
    if (type === 'hard' || type === 'foam' || type === 'tunnel') return 'geometry';
    if (type === 'spawn') return 'spawns';
    if (type === 'portal') return 'portals';
    if (type === 'item') return 'pickups';
    if (type === 'aircraft' || type === 'glb') return 'decoration';
    return 'gameplay';
}

export function createDefaultLayerState() {
    return {
        activeLayerId: 'geometry',
        layers: Object.fromEntries(EDITOR_LAYER_DEFINITIONS.map((entry) => [entry.id, {
            visible: true,
            locked: false,
            solo: false,
        }])),
    };
}

export function normalizeLayerState(value = {}) {
    const result = createDefaultLayerState();
    const activeLayerId = String(value?.activeLayerId || '');
    if (LAYER_IDS.has(activeLayerId)) result.activeLayerId = activeLayerId;
    for (const definition of EDITOR_LAYER_DEFINITIONS) {
        const source = value?.layers?.[definition.id];
        if (!source || typeof source !== 'object') continue;
        result.layers[definition.id] = {
            visible: source.visible !== false,
            locked: source.locked === true,
            solo: source.solo === true,
        };
    }
    return result;
}

export function normalizeWorkspaceMetadata(value = {}) {
    const result = {};
    if (!value || typeof value !== 'object') return result;
    for (const [id, source] of Object.entries(value)) {
        if (!id || !source || typeof source !== 'object') continue;
        const editorLayerId = LAYER_IDS.has(source.editorLayerId)
            ? source.editorLayerId
            : getDefaultEditorLayerId(source.type);
        result[id] = {
            groupId: String(source.groupId || ''),
            locked: source.locked === true,
            visible: source.visible !== false,
            editorLayerId,
            portalPartnerId: String(source.portalPartnerId || ''),
            checkpointOrder: source.checkpointOrder !== null && source.checkpointOrder !== '' && Number.isFinite(Number(source.checkpointOrder))
                ? Number(source.checkpointOrder)
                : null,
        };
    }
    return result;
}

export function createEditorAuthoringDocument({ map, workspaceMetadata = {}, layerState = {}, viewState = null } = {}) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
        throw new Error('Editor-Dokument benoetigt ein gueltiges Map-Objekt.');
    }
    return {
        contractVersion: EDITOR_AUTHORING_DOCUMENT_VERSION,
        map,
        authoring: {
            workspaceMetadata: normalizeWorkspaceMetadata(workspaceMetadata),
            layerState: normalizeLayerState(layerState),
            viewState: viewState && typeof viewState === 'object' ? viewState : null,
        },
    };
}

export function parseEditorAuthoringDocument(input) {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Editor-Dokument ist kein JSON-Objekt.');
    }

    if (value.contractVersion !== EDITOR_AUTHORING_DOCUMENT_VERSION || !value.map) {
        return {
            isAuthoringDocument: false,
            map: value,
            workspaceMetadata: {},
            layerState: createDefaultLayerState(),
            viewState: null,
        };
    }

    return {
        isAuthoringDocument: true,
        map: value.map,
        workspaceMetadata: normalizeWorkspaceMetadata(value.authoring?.workspaceMetadata),
        layerState: normalizeLayerState(value.authoring?.layerState),
        viewState: value.authoring?.viewState && typeof value.authoring.viewState === 'object'
            ? value.authoring.viewState
            : null,
    };
}
