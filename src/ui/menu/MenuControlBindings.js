export function setupMenuControlBindings(ctx) {
    const ui = ctx.ui;
    const emit = ctx.emit;
    const eventTypes = ctx.eventTypes;
    const bind = ctx.bind;

    bind(ui.keybindP1, 'click', (e) => {
        const btn = e.target.closest('button.keybind-btn');
        if (!btn) return;
        emit(eventTypes.START_KEY_CAPTURE, {
            player: 'PLAYER_1',
            action: btn.dataset.action,
        });
    });

    bind(ui.keybindP2, 'click', (e) => {
        const btn = e.target.closest('button.keybind-btn');
        if (!btn) return;
        emit(eventTypes.START_KEY_CAPTURE, {
            player: 'PLAYER_2',
            action: btn.dataset.action,
        });
    });

    if (ui.keybindGlobal) {
        bind(ui.keybindGlobal, 'click', (e) => {
            const btn = e.target.closest('button.keybind-btn');
            if (!btn) return;
            emit(eventTypes.START_KEY_CAPTURE, {
                player: 'GLOBAL',
                action: btn.dataset.action,
            });
        });
    }

    bind(ui.resetKeysButton, 'click', () => {
        emit(eventTypes.RESET_KEYS);
    });

    bind(ui.saveKeysButton, 'click', () => {
        emit(eventTypes.SAVE_KEYS);
    });
}
