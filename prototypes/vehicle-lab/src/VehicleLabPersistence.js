export function persistVehicleLabConfig({
    config,
    history,
    storage = globalThis.localStorage,
    storageKey,
    saveHistory = true,
    statusMessage = 'Entwurf automatisch gesichert.',
    statusTone = 'success',
    onSaveState = null,
    onStatus = null,
    onError = null,
} = {}) {
    let error = null;
    try {
        if (saveHistory) history.save(config);
        storage.setItem(storageKey, JSON.stringify(config));
    } catch (caught) {
        error = caught;
    }

    if (error) {
        onError?.(error);
        onSaveState?.('error', 'Speichern fehlgeschlagen');
        onStatus?.(`Lokales Speichern fehlgeschlagen: ${error.message}`, 'error');
        return false;
    }

    onSaveState?.('saved', 'Entwurf automatisch gesichert');
    onStatus?.(statusMessage, statusTone);
    return true;
}
