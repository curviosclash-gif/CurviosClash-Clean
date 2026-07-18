import {
    assertMapJsonSize,
    CUSTOM_MAP_STORAGE_KEY,
    MAX_MAP_JSON_BYTES,
} from '../../../src/entities/MapSchema.js';
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

function readLastMapName() {
    try {
        const stored = localStorage.getItem(LAST_DISK_MAP_NAME_STORAGE_KEY);
        if (typeof stored === 'string' && stored.trim()) {
            return stored.trim();
        }
    } catch {
        // localStorage may be unavailable in some environments
    }
    return DEFAULT_DISK_MAP_NAME;
}

function storeLastMapName(name) {
    try {
        localStorage.setItem(LAST_DISK_MAP_NAME_STORAGE_KEY, name);
    } catch {
        // localStorage may be unavailable in some environments
    }
}

function sanitizeMapName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function slugifyMapName(value) {
    const slug = sanitizeMapName(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return slug || 'map';
}

function resolveMapKeyPreview(mapName, savedMaps, saveAsCopy) {
    const normalizedName = sanitizeMapName(mapName) || DEFAULT_DISK_MAP_NAME;
    const maps = Array.isArray(savedMaps) ? savedMaps : [];
    const existing = maps.find((entry) => sanitizeMapName(entry?.mapName) === normalizedName);
    if (existing && !saveAsCopy) return String(existing.mapKey || '');

    const keys = new Set(maps.map((entry) => String(entry?.mapKey || '')));
    const baseKey = `editor_${slugifyMapName(normalizedName)}`;
    let candidate = baseKey;
    let index = 2;
    while (keys.has(candidate)) candidate = `${baseKey}_${index++}`;
    return candidate;
}

function downloadJsonFile(jsonText, fileName) {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
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

    const fetchEditorApi = async (route, options = {}) => {
        const diskCapability = resolveEditorDiskSaveCapability(window);
        if (!diskCapability.available) {
            throw new Error('Editor-Disk-Import/Export ist in dieser Umgebung nicht verfuegbar, weil kein Fetch-Transport bereitsteht.');
        }
        const response = await diskCapability.fetchImpl(route, options);
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
            throw new Error(payload?.error || `HTTP ${response.status} bei ${route}.`);
        }
        return payload;
    };

    const saveCurrentMapToDisk = async (mapName, { saveAsCopy = false } = {}) => {
        const { jsonText, warnings: exportWarnings } = generateCurrentMapJson();
        const editorDocument = editor.createEditorDocument?.(jsonText) || null;
        const payload = await fetchEditorApi(EDITOR_API_ROUTES.SAVE_MAP_DISK, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contractVersion: EDITOR_DISK_IO_CONTRACT_VERSION,
                jsonText,
                mapName,
                editorDocument,
                saveAsCopy,
            })
        });

        return {
            jsonText,
            payload,
            warnings: dedupeWarnings([...(exportWarnings || []), ...(payload?.warnings || [])]),
        };
    };

    const openPlaytest = () => {
        let warnings = [];
        try {
            ({ warnings } = saveCurrentMapToGameStorage());
        } catch (error) {
            editor.notify?.(`Playtest konnte nicht gespeichert werden: ${error.message}`, 'error');
            return;
        }

        editor.capturePlaytestReturnState?.();
        const warningMessage = formatWarningsMessage(
            resolveWarningsTitle('Playtest startet mit normalisierten Map-Hinweisen:', warnings),
            warnings
        );
        editor.notify?.(warningMessage || 'Playtest wird geoeffnet.', warningMessage ? 'warn' : 'success');

        const playtestMode = String(dom.selPlaytestMode?.value || '3d').toLowerCase();
        const playtestSession = String(dom.selPlaytestSession?.value || 'single').toLowerCase();
        const params = new URLSearchParams();
        params.set('playtest', '1');
        params.set('planar', playtestMode === 'planar' ? '1' : '0');
        params.set('session', playtestSession);
        const playtestUrl = `../index.html?${params.toString()}`;
        const playtestWindow = window.open(playtestUrl, '_blank');
        if (playtestWindow) {
            playtestWindow.focus?.();
            return;
        }
        window.location.href = playtestUrl;
    };

    let exportState = null;

    const closeExportDialog = () => {
        if (dom.exportDialog?.open) dom.exportDialog.close();
    };

    const updateExportDialog = () => {
        if (!exportState) return;
        const mapName = sanitizeMapName(dom.exportMapName?.value);
        const target = String(dom.exportTarget?.value || 'install');
        const saveAsCopy = dom.exportConflictMode?.value === 'copy';
        const mapKey = resolveMapKeyPreview(mapName, exportState.savedMaps, saveAsCopy);
        const slug = slugifyMapName(mapName);
        const existing = exportState.savedMaps.find((entry) => sanitizeMapName(entry?.mapName) === mapName);
        const errors = exportState.validationItems.filter((item) => item.severity === 'error');
        const warnings = exportState.validationItems.filter((item) => item.severity === 'warning');

        if (dom.exportConflictModeRow) dom.exportConflictModeRow.hidden = target !== 'install';
        if (dom.exportKeyPreview) {
            dom.exportKeyPreview.textContent = target === 'install' ? `Map-Key: ${mapKey}` : 'Map-Key: nicht erforderlich';
        }
        if (dom.exportFilePreview) {
            dom.exportFilePreview.textContent = target === 'install'
                ? `Dateien: ${mapKey}.editor.json + ${mapKey}.runtime.json`
                : `Datei: ${slug}.${target === 'project' ? 'curvios-map' : 'runtime'}.json`;
        }
        if (dom.exportConflictNotice) {
            dom.exportConflictNotice.textContent = target !== 'install'
                ? ''
                : exportState.listError
                    ? 'Vorhandene Maps konnten nicht geladen werden; der Server prueft den Namen beim Speichern.'
                    : existing
                        ? (saveAsCopy
                            ? `„${existing.mapName}“ bleibt erhalten; eine neue Kopie wird angelegt.`
                            : `„${existing.mapName}“ (${existing.mapKey}) wird aktualisiert.`)
                        : 'Der Name ist frei; eine neue Map wird angelegt.';
        }
        if (dom.exportWarningAcknowledgeRow) dom.exportWarningAcknowledgeRow.hidden = warnings.length === 0;
        if (dom.btnExportConfirm) {
            dom.btnExportConfirm.disabled = !mapName
                || errors.length > 0
                || (warnings.length > 0 && dom.exportWarningAcknowledge?.checked !== true);
        }
    };

    const renderExportValidation = () => {
        if (!exportState || !dom.exportValidationList) return;
        const issues = exportState.validationItems.filter((item) => !item.ok);
        const errors = issues.filter((item) => item.severity === 'error');
        const warnings = issues.filter((item) => item.severity === 'warning');
        if (dom.exportValidationSummary) {
            dom.exportValidationSummary.textContent = issues.length === 0
                ? 'Map bereit'
                : `${errors.length} Fehler, ${warnings.length} Warnung(en)`;
        }

        const fragment = document.createDocumentFragment();
        if (issues.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'Keine Probleme gefunden.';
            fragment.appendChild(li);
        }
        for (const item of issues) {
            const li = document.createElement('li');
            li.dataset.severity = item.severity;
            const objectId = String(item.objectIds?.[0] || '');
            if (objectId) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = `${item.severity === 'error' ? 'Fehler' : 'Warnung'}: ${item.label}`;
                button.addEventListener('click', () => {
                    closeExportDialog();
                    const object = editor.mapManager?.getObjectById?.(objectId);
                    if (object) {
                        editor.selectObject(object);
                        editor.core.focusObject?.(object);
                    }
                });
                li.appendChild(button);
            } else {
                li.textContent = `${item.severity === 'error' ? 'Fehler' : 'Warnung'}: ${item.label}`;
            }
            fragment.appendChild(li);
        }
        dom.exportValidationList.replaceChildren(fragment);
    };

    const showExportResult = ({ summary, paths = [], mapKey = '', canOpenFolder = false } = {}) => {
        if (dom.exportFormView) dom.exportFormView.hidden = true;
        if (dom.exportResultView) dom.exportResultView.hidden = false;
        if (dom.exportResultSummary) dom.exportResultSummary.textContent = summary;
        if (dom.exportResultPaths) dom.exportResultPaths.textContent = paths.join('\n');
        if (dom.btnExportOpenFolder) dom.btnExportOpenFolder.hidden = !canOpenFolder;
        if (dom.btnExportCopyKey) dom.btnExportCopyKey.hidden = !mapKey;
        exportState.resultMapKey = mapKey;
    };

    const openExportDialog = (defaultTarget = 'install') => {
        if (!dom.exportDialog || dom.exportDialog.open) return;
        const { jsonText } = generateCurrentMapJson();
        setJsonEditorText(editor, jsonText);
        exportState = {
            jsonText,
            validationItems: editor.renderWorkspaceValidation?.() || editor.lastValidationItems || [],
            savedMaps: [],
            listError: false,
            resultMapKey: '',
        };
        if (dom.exportFormView) dom.exportFormView.hidden = false;
        if (dom.exportResultView) dom.exportResultView.hidden = true;
        if (dom.exportMapName) dom.exportMapName.value = readLastMapName();
        if (dom.exportTarget) dom.exportTarget.value = defaultTarget;
        if (dom.exportConflictMode) dom.exportConflictMode.value = 'update';
        if (dom.exportWarningAcknowledge) dom.exportWarningAcknowledge.checked = false;
        if (dom.btnExportConfirm) dom.btnExportConfirm.textContent = 'Exportieren';
        renderExportValidation();
        updateExportDialog();
        document.getElementById('fileMenu')?.removeAttribute('open');
        dom.exportDialog.showModal();
        dom.exportMapName?.focus();

        void fetchEditorApi(EDITOR_API_ROUTES.LIST_MAPS_DISK)
            .then((payload) => {
                if (!exportState || !dom.exportDialog?.open) return;
                exportState.savedMaps = Array.isArray(payload.maps) ? payload.maps : [];
                updateExportDialog();
            })
            .catch(() => {
                if (!exportState || !dom.exportDialog?.open) return;
                exportState.listError = true;
                updateExportDialog();
            });
    };

    const performExport = async () => {
        if (!exportState || dom.btnExportConfirm?.disabled) return;
        const mapName = sanitizeMapName(dom.exportMapName?.value);
        const target = String(dom.exportTarget?.value || 'install');
        const saveAsCopy = dom.exportConflictMode?.value === 'copy';
        const slug = slugifyMapName(mapName);
        storeLastMapName(mapName);
        if (dom.btnExportConfirm) {
            dom.btnExportConfirm.disabled = true;
            dom.btnExportConfirm.textContent = 'Exportiere...';
        }

        try {
            if (target === 'project') {
                const editorDocument = editor.createEditorDocument?.(exportState.jsonText);
                if (!editorDocument) throw new Error('Editor-Arbeitsstand konnte nicht erstellt werden.');
                const projectJson = JSON.stringify(editorDocument, null, 2);
                editor.resolveEditorImportText?.(projectJson);
                const fileName = `${slug}.curvios-map.json`;
                downloadJsonFile(projectJson, fileName);
                editor.markSaved?.(`Bearbeitbare Map-Datei erstellt: ${fileName}.`);
                showExportResult({ summary: 'Die bearbeitbare Map-Datei wurde erstellt.', paths: [fileName] });
                return;
            }
            if (target === 'runtime') {
                const fileName = `${slug}.runtime.json`;
                downloadJsonFile(exportState.jsonText, fileName);
                editor.notify?.(`Runtime-JSON erstellt: ${fileName}.`, 'success');
                showExportResult({ summary: 'Das Runtime-JSON wurde erstellt. Editor-Ebenen sind darin absichtlich nicht enthalten.', paths: [fileName] });
                return;
            }

            const { jsonText, payload, warnings } = await saveCurrentMapToDisk(mapName, { saveAsCopy });
            setJsonEditorText(editor, jsonText);
            const warningSuffix = warnings.length > 0
                ? ` ${hasMigrationWarnings(warnings) ? 'Migrationshinweise' : 'Hinweise'}: ${warnings.join(' | ')}`
                : '';
            const saveMode = payload.overwritten ? 'aktualisiert' : 'neu gespeichert';
            editor.markSaved?.(`Map ${saveMode}: ${payload.mapName} (${payload.mapKey}).${warningSuffix}`);
            showExportResult({
                summary: `Map ${saveMode}: ${payload.mapName} (${payload.mapKey}).`,
                paths: [payload.editorSchemaPath, payload.runtimeMapPath].filter(Boolean),
                mapKey: payload.mapKey,
                canOpenFolder: true,
            });
        } catch (error) {
            if (dom.exportConflictNotice) dom.exportConflictNotice.textContent = `Export fehlgeschlagen: ${error.message}`;
            editor.notify?.(`Map konnte nicht exportiert werden: ${error.message}`, 'error');
            if (dom.btnExportConfirm) {
                dom.btnExportConfirm.textContent = 'Erneut versuchen';
                dom.btnExportConfirm.disabled = false;
            }
        }
    };

    dom.btnExport?.addEventListener("click", () => {
        const { jsonText, warnings } = generateCurrentMapJson();
        setJsonEditorText(editor, jsonText);
        const warningMessage = formatWarningsMessage(resolveWarningsTitle('Map exportiert mit Hinweisen:', warnings), warnings);
        editor.notify?.(warningMessage || 'JSON-Export aktualisiert.', warningMessage ? 'warn' : 'success');
    });

    dom.btnSaveToGame?.addEventListener('click', () => openExportDialog('install'));
    dom.btnPlaytest?.addEventListener('click', openPlaytest);

    dom.exportMapName?.addEventListener('input', updateExportDialog);
    dom.exportTarget?.addEventListener('change', updateExportDialog);
    dom.exportConflictMode?.addEventListener('change', updateExportDialog);
    dom.exportWarningAcknowledge?.addEventListener('change', updateExportDialog);
    dom.btnExportCancel?.addEventListener('click', closeExportDialog);
    dom.btnExportClose?.addEventListener('click', closeExportDialog);
    dom.exportForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        void performExport();
    });
    dom.btnExportPlay?.addEventListener('click', () => {
        closeExportDialog();
        openPlaytest();
    });
    dom.btnExportCopyKey?.addEventListener('click', async () => {
        const mapKey = String(exportState?.resultMapKey || '');
        if (!mapKey) return;
        try {
            await navigator.clipboard.writeText(mapKey);
            editor.notify?.(`Map-Key kopiert: ${mapKey}.`, 'success');
        } catch (error) {
            editor.notify?.(`Map-Key konnte nicht kopiert werden: ${error.message}`, 'error');
        }
    });
    dom.btnExportOpenFolder?.addEventListener('click', async () => {
        try {
            const payload = await fetchEditorApi(EDITOR_API_ROUTES.OPEN_MAPS_FOLDER, { method: 'POST' });
            editor.notify?.(`Map-Ordner geoeffnet: ${payload.folderPath}.`, 'success');
        } catch (error) {
            editor.notify?.(`Map-Ordner konnte nicht geoeffnet werden: ${error.message}`, 'error');
        }
    });

    dom.btnImport?.addEventListener("click", async () => {
        const txt = getJsonEditorText(editor).trim();
        if (!txt) {
            editor.notify?.('Fuege JSON ein oder lade eine JSON-Datei.', 'warn');
            return;
        }
        if (editor.mapManager?.getObjectCount?.() > 0) {
            const confirmed = await editor.confirmAction?.({
                title: 'Map importieren?',
                message: 'Der aktuelle Map-Inhalt wird durch den Import ersetzt. Undo bleibt danach verfuegbar.',
                confirmLabel: 'Importieren',
                danger: true,
            });
            if (!confirmed) return;
        }
        try {
            assertMapJsonSize(txt);
            const importDocument = editor.resolveEditorImportText?.(txt) || { jsonText: txt };
            editor.executeHistoryMutation('Import map', () => {
                editor.mapManager.importFromJSON(importDocument.jsonText, {
                    onArenaSize: (arenaSize) => {
                        if (typeof editor.setArenaSizeInputs === 'function') {
                            editor.setArenaSizeInputs(arenaSize);
                        }
                        if (typeof syncArenaValues === 'function') {
                            syncArenaValues();
                        }
                    }
                });
                editor.applyEditorImportState?.(importDocument);
            });

            const warningMessage = formatWarningsMessage(
                resolveWarningsTitle('Map importiert mit Hinweisen:', editor.mapManager?.lastSchemaWarnings),
                editor.mapManager?.lastSchemaWarnings
            );
            editor.notify?.(warningMessage || 'Map erfolgreich importiert.', warningMessage ? 'warn' : 'success');
        } catch (error) {
            editor.notify?.(`Map-Import fehlgeschlagen: ${error.message}`, 'error');
        }
    });

    dom.btnNew?.addEventListener("click", async () => {
        if (editor.mapManager?.getObjectCount?.() > 0 || editor.isDirty?.()) {
            const confirmed = await editor.confirmAction?.({
                title: 'Neue Map beginnen?',
                message: 'Alle aktuellen Objekte werden entfernt. Die Aktion kann danach mit Undo zurueckgenommen werden.',
                confirmLabel: 'Neue Map',
                danger: true,
            });
            if (!confirmed) return;
        }
        editor.executeHistoryMutation('Clear map', () => {
            editor.clearAllObjects();
            setJsonEditorText(editor, "");
        });
        editor.markDirty?.('Neue leere Map begonnen.');
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

    dom.btnCopyJson?.addEventListener('click', async () => {
        const { jsonText } = generateCurrentMapJson();
        setJsonEditorText(editor, jsonText);
        try {
            await navigator.clipboard.writeText(jsonText);
            editor.notify?.('Map-JSON in die Zwischenablage kopiert.', 'success');
        } catch (error) {
            editor.notify?.(`Zwischenablage nicht verfuegbar: ${error.message}`, 'error');
        }
    });

    dom.btnDownloadJson?.addEventListener('click', () => openExportDialog('project'));

    dom.btnLoadJsonFile?.addEventListener('click', () => dom.jsonFileInput?.click());
    dom.jsonFileInput?.addEventListener('change', async () => {
        const file = dom.jsonFileInput.files?.[0];
        if (!file) return;
        try {
            if (file.size > MAX_MAP_JSON_BYTES) {
                throw new Error(`Datei ist groesser als ${MAX_MAP_JSON_BYTES} Bytes.`);
            }
            setJsonEditorText(editor, await file.text());
            editor.notify?.(`${file.name} geladen. Mit „Import JSON“ uebernehmen.`, 'success');
        } catch (error) {
            editor.notify?.(`Datei konnte nicht gelesen werden: ${error.message}`, 'error');
        } finally {
            dom.jsonFileInput.value = '';
        }
    });
}
