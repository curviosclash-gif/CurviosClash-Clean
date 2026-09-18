// A local module (3 or 4 players) opens inside the play-style panel. Instead of a second
// back button, the panel's own back button closes the module first while it is open.

const HEADER_BACK_SELECTOR = '#submenu-custom .submenu-header [data-back]';
const MODULE_BACK_LABEL = 'Zurück zur Spielstilwahl';

export function bindLocalModuleHeaderBack({ documentRef, surface, onClose, listen }) {
    const back = documentRef?.querySelector?.(HEADER_BACK_SELECTOR) || null;
    if (!back || !surface) return { syncOpen() {} };
    const panelLabel = back.getAttribute('aria-label') || '';
    listen(back, 'click', (event) => {
        if (surface.classList.contains('hidden')) return;
        // Capture phase on the button runs before the menu navigation sees the click.
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
    }, { capture: true });
    return {
        syncOpen(open) {
            back.setAttribute('aria-label', open ? MODULE_BACK_LABEL : panelLabel);
        },
    };
}
