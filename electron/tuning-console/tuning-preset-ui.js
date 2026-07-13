function normalizeMessage(result, fallbackMessage) {
    if (result?.detail) {
        return String(result.detail);
    }
    if (result?.reason) {
        return String(result.reason);
    }
    return fallbackMessage;
}

function resolvePresetLabel(preset) {
    const name = String(preset?.name || preset?.id || 'Preset');
    const changedCount = Object.keys(preset?.delta || {}).length;
    return `${name} (${changedCount})`;
}

function setElementDisabled(element, disabled) {
    if (!element) return;
    element.disabled = disabled === true;
}

export function createTuningPresetUi({
    tuningApi,
    presetManager,
    elements,
    getValues,
    getDefaults,
    setStatus,
    reloadRuntimeValues,
    updateChangedCount,
} = {}) {
    if (!presetManager || !elements) {
        return {
            refresh: () => {},
        };
    }

    const {
        presetSelect,
        presetNameInput,
        presetSaveButton,
        presetLoadButton,
        presetExportButton,
        presetImportButton,
        resetAllButton,
    } = elements;

    function listPresets() {
        return presetManager.listPresets();
    }

    function refreshPresetSelect(selectedPresetId = '') {
        if (!presetSelect) return;
        const previousValue = String(selectedPresetId || presetSelect.value || '').trim();
        const presets = listPresets();
        presetSelect.innerHTML = '';
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Preset waehlen';
        presetSelect.appendChild(placeholderOption);
        presets.forEach((preset) => {
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = resolvePresetLabel(preset);
            presetSelect.appendChild(option);
        });
        if (previousValue && presets.some((preset) => preset.id === previousValue)) {
            presetSelect.value = previousValue;
        } else {
            presetSelect.value = '';
        }
        const selectedPreset = presetManager.getPreset(presetSelect.value);
        if (selectedPreset && presetNameInput && !presetNameInput.value.trim()) {
            presetNameInput.value = selectedPreset.name;
        }
    }

    async function savePreset() {
        const values = typeof getValues === 'function' ? getValues() : {};
        const defaults = typeof getDefaults === 'function' ? getDefaults() : {};
        const selectedPresetId = String(presetSelect?.value || '').trim();
        const inputName = String(presetNameInput?.value || '').trim();
        const existingPreset = presetManager.getPreset(selectedPresetId);
        const targetName = inputName || existingPreset?.name || 'Preset';
        const result = presetManager.savePreset({
            name: targetName,
            valuesByPath: values,
            defaultsByPath: defaults,
            presetId: selectedPresetId || null,
        });
        if (result.ok !== true) {
            setStatus?.('Preset konnte nicht gespeichert werden.');
            return;
        }
        if (presetNameInput) {
            presetNameInput.value = result.preset?.name || '';
        }
        refreshPresetSelect(result.preset?.id || '');
        setStatus?.(`Preset gespeichert: ${result.preset?.name || result.preset?.id}`);
    }

    async function loadPreset() {
        const presetId = String(presetSelect?.value || '').trim();
        if (!presetId) {
            setStatus?.('Preset waehlen, bevor geladen wird.');
            return;
        }
        const applyResult = await presetManager.applyPreset(
            presetId,
            async (path, value) => tuningApi.setValue(path, value)
        );
        if (!applyResult.ok) {
            setStatus?.(`Preset konnte nicht geladen werden: ${applyResult.reason || 'unknown'}`);
            return;
        }
        await reloadRuntimeValues?.();
        updateChangedCount?.();
        setStatus?.(`Preset geladen: ${applyResult.preset?.name || presetId}`);
    }

    async function exportPreset() {
        const presetId = String(presetSelect?.value || '').trim();
        if (!presetId) {
            setStatus?.('Preset waehlen, bevor exportiert wird.');
            return;
        }
        const exportResult = presetManager.createExportDocument(presetId);
        if (!exportResult.ok) {
            setStatus?.('Preset kann nicht exportiert werden.');
            return;
        }
        const presetName = String(exportResult.document?.preset?.name || presetId).trim();
        const fileName = `${presetName.replace(/[^a-z0-9-_]+/gi, '_')}.json`;
        const dialogResult = await tuningApi.exportPresetJson(exportResult.document, fileName);
        if (dialogResult?.ok !== true) {
            setStatus?.(`Export abgebrochen: ${normalizeMessage(dialogResult, 'dialog_cancelled')}`);
            return;
        }
        setStatus?.(`Preset exportiert: ${dialogResult.value?.filePath || fileName}`);
    }

    async function importPreset() {
        const dialogResult = await tuningApi.importPresetJson();
        if (dialogResult?.ok !== true) {
            setStatus?.(`Import abgebrochen: ${normalizeMessage(dialogResult, 'dialog_cancelled')}`);
            return;
        }
        const importResult = presetManager.importPresetDocument(dialogResult.value?.presetData);
        if (!importResult.ok) {
            setStatus?.(`Import fehlgeschlagen: ${importResult.reason || 'invalid_document'}`);
            return;
        }
        refreshPresetSelect(importResult.preset?.id || '');
        setStatus?.(`Preset importiert: ${importResult.preset?.name || importResult.preset?.id}`);
    }

    async function resetAll() {
        const result = await tuningApi.resetAll(null);
        if (result?.ok !== true) {
            setStatus?.(`Reset fehlgeschlagen: ${normalizeMessage(result, 'runtime_error')}`);
            return;
        }
        await reloadRuntimeValues?.();
        updateChangedCount?.();
        setStatus?.('Alle Parameter wurden auf Defaults gesetzt.');
    }

    if (presetSelect) {
        presetSelect.addEventListener('change', () => {
            const selectedPreset = presetManager.getPreset(presetSelect.value);
            if (selectedPreset && presetNameInput) {
                presetNameInput.value = selectedPreset.name;
            }
        });
    }
    if (presetSaveButton) {
        presetSaveButton.addEventListener('click', () => {
            void savePreset();
        });
    }
    if (presetLoadButton) {
        presetLoadButton.addEventListener('click', () => {
            void loadPreset();
        });
    }
    if (presetExportButton) {
        presetExportButton.addEventListener('click', () => {
            void exportPreset();
        });
    }
    if (presetImportButton) {
        presetImportButton.addEventListener('click', () => {
            void importPreset();
        });
    }
    if (resetAllButton) {
        resetAllButton.addEventListener('click', () => {
            void resetAll();
        });
    }

    setElementDisabled(presetLoadButton, false);
    setElementDisabled(presetExportButton, false);
    setElementDisabled(resetAllButton, false);
    refreshPresetSelect('');

    return {
        refresh: refreshPresetSelect,
    };
}
