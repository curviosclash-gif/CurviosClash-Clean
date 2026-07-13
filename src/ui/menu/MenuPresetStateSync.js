import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';

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
        ui.presetSelect.innerHTML = '';

        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Preset waehlen';
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

        const preferredValue = visibleActivePresetId || previousValue;
        if (preferredValue) {
            const hasOption = Array.from(ui.presetSelect.options).some((option) => option.value === preferredValue);
            ui.presetSelect.value = hasOption ? preferredValue : '';
        }
    }

    if (Array.isArray(ui.quickstartPresetButtons)) {
        ui.quickstartPresetButtons.forEach((button) => {
            const buttonPresetId = String(button?.dataset?.presetId || '').trim();
            const visible = !buttonPresetId || isPresetVisible(buttonPresetId);
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
            ui.presetStatus.textContent = 'Preset: individuell';
        } else {
            const presetKindLabel = activePresetKind === 'fixed' ? 'verbindlich' : 'frei';
            ui.presetStatus.textContent = `Preset: ${visibleActivePresetId} (${presetKindLabel})`;
        }
    }
}
