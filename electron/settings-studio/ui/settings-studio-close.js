// The window shell requests a decision; only a trusted, pending response can close it.
export function attachStudioCloseDialog({ api, language, changes, exportPending, saving }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.closeDialog = '';
    overlay.hidden = true;
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'close-heading');
    overlay.setAttribute('aria-describedby', 'close-detail');
    document.body.append(overlay);
    let previousFocus;
    const layout = /** @type {HTMLElement} */ (document.querySelector('.layout'));
    const cancel = () => {
        overlay.hidden = true;
        layout.inert = false;
        api.respondToClose(false);
        if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
    api.onCloseRequested?.(() => {
        if (saving()) { api.respondToClose(false); return; }
        if (!overlay.hidden) return;
        const english = language() === 'en';
        previousFocus = document.activeElement;
        const pending = exportPending() ? (english ? ' The browser export is still pending.' : ' Der Browser-Export ist noch offen.') : '';
        overlay.innerHTML = `<div class="modal"><div class="modal__header"><h2 id="close-heading">${english ? 'Unsaved changes' : 'Ungespeicherte Änderungen'}</h2></div><div class="modal__body"><p id="close-detail">${english ? `${changes()} unsaved changes. Close without saving?` : `${changes()} ungespeicherte Änderungen. Ohne Speichern schließen?`}${pending}</p></div><div class="modal__footer"><button class="btn btn--primary" data-close-cancel>${english ? 'Keep editing' : 'Weiterbearbeiten'}</button><button class="btn" data-close-discard>${english ? 'Discard and close' : 'Verwerfen und schließen'}</button></div></div>`;
        overlay.hidden = false;
        layout.inert = true;
        overlay.querySelector('[data-close-cancel]').addEventListener('click', cancel);
        overlay.querySelector('[data-close-discard]').addEventListener('click', () => api.respondToClose(true));
        (/** @type {HTMLButtonElement} */ (overlay.querySelector('[data-close-cancel]'))).focus();
    });
    overlay.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key === 'Tab') {
            event.preventDefault();
            const buttons = Array.from(overlay.querySelectorAll('button'));
            buttons[document.activeElement === buttons[0] ? 1 : 0].focus();
        }
    });
}
