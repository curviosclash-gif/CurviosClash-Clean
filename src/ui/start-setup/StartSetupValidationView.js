function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function formatStartSetupMapLabel(entry = {}) {
    const name = String(entry?.name || entry?.key || 'Map');
    return entry?.hasGlbModel ? `${name} [GLB]` : name;
}

export function getStartFieldBinding(ui, fieldKey) {
    const dimensionModeButton = Array.isArray(ui?.dimensionModeButtons) ? ui.dimensionModeButtons[0] : null;
    const gameModeButton = Array.isArray(ui?.gameModeButtons) ? ui.gameModeButtons[0] : null;
    const bindings = {
        map: { control: ui?.mapSelect || null, hint: ui?.mapFieldHint || null, sectionId: 'map' },
        vehicleP1: { control: ui?.vehicleSelectP1 || null, hint: ui?.vehicleP1FieldHint || null, sectionId: 'vehicle' },
        vehicleP2: { control: ui?.vehicleSelectP2 || null, hint: ui?.vehicleP2FieldHint || null, sectionId: 'vehicle' },
        theme: { control: ui?.themeModeSelect || null, hint: ui?.themeFieldHint || null, sectionId: 'match' },
        match: { control: dimensionModeButton || gameModeButton || ui?.huntRespawnToggle || null, hint: ui?.matchFieldHint || null, sectionId: 'match' },
        multiplayer: { control: ui?.multiplayerLobbyCodeInput || null, hint: ui?.matchFieldHint || null, sectionId: 'multiplayer' },
    };
    return bindings[fieldKey] || { control: null, hint: null, sectionId: '' };
}

export function setStartFieldHint(hintElement, message, tone = 'info') {
    if (!hintElement) return;
    const normalizedMessage = normalizeString(message, '');
    const normalizedTone = tone === 'error' ? 'error' : (tone === 'lock' ? 'lock' : 'info');
    hintElement.textContent = normalizedMessage;
    hintElement.classList.remove('hidden', 'is-error', 'is-lock');
    hintElement.classList.toggle('hidden', !normalizedMessage);
    hintElement.classList.toggle('is-error', !!normalizedMessage && normalizedTone === 'error');
    hintElement.classList.toggle('is-lock', !!normalizedMessage && normalizedTone === 'lock');
}

export function clearStartFieldHints(ui) {
    ['map', 'vehicleP1', 'vehicleP2', 'theme', 'match', 'multiplayer'].forEach((fieldKey) => {
        const binding = getStartFieldBinding(ui, fieldKey);
        if (binding.control) binding.control.classList.remove('menu-field-error');
        if (binding.hint) setStartFieldHint(binding.hint, '', 'info');
    });
    if (ui?.startValidationStatus) {
        setStartFieldHint(ui.startValidationStatus, '', 'info');
    }
}

export function resolveLockedStartFieldHints(settings, settingsManager) {
    const lockHints = new Map();
    const activePresetId = normalizeString(settings?.matchSettings?.activePresetId, '');
    const activePresetKind = normalizeString(settings?.matchSettings?.activePresetKind, '');
    if (!activePresetId || activePresetKind !== 'fixed') return lockHints;

    const presets = settingsManager?.listMenuPresets?.() || [];
    const activePreset = presets.find((preset) => normalizeString(preset?.id, '') === activePresetId);
    const lockedFields = Array.isArray(activePreset?.metadata?.lockedFields) ? activePreset.metadata.lockedFields : [];
    if (lockedFields.length === 0) return lockHints;

    const lockMessagesByField = { map: [], vehicleP1: [], vehicleP2: [], match: [] };
    lockedFields.forEach((fieldPath) => {
        const normalizedPath = normalizeString(fieldPath, '');
        if (!normalizedPath) return;
        if (normalizedPath === 'mapKey') { lockMessagesByField.map.push('Map'); return; }
        if (normalizedPath === 'vehicles.PLAYER_1') { lockMessagesByField.vehicleP1.push('Flugzeug P1'); return; }
        if (normalizedPath === 'vehicles.PLAYER_2') { lockMessagesByField.vehicleP2.push('Flugzeug P2'); return; }
        lockMessagesByField.match.push(normalizedPath);
    });

    Object.entries(lockMessagesByField).forEach(([fieldKey, labels]) => {
        if (!Array.isArray(labels) || labels.length === 0) return;
        const uniqueLabels = Array.from(new Set(labels));
        lockHints.set(fieldKey, `Verbindliches Preset aktiv: ${uniqueLabels.join(', ')}`);
    });
    return lockHints;
}

export function renderStartFieldHints({
    ui,
    settings,
    settingsManager,
    startValidationIssue = null,
    focusField = false,
    onOpenSection = null,
}) {
    clearStartFieldHints(ui);
    const lockHints = resolveLockedStartFieldHints(settings, settingsManager);
    lockHints.forEach((message, fieldKey) => {
        const binding = getStartFieldBinding(ui, fieldKey);
        if (binding.hint) setStartFieldHint(binding.hint, message, 'lock');
    });

    const issue = startValidationIssue && typeof startValidationIssue === 'object'
        ? startValidationIssue
        : null;
    if (!issue) return;

    const summaryMessage = normalizeString(issue.message, '');
    if (ui?.startValidationStatus) {
        setStartFieldHint(ui.startValidationStatus, summaryMessage, 'error');
    }

    const fieldKey = normalizeString(issue.fieldKey, '');
    if (!fieldKey) return;
    const binding = getStartFieldBinding(ui, fieldKey);
    if (binding.hint) {
        setStartFieldHint(binding.hint, normalizeString(issue.fieldMessage, summaryMessage), 'error');
    }
    if (binding.control) {
        if (binding.sectionId && typeof onOpenSection === 'function') {
            onOpenSection(binding.sectionId);
        }
        binding.control.classList.add('menu-field-error');
        if (focusField) {
            binding.control.focus();
        }
    }
}
