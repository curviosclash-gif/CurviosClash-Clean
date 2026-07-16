export function readArenaSizeInputs(editor, fallback = {}) {
    const dom = editor?.dom || {};
    const positive = (value, fallbackValue) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
    };
    return {
        width: positive(dom.numArenaW?.value, fallback.width || 2800),
        depth: positive(dom.numArenaD?.value, fallback.depth || 2400),
        height: positive(dom.numArenaH?.value, fallback.height || 950)
    };
}

export function writeArenaSizeInputs(editor, arenaSize) {
    if (!editor || !arenaSize) return;
    const dom = editor.dom || {};

    if (Number.isFinite(Number(arenaSize.width)) && dom.numArenaW) {
        dom.numArenaW.value = arenaSize.width;
    }
    if (Number.isFinite(Number(arenaSize.depth)) && dom.numArenaD) {
        dom.numArenaD.value = arenaSize.depth;
    }
    if (Number.isFinite(Number(arenaSize.height)) && dom.numArenaH) {
        dom.numArenaH.value = arenaSize.height;
    }
}

export function isFlyModeChecked(editor) {
    return !!editor?.dom?.chkFly?.checked;
}

export function isYLayerEnabled(editor) {
    return !!editor?.dom?.chkYLayer?.checked;
}

export function getYLayerValue(editor, fallback = 0) {
    const value = Number.parseFloat(editor?.dom?.numYLayer?.value);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(Number(editor?.ARENA_H) || value, value));
}

export function getCurrentToolSubtype(editor) {
    if (!editor) return null;
    const dockEntry = editor.toolDockState?.getActiveEntry?.();
    if (editor.currentTool !== 'select' && dockEntry && dockEntry.tool === editor.currentTool) {
        return dockEntry.subType || null;
    }
    const dom = editor.dom || {};
    if (editor.currentTool === 'spawn') return dom.selSpawnType?.value || null;
    if (editor.currentTool === 'tunnel') return dom.selTunnelType?.value || null;
    if (editor.currentTool === 'portal') return dom.selPortalType?.value || null;
    if (editor.currentTool === 'item') return dom.selItemType?.value || null;
    if (editor.currentTool === 'aircraft') return dom.selAircraftType?.value || null;
    return null;
}

export function getJsonEditorText(editor) {
    return editor?.dom?.jsonOutput?.value || '';
}

export function setJsonEditorText(editor, value) {
    if (editor?.dom?.jsonOutput) {
        editor.dom.jsonOutput.value = String(value ?? '');
    }
}

const PROPERTY_FIELD_MAP = Object.freeze({
    x: 'propX',
    y: 'propY',
    z: 'propZ',
    rotationY: 'propRotationY',
    size: 'propSize',
    width: 'propWidth',
    depth: 'propDepth',
    height: 'propHeight',
    scale: 'propScale'
});

export function readPropertyFieldNumber(editor, field, fallback = 0) {
    const domKey = PROPERTY_FIELD_MAP[field];
    if (!domKey) return fallback;
    const value = parseFloat(editor?.dom?.[domKey]?.value);
    return Number.isFinite(value) ? value : fallback;
}

export function readPositivePropertyFieldNumber(editor, field, fallback = 1) {
    const value = readPropertyFieldNumber(editor, field, fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function writePropertyFieldValue(editor, field, value) {
    const domKey = PROPERTY_FIELD_MAP[field];
    if (!domKey) return;
    const input = editor?.dom?.[domKey];
    if (input) input.value = String(value ?? '');
}
