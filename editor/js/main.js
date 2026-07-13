import { EditorCore } from './EditorCore.js';
import { EditorAssetLoader } from './EditorAssetLoader.js';
import { EditorUI } from './EditorUI.js';
import { EditorMapManager } from './EditorMapManager.js';
import {
    getEditorBuildCatalogDescriptor,
    resolveEditorTemplateImportCapability,
} from './ui/EditorBuildCatalog.js';
import { resolveMapAuthoringStatus } from './EditorMapSerializer.js';

function buildEditorRuntimeSnapshot({ ui, mapManager, core }) {
    const activeEntry = ui?.toolDockState?.getActiveEntry?.() || null;
    const recentEntries = ui?.toolDockState?.getRecentEntries?.() || [];
    const favoriteEntries = ui?.toolDockState?.getFavoriteEntries?.() || [];
    const buildCatalogDescriptor = getEditorBuildCatalogDescriptor();
    const templateImportCapability = resolveEditorTemplateImportCapability();
    const assetId = activeEntry ? (
        activeEntry.tool === 'item' || activeEntry.tool === 'aircraft'
            ? activeEntry.subType
            : ((activeEntry.tool === 'portal' || activeEntry.tool === 'tunnel') ? activeEntry.subType : null)
    ) : null;
    const activeAssetStatus = assetId
        ? mapManager?.assetLoader?.getLoadStatus?.(assetId) || null
        : { state: 'builtin', id: null };
    const objects = Array.from(core?.objectsContainer?.children || []).map((object) => ({
        id: object?.userData?.id || null,
        type: object?.userData?.type || null,
        subType: object?.userData?.subType ?? null,
        x: Math.round(Number(object?.position?.x) || 0),
        y: Math.round(Number(object?.position?.y) || 0),
        z: Math.round(Number(object?.position?.z) || 0)
    }));

    return {
        mode: ui?.currentTool === 'select' ? 'select' : 'place',
        currentTool: ui?.currentTool || 'select',
        activeCategoryId: ui?.toolDockState?.getCurrentCategoryId?.() || null,
        activeEntryId: activeEntry?.id || null,
        activeEntryLabel: activeEntry?.label || null,
        activeEntrySubType: activeEntry?.subType || null,
        activeEntryAssetState: activeAssetStatus?.state || null,
        buildCatalogDescriptorVersion: String(buildCatalogDescriptor?.descriptorVersion || ''),
        buildCatalogEntryCount: Number(buildCatalogDescriptor?.entryCount) || 0,
        templateImportCapability: {
            contractVersion: String(templateImportCapability?.contractVersion || ''),
            descriptorVersion: String(templateImportCapability?.descriptorVersion || ''),
            status: String(templateImportCapability?.status || ''),
            available: templateImportCapability?.available === true,
            degradedReason: String(templateImportCapability?.degradedReason || ''),
            message: String(templateImportCapability?.message || ''),
        },
        objectCount: Number(mapManager?.getObjectCount?.() || 0),
        recentEntryIds: recentEntries.map((entry) => entry.id),
        favoriteEntryIds: favoriteEntries.map((entry) => entry.id),
        objects,
        authoringStatus: resolveMapAuthoringStatus(mapManager)
    };
}

function installEditorRuntimeHooks({ core, ui, mapManager, assetLoader }) {
    const runtimeApi = {
        core,
        ui,
        mapManager,
        assetLoader,
        getState() {
            return buildEditorRuntimeSnapshot({ ui, mapManager, core });
        }
    };

    globalThis.CURVIOS_EDITOR = runtimeApi;
    globalThis.render_game_to_text = () => JSON.stringify(runtimeApi.getState());
    globalThis.advanceTime = async (ms = 16) => {
        const waitMs = Math.max(0, Number(ms) || 0);
        await new Promise((resolve) => window.setTimeout(resolve, waitMs));
        return globalThis.render_game_to_text();
    };
    document.body.dataset.editorReady = '1';
}

export async function initEditor() {
    try {
        const assetStatusText = document.getElementById("assetStatusText");
        let ui = null;
        const setAssetStatus = ({ level = 'info', message = '' } = {}) => {
            if (!assetStatusText) return;
            assetStatusText.textContent = message || 'Unbekannt';
            assetStatusText.style.color = (
                level === 'error' ? 'var(--danger)' :
                    level === 'warn' ? '#fbbf24' :
                        'var(--muted)'
            );
            ui?.refreshToolDock?.();
        };

        setAssetStatus({ level: 'info', message: 'Lade Assets...' });
        const assetLoader = new EditorAssetLoader({ timeoutMs: 8000 });
        assetLoader.setStatusHandler(setAssetStatus);

        const core = new EditorCore("threeCanvas");
        ui = new EditorUI(core);
        const mapManager = new EditorMapManager(core, assetLoader);
        const buildCatalogDescriptor = getEditorBuildCatalogDescriptor();
        const templateImportCapability = resolveEditorTemplateImportCapability();

        ui.setMapManager(mapManager);
        mapManager.setCallbacks({
            onTunnelVisualsChanged: () => ui.updateTunnelVisuals(),
            onHudCountChanged: () => ui.updateHudCount(),
            onBeforeManagedObjectRemoved: (object) => ui.onBeforeManagedObjectRemoved(object),
            onBeforeManagedObjectsCleared: () => ui.beforeManagedObjectsCleared()
        });

        installEditorRuntimeHooks({ core, ui, mapManager, assetLoader });
        document.body.dataset.editorDescriptorVersion = String(buildCatalogDescriptor?.descriptorVersion || '');
        document.body.dataset.editorTemplateStatus = String(templateImportCapability?.status || '');
        core.animate();

        const assetSummary = await assetLoader.loadAll();
        if ((assetSummary.failed + assetSummary.timedOut) > 0) {
            setAssetStatus({
                level: 'warn',
                message: `${assetSummary.loaded}/${assetSummary.total} geladen, ${assetSummary.failed + assetSummary.timedOut} Placeholder`
            });
        } else {
            setAssetStatus({
                level: 'info',
                message: `${assetSummary.loaded}/${assetSummary.total} geladen`
            });
        }

        console.log("3D Map Editor successfully initialized.");
    } catch (error) {
        console.error("Editor initialization failed:", error);
        const assetStatusText = document.getElementById("assetStatusText");
        if (assetStatusText) {
            assetStatusText.textContent = "Init fehlgeschlagen";
            assetStatusText.style.color = "var(--danger)";
        }
        document.body.dataset.editorReady = '0';
        globalThis.CURVIOS_EDITOR_INIT_ERROR = String(error?.message || error || 'unknown');
        alert("Fehler beim Starten des 3D Map Editors. Details in der Konsole.");
    }
}

initEditor();
