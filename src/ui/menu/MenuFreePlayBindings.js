// The hub card opens free play with the last variant; the variant buttons switch in place.
export function bindMenuFreePlayControls({ ui, bind, emit, eventTypes }) {
    if (ui.freePlayEntryButton) {
        bind(ui.freePlayEntryButton, 'click', () => {
            if (ui.freePlayEntryButton.disabled) return;
            emit(eventTypes.FREE_PLAY_VARIANT_CHANGE, {});
        });
    }
    (ui.freePlayVariantButtons || []).forEach((button) => {
        bind(button, 'click', () => {
            if (button.disabled || button.getAttribute('aria-pressed') === 'true') return;
            const variant = String(button.dataset.freePlayVariant || '').trim().toLowerCase();
            if (!variant) return;
            emit(eventTypes.FREE_PLAY_VARIANT_CHANGE, { variant, stayOnPanel: true });
        });
    });
}
