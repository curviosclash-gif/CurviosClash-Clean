import { normalizeString } from '../../shared/contracts/ContractNormalizeUtils.js';

export function setMultiplayerStatus(game, message) {
    const status = game?.ui?.multiplayerStatus;
    if (status) {
        status.textContent = normalizeString(message, 'Multiplayer-Aktion fehlgeschlagen.');
    }
}

export function clearMultiplayerFieldError(field) {
    field?.removeAttribute?.('aria-invalid');
    field?.classList?.remove?.('menu-field-error');
}

export function markMultiplayerFieldError(field) {
    if (!field) return;
    field.setAttribute?.('aria-invalid', 'true');
    field.classList?.add?.('menu-field-error');
    field.focus?.();
}

export function beginMultiplayerAction(game, statusMessage, { cancellable = false } = {}) {
    // A running join can be cancelled; the button only exists while it runs.
    const cancelButton = cancellable ? game?.ui?.multiplayerCancelJoinButton : null;
    cancelButton?.classList?.remove?.('hidden');
    const buttons = [
        game?.ui?.multiplayerHostButton,
        game?.ui?.multiplayerJoinButton,
        game?.ui?.multiplayerOpenLobbiesRefreshButton,
    ].filter(Boolean);
    const previousDisabledStates = buttons.map((button) => button.disabled === true);
    buttons.forEach((button) => {
        button.disabled = true;
    });
    game?.ui?.multiplayerInlineState?.setAttribute?.('aria-busy', 'true');
    setMultiplayerStatus(game, statusMessage);

    return () => {
        buttons.forEach((button, index) => {
            button.disabled = previousDisabledStates[index];
        });
        game?.ui?.multiplayerInlineState?.removeAttribute?.('aria-busy');
        cancelButton?.classList?.add?.('hidden');
    };
}
