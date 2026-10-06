/** @param {any} button @param {{ label?: string, confirmLabel?: string, onConfirm?: Function,
 * timeoutMs?: number, armedAttribute?: string }} options */
export function armConfirmButton(button, {
    label,
    confirmLabel = 'Zum Bestätigen erneut klicken',
    onConfirm,
    timeoutMs = 4000,
    armedAttribute = 'data-confirm-armed',
} = {}) {
    // Without a fixed label the button's current text is restored, so a button that relabels
    // itself (pause: "Hauptmenü" / "Verbindung trennen") keeps the label it showed when armed.
    let originalLabel = String(label ?? button?.textContent ?? '');
    let armed = false;
    let timer = null;

    const disarm = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (armed) button.textContent = originalLabel;
        armed = false;
        button.removeAttribute(armedAttribute);
    };
    const onClick = () => {
        if (armed) {
            disarm();
            onConfirm?.();
            return;
        }
        if (label == null) originalLabel = String(button.textContent ?? '');
        armed = true;
        button.textContent = String(confirmLabel);
        button.setAttribute(armedAttribute, 'true');
        timer = setTimeout(disarm, Math.max(0, Number(timeoutMs) || 0));
    };
    button.addEventListener('click', onClick);
    button.addEventListener('blur', disarm);
    return {
        disarm,
        dispose() {
            disarm();
            button.removeEventListener('click', onClick);
            button.removeEventListener('blur', disarm);
        },
    };
}
