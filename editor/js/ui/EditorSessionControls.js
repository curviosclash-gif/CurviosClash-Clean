import { CUSTOM_MAP_STORAGE_KEY } from '../../../src/entities/MapSchema.js';
import {
    EDITOR_API_ROUTES,
    EDITOR_DISK_IO_CONTRACT_VERSION,
} from '../../../src/shared/contracts/EditorPathContract.js';
import { resolveArtifactVersionState } from '../../../src/shared/contracts/ArtifactVersionMigrationContract.js';
import {
    getEditorBuildCatalogDescriptor,
    resolveEditorTemplateImportCapability,
} from './EditorBuildCatalog.js';
import { getJsonEditorText, setJsonEditorText } from './EditorFormState.js';

const LAST_DISK_MAP_NAME_STORAGE_KEY = 'editor_last_disk_map_name';
const DEFAULT_DISK_MAP_NAME = 'Editor Map';
const EDITOR_DISK_IO_VERSION_FIELDS = Object.freeze(['contractVersion']);
const EDITOR_DISK_IO_SUPPORTED_VERSIONS = Object.freeze([EDITOR_DISK_IO_CONTRACT_VERSION]);

function dedupeWarnings(warnings) {
    const result = [];
    const seen = new Set();
    for (const warning of Array.isArray(warnings) ? warnings : []) {
        if (typeof warning !== 'string') continue;
        const normalized = warning.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function formatWarningsMessage(title, warnings) {
    const uniqueWarnings = dedupeWarnings(warnings);
    if (uniqueWarnings.length === 0) return '';
    return `${title}\n- ${uniqueWarnings.join('\n- ')}`;
}

function hasMigrationWarnings(warnings) {
    return dedupeWarnings(warnings).some((entry) => /legacy|schema v\d+|migrat/i.test(entry));
}

function resolveWarningsTitle(baseTitle, warnings) {
    return hasMigrationWarnings(warnings)
        ? baseTitle.replace('Hinweisen', 'Migrationshinweisen')
        : baseTitle;
}

function promptForDiskMapName() {
    let defaultName = DEFAULT_DISK_MAP_NAME;
    try {
        const stored = localStorage.getItem(LAST_DISK_MAP_NAME_STORAGE_KEY);
        if (typeof stored === 'string' && stored.trim()) {
            defaultName = stored.trim();
        }
    } catch {
        // localStorage may be unavailable in some environments
    }

    const input = window.prompt(
        'Name fuer die Map im Spieleordner (gleichnamiger Export aktualisiert die bestehende Map):',
        defaultName
    );

    if (input === null) return null;
    const name = input.trim();
    if (!name) {
        throw new Error('Bitte einen gueltigen Map-Namen eingeben.');
    }

    try {
        localStorage.setItem(LAST_DISK_MAP_NAME_STORAGE_KEY, name);
    } catch {
        // ignore persistence failures for the default prompt value
    }

    return name;
}

function hasExplicitContractVersion(payload) {
    return !!payload
        && typeof payload === 'object'
        && Object.prototype.hasOwnProperty.call(payload, 'contractVersion');
}

function resolveEditorDiskIoVersionState(payload, allowMissingVersion = true) {
    return resolveArtifactVersionState(payload && typeof payload === 'object' ? payload : {}, {
        artifactType: 'editor-disk-io',
        versionFields: EDITOR_DISK_IO_VERSION_FIELDS,
        supportedVersions: EDITOR_DISK_IO_SUPPORTED_VERSIONS,
        currentVersion: EDITOR_DISK_IO_CONTRACT_VERSION,
        allowMissingVersion,
    });
}

function resolveEditorDiskSaveCapability(runtimeGlobal = globalThis) {
    const globalRef = runtimeGlobal && typeof runtimeGlobal === 'object' ? runtimeGlobal : globalThis;
    const fetchImpl = typeof globalRef.fetch === 'function'
        ? globalRef.fetch.bind(globalRef)
        : (typeof fetch === 'function' ? fetch : null);
    return {
        available: typeof fetchImpl === 'function',
        fetchImpl,
        reason: typeof fetchImpl === 'function' ? '' : 'fetch_unavailable',
    };
}

function applyAuthoringContractHints(dom) {
    if (!dom) return;
    const buildCatalogDescriptor = getEditorBuildCatalogDescriptor();
    const templateCapability = resolveEditorTemplateImportCapability();
    const buildCatalogMessage = `Build-Katalog: ${String(buildCatalogDescriptor?.descriptorVersion || 'unbekannt')} mit ${Number(buildCatalogDescriptor?.entryCount) || 0} Eintraegen.`;
    const templateMessage = String(templateCapability?.message || '');
    const authoringHint = `${buildCatalogMessage} ${templateMessage}`.trim();
    if (dom.btnNew) dom.btnNew.title = authoringHint;
    if (dom.btnImport) dom.btnImport.title = `${authoringHint} Import nutzt denselben Map- und Descriptor-Vertrag.`.trim();
    if (dom.btnSaveToGame) dom.btnSaveToGame.title = `${authoringHint} Disk-Export nutzt ${EDITOR_DISK_IO_CONTRACT_VERSION}.`.trim();
    if (dom.btnPlaytest) dom.btnPlaytest.title = `${authoringHint} Playtest nutzt denselben Runtime-/Map-Leseweg.`.trim();
}

export function bindEditorSessionControls(editor, { syncArenaValues } = {}) {
    if (!editor) return;
    const dom = editor.dom;
    applyAuthoringContractHints(dom);

    const generateCurrentMapJson = () => {
        const jsonText = editor.mapManager.generateJSONExport(editor.getArenaSizeForExport());
        return {
            jsonText,
            warnings: dedupeWarnings(editor.mapManager?.lastSchemaWarnings),
        };
    };

    const saveCurrentMapToGameStorage = () => {
        const { jsonText, warnings } = generateCurrentMapJson();
        localStorage.setItem(CUSTOM_MAP_STORAGE_KEY, jsonText);
        return { jsonText, warnings };
    };

    const saveCurrentMapToDisk = async (mapName) => {
        const diskCapability = resolveEditorDiskSaveCapability(window);
        if (!diskCapability.available) {
            throw new Error('Editor-Disk-Import/Export ist in dieser Umgebung nicht verfuegbar, weil kein Fetch-Transport bereitsteht.');
        }
        const { jsonText, warnings: exportWarnings } = generateCurrentMapJson();
        const response = await diskCapability.fetchImpl(EDITOR_API_ROUTES.SAVE_MAP_DISK, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contractVersion: EDITOR_DISK_IO_CONTRACT_VERSION,
                jsonText,
                mapName
            })
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        const responseVersionState = resolveEditorDiskIoVersionState(payload, true);
        if (hasExplicitContractVersion(payload) && (
            responseVersionState.shouldReject
            || responseVersionState.resolvedVersion === null
        )) {
            throw new Error('Editor-Disk-Import/Export antwortet mit inkompatibler contractVersion. Bitte Renderer und Dev-Server auf denselben Stand bringen.');
        }

        if (!response.ok || !payload?.ok) {
            throw new Error(payload?.error || `HTTP ${response.status} while saving map to disk.`);
        }

        return {
            jsonText,
            payload,
            warnings: dedupeWarnings([...(exportWarnings || []), ...(payload?.warnings || [])]),
        };
    };

    dom.btnExport?.addEventListener("click", () => {
        const { jsonText, warnings } = generateCurrentMapJson();
        setJsonEditorText(editor, jsonText);
        const warningMessage = formatWarningsMessage(resolveWarningsTitle('Map exportiert mit Hinweisen:', warnings), warnings);
        if (warningMessage) {
            alert(warningMessage);
        }
    });

    dom.btnSaveToGame?.addEventListener("click", async () => {
        let requestedMapName = null;
        try {
            requestedMapName = promptForDiskMapName();
        } catch (error) {
            alert(`Map-Name ungueltig: ${error.message}`);
            return;
        }

        if (requestedMapName === null) {
            return;
        }

        try {
            const { jsonText, payload, warnings } = await saveCurrentMapToDisk(requestedMapName);
            setJsonEditorText(editor, jsonText);

            const warningSuffix = warnings.length > 0
                ? `\n${hasMigrationWarnings(warnings) ? 'Migrationshinweise' : 'Hinweise'}: ${warnings.join(' | ')}`
                : '';
            const saveMode = payload.overwritten ? 'aktualisiert' : 'neu gespeichert';

            alert(
                `Map auf Festplatte ${saveMode}.\n` +
                `Map-Auswahl: ${payload.mapName} (${payload.mapKey})\n` +
                `Editor-Datei: ${payload.editorSchemaPath}\n` +
                `Runtime-Datei: ${payload.runtimeMapPath}\n` +
                `Registry: ${payload.generatedModulePath}\n` +
                `Spielseite neu laden, damit der Eintrag sichtbar ist.` +
                warningSuffix
            );
        } catch (error) {
            alert(
                `Map konnte nicht auf Festplatte gespeichert werden: ${error.message}\n` +
                `Hinweis: Der Editor muss ueber den lokalen Vite-Server laufen (npm run dev).`
            );
        }
    });

    dom.btnPlaytest?.addEventListener("click", () => {
        let warnings = [];
        try {
            ({ warnings } = saveCurrentMapToGameStorage());
        } catch (error) {
            alert(`Playtest konnte nicht gespeichert werden: ${error.message}`);
            return;
        }

        const warningMessage = formatWarningsMessage(
            resolveWarningsTitle('Playtest startet mit normalisierten Map-Hinweisen:', warnings),
            warnings
        );
        if (warningMessage) {
            alert(warningMessage);
        }

        const playtestMode = String(dom.selPlaytestMode?.value || '3d').toLowerCase();
        const params = new URLSearchParams();
        params.set('playtest', '1');
        params.set('planar', playtestMode === 'planar' ? '1' : '0');
        const playtestUrl = `../index.html?${params.toString()}`;
        const playtestWindow = window.open(playtestUrl, "_blank");
        if (playtestWindow) {
            playtestWindow.focus?.();
            return;
        }

        // Popup blocker fallback: start playtest in the current tab instead of failing silently.
        window.location.href = playtestUrl;
    });

    dom.btnImport?.addEventListener("click", () => {
        const txt = getJsonEditorText(editor).trim();
        if (!txt) return;
        editor.executeHistoryMutation('Import map', () => {
            editor.mapManager.importFromJSON(txt, {
                onArenaSize: (arenaSize) => {
                    if (typeof editor.setArenaSizeInputs === 'function') {
                        editor.setArenaSizeInputs(arenaSize);
                    }
                    if (typeof syncArenaValues === 'function') {
                        syncArenaValues();
                    }
                }
            });
        });

        const warningMessage = formatWarningsMessage(
            resolveWarningsTitle('Map importiert mit Hinweisen:', editor.mapManager?.lastSchemaWarnings),
            editor.mapManager?.lastSchemaWarnings
        );
        if (warningMessage) {
            alert(warningMessage);
        }
    });

    dom.btnNew?.addEventListener("click", () => {
        editor.executeHistoryMutation('Clear map', () => {
            editor.clearAllObjects();
            setJsonEditorText(editor, "");
        });
    });

    dom.btnDelSelected?.addEventListener("click", () => {
        editor.deleteSelectedObject();
    });

    dom.btnUndo?.addEventListener("click", () => {
        editor.undo();
    });

    dom.btnRedo?.addEventListener("click", () => {
        editor.redo();
    });
}
