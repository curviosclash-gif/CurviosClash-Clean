import { clampSettingValue } from '../../shared/contracts/SettingsRuntimeContract.js';

const DEFAULT_TRAIL_LENGTH = 5000;

function formatTrailLength(value) {
    return `${value} Segmente`;
}

// Trail length counts trail segments; longer trails cost memory, GPU and collision time.
export function bindTrailLengthControl({ ui, settings, bind, limits, emit, keys }) {
    const slider = ui?.trailLengthSlider;
    if (!slider) return;
    slider.min = String(limits.min);
    slider.max = String(limits.max);
    bind(slider, 'input', () => {
        const current = settings.gameplay.trailLength ?? DEFAULT_TRAIL_LENGTH;
        settings.gameplay.trailLength = clampSettingValue(slider.value, limits, current);
        if (ui.trailLengthLabel) ui.trailLengthLabel.textContent = formatTrailLength(settings.gameplay.trailLength);
        emit([keys.GAMEPLAY_TRAIL_LENGTH]);
    });
}

export function syncTrailLengthControl(ui, settings, limits) {
    const slider = ui?.trailLengthSlider;
    if (!slider) return;
    const value = clampSettingValue(settings?.gameplay?.trailLength, limits, DEFAULT_TRAIL_LENGTH);
    slider.value = String(value);
    if (ui.trailLengthLabel) ui.trailLengthLabel.textContent = formatTrailLength(value);
}
