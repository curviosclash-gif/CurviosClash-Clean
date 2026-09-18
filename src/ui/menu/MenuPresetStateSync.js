import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import { findFixedMenuPresetSeedById } from './MenuDefaultsEditorConfig.js';
import { formatMenuPresetChangeSummary, resolveMenuPresetModePath } from './MenuPresetChipSummary.js';

// Name on the first line, what the preset changes below it; rebuilt only when either changes.
function renderPresetChip(button, name, summary) {
    const signature = `${name}\n${summary}`;
    if (button.dataset.chipSignature === signature) return;
    button.dataset.chipSignature = signature;
    const doc = button.ownerDocument;
    const nameNode = doc.createElement('span');
    nameNode.className = 'preset-chip-name';
    nameNode.textContent = name;
    const summaryNode = doc.createElement('span');
    summaryNode.className = 'preset-chip-summary';
    summaryNode.textContent = summary;
    button.replaceChildren(nameNode, summaryNode);
}

// Built-in presets ship with the game; only presets the player saved can be deleted.
export function syncPresetDeleteButton(button, selectedPresetId) {
    if (!button) return;
    const presetId = String(selectedPresetId || '').trim();
    const builtIn = !!presetId && !!findFixedMenuPresetSeedById(presetId);
    button.disabled = !presetId || builtIn;
    button.title = builtIn ? 'Eingebaute Vorlagen können nicht gelöscht werden.' : '';
}

export function syncMenuPresetState({ ui, settings, settingsManager, surfacePolicy = null }) {
    if (!ui || !settings) return;

    const surfacePolicyPort = createSurfacePolicyPort({
        getProductSurfaceId: () => surfacePolicy?.productSurfaceId || '',
        getSettings: () => settings
    });

    const activePresetId = String(settings?.matchSettings?.activePresetId || '');
    const activePresetKind = String(settings?.matchSettings?.activePresetKind || '');
    const isPresetVisible = (presetId) => {
        const normalizedPresetId = String(presetId || '').trim();
        if (!normalizedPresetId) {
            return false;
        }
        if (!surfacePolicy) {
            return true;
        }
        return surfacePolicyPort.isPresetAllowed(normalizedPresetId);
    };
    const visibleActivePresetId = isPresetVisible(activePresetId) ? activePresetId : '';

    if (ui.presetSelect) {
        const presets = (settingsManager?.listMenuPresets?.() || []).filter((preset) => isPresetVisible(preset?.id));
        const previousValue = String(ui.presetSelect.value || '');
        ui.presetSelect.replaceChildren();

        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Vorlage wählen';
        ui.presetSelect.appendChild(placeholderOption);

        presets.forEach((preset) => {
            const option = document.createElement('option');
            const presetId = String(preset?.id || '').trim();
            const presetKind = String(preset?.metadata?.kind || '').trim();
            option.value = presetId;
            option.textContent = presetKind === 'fixed'
                ? `${preset.name} (verbindlich)`
                : `${preset.name} (frei)`;
            ui.presetSelect.appendChild(option);
        });

        // The player's own pick wins; the active preset only fills an empty choice.
        const hasOption = (value) => Array.from(ui.presetSelect.options).some((option) => option.value === value);
        const preferredValue = hasOption(previousValue) ? previousValue : visibleActivePresetId;
        if (preferredValue) {
            ui.presetSelect.value = hasOption(preferredValue) ? preferredValue : '';
        }
        syncPresetDeleteButton(ui.presetDeleteButton, ui.presetSelect.value);
    }

    if (Array.isArray(ui.quickstartPresetButtons)) {
        const modePath = String(settings?.localSettings?.modePath || 'normal').trim().toLowerCase();
        ui.quickstartPresetButtons.forEach((button) => {
            const buttonPresetId = String(button?.dataset?.presetId || '').trim();
            // The chip name and its change summary live only in the preset catalog.
            const preset = findFixedMenuPresetSeedById(buttonPresetId);
            renderPresetChip(button, preset?.name || buttonPresetId, preset ? formatMenuPresetChangeSummary(preset.values) : '');
            button.title = preset?.description || '';
            const presetModePath = resolveMenuPresetModePath(preset);
            const matchesStyle = !presetModePath || presetModePath === modePath;
            const visible = (!buttonPresetId || isPresetVisible(buttonPresetId)) && matchesStyle;
            const isActive = !!buttonPresetId && buttonPresetId === visibleActivePresetId;
            button.classList.toggle('hidden', !visible);
            button.setAttribute('aria-hidden', String(!visible));
            button.disabled = !visible;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    if (ui.presetStatus) {
        if (!visibleActivePresetId) {
            ui.presetStatus.textContent = 'Vorlage: eigene Einstellungen';
        } else {
            const presetKindLabel = activePresetKind === 'fixed' ? 'verbindlich' : 'frei';
            const activePreset = (settingsManager?.listMenuPresets?.() || []).find((preset) => preset?.id === visibleActivePresetId);
            ui.presetStatus.textContent = `Vorlage: ${activePreset?.name || visibleActivePresetId} (${presetKindLabel})`;
        }
    }
}
