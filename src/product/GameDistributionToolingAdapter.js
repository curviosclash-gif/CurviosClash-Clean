export function isPlaytestLaunchRequested() {
    return false;
}

export function readPlaytestLaunchBoolParam() {
    return null;
}

export function readPlaytestSessionType() {
    return '';
}

export function installPlaytestReturnControl() {
    return () => {};
}

export function installDesktopTuningRuntimeBridge() {}

export function syncMenuDeveloperState({ ui } = {}) {
    if (ui?.developerTelemetryPanel) ui.developerTelemetryPanel.hidden = true;
}

export function setupMenuTelemetryControls({ ui } = {}) {
    if (ui?.developerTelemetryPanel) ui.developerTelemetryPanel.hidden = true;
}

export const AUTHORING_TELEMETRY_STORAGE_KEY = 'cuviosclash.authoring-telemetry.v1';

export class AuthoringTelemetryStore {
    getSnapshot() {
        return null;
    }
}
