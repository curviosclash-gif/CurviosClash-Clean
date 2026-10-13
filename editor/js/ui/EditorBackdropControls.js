import { getRuntimeMapScale } from '../../../src/shared/contracts/RuntimeMapCatalogContract.js';
import {
    convertPresetToEditorDocument,
    exportPlacementsInPresetFormat,
    isBackdropObject,
    listBackdropPresets,
} from '../EditorPresetBackdrop.js';
import { setJsonEditorText } from './EditorFormState.js';

/**
 * "Spielkarte als Grundlage": loads a built-in map's world, spawns and lighting as a locked
 * backdrop, and copies what the author placed on top in the preset's own format.
 */
export function bindEditorBackdropControls(editor) {
    if (!editor?.core) return;
    const dom = editor.dom || {};
    let catalog = null;

    // Loaded on demand: a static import of the whole preset catalog would join the editor's
    // start-up chunk order, which has broken the desktop boot before (cross-chunk TDZ).
    const catalogReady = import('../../../src/core/config/maps/MapPresetCatalog.js')
        .then((module) => {
            catalog = module.MAP_PRESET_CATALOG;
            const options = listBackdropPresets(catalog).map((entry) => {
                const option = document.createElement('option');
                option.value = entry.key;
                option.textContent = entry.name;
                return option;
            });
            dom.selBackdropMap?.replaceChildren(...options);
            if (dom.selBackdropMap) dom.selBackdropMap.disabled = options.length === 0;
            if (dom.btnLoadBackdrop) dom.btnLoadBackdrop.disabled = options.length === 0;
            return catalog;
        })
        .catch((error) => {
            console.warn('[EditorBackdrop] Map catalog unavailable:', error);
            editor.notify?.('Spielkarten konnten nicht geladen werden.', 'error');
            return null;
        });

    // The map document names the built-in map it was built on, so this survives save and reopen.
    const resolveBackdropPreset = async () => {
        const key = editor.mapManager?.mapDocumentMeta?.editorBackdrop;
        if (!key) return null;
        const presets = catalog || await catalogReady;
        return presets?.[key] || null;
    };

    // Like a pilot at the start: in the player spawn, looking level towards the map centre.
    const lookFromPlayerSpawn = () => {
        const spawn = editor.mapManager.getObjectById('spawn_player');
        if (!spawn) return;
        const core = editor.core;
        if (core.viewMode !== 'perspective') core.setViewMode('perspective');
        core.camera.position.copy(spawn.position);
        core.orbit.target.set(0, spawn.position.y, 0);
        if (core.orbit.target.distanceToSquared(spawn.position) < 1) core.orbit.target.z -= 100;
        core.camera.up.set(0, 1, 0);
        core.camera.lookAt(core.orbit.target);
        core.orbit.update();
    };

    const loadBackdrop = async (key) => {
        const presets = catalog || await catalogReady;
        const preset = presets?.[key];
        if (!preset || !editor.mapManager) return false;
        if (editor.mapManager.getObjectCount() > 0 || editor.isDirty?.()) {
            const confirmed = await editor.confirmAction?.({
                title: 'Spielkarte als Grundlage laden?',
                message: 'Der aktuelle Map-Inhalt wird durch die Spielkarte ersetzt. Undo bleibt danach verfügbar.',
                confirmLabel: 'Laden',
                danger: true,
            });
            // The editor dialog resolves null on Cancel, Escape or a click beside it.
            if (!confirmed) return false;
        }
        const { document: mapDocument } = convertPresetToEditorDocument(key, preset, { mapScale: getRuntimeMapScale(1) });
        editor.executeHistoryMutation('Load map backdrop', () => {
            editor.mapManager.importFromJSON(JSON.stringify(mapDocument), {
                onArenaSize: (arenaSize) => {
                    editor.setArenaSizeInputs(arenaSize);
                    editor.syncArenaValues?.();
                },
            });
            for (const object of editor.core.objectsContainer.children) {
                if (isBackdropObject(object)) object.userData.editorLocked = true;
            }
            editor.refreshLayerState?.();
        });
        editor.enableGameView?.();
        editor.refreshGameView?.();
        editor.selectObject(null);
        lookFromPlayerSpawn();
        editor.notify?.(`${preset.name || key} geladen. Abflug mit G.`, 'success');
        return true;
    };

    const copyPlacements = async () => {
        if (!editor.mapManager) return '';
        const preset = await resolveBackdropPreset();
        const warnings = [];
        const placements = exportPlacementsInPresetFormat(editor.mapManager, editor.getArenaSizeForExport(), {
            preset,
            mapScale: getRuntimeMapScale(1),
            warnings,
        });
        const text = JSON.stringify(placements, null, 2);
        // Always visible in the Map JSON box; the clipboard is a convenience that may be refused.
        setJsonEditorText(editor, text);
        if (dom.jsonSection) dom.jsonSection.open = true;
        try {
            await navigator.clipboard?.writeText?.(text);
            editor.notify?.('Platzierungen im Kartenformat kopiert.', 'success');
        } catch {
            editor.notify?.('Platzierungen stehen im Feld „Map JSON“ zum Kopieren bereit.', 'info');
        }
        if (warnings.length > 0) {
            console.warn('[EditorBackdrop] Values above the world limits of the target map:', warnings);
            const more = warnings.length > 1 ? ` (+${warnings.length - 1} weitere, siehe Konsole)` : '';
            editor.notify?.(`${warnings[0]}${more}`, 'warn');
        }
        return text;
    };

    dom.btnLoadBackdrop?.addEventListener('click', () => {
        void loadBackdrop(dom.selBackdropMap?.value || '');
    });
    dom.btnCopyPresetPlacements?.addEventListener('click', () => {
        void copyPlacements();
    });

    editor.loadBackdrop = loadBackdrop;
    editor.copyPlacementsInPresetFormat = copyPlacements;
}
