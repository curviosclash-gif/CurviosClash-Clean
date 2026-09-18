// The small info "i" next to a heading: a real button that shows its note in place.
// It reaches the keyboard (Tab, Enter/Space, Escape) instead of relying on a mouse tooltip;
// the title stays as a mouse hint.

let nextNoteId = 0;

function resolveNoteText(button) {
    return String(button.dataset?.infoHint || button.title || button.getAttribute?.('aria-description') || '').trim();
}

export function bindInfoHintToggle(button) {
    if (!button || button.dataset?.infoHintBound === 'true') return button;
    if (button.dataset) button.dataset.infoHintBound = 'true';
    const doc = button.ownerDocument;
    let note = null;
    const setOpen = (open) => {
        if (open && !note) {
            note = doc.createElement('span');
            note.className = 'menu-info-note';
            note.id = typeof doc.nextId === 'function' ? doc.nextId() : `menu-info-note-${++nextNoteId}`;
            note.setAttribute('role', 'note');
            note.textContent = resolveNoteText(button);
            button.after(note);
            button.setAttribute('aria-controls', note.id);
        }
        if (note) note.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
    };
    button.setAttribute?.('aria-expanded', 'false');
    button.addEventListener?.('click', (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        setOpen(button.getAttribute('aria-expanded') !== 'true');
    });
    button.addEventListener?.('keydown', (event) => {
        if (event.key !== 'Escape' || button.getAttribute('aria-expanded') !== 'true') return;
        event.preventDefault?.();
        event.stopPropagation?.();
        setOpen(false);
    });
    button.addEventListener?.('blur', () => setOpen(false));
    return button;
}

export function createInfoHintButton(doc, text, className = '') {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `menu-info-hint ${className}`.trim();
    button.textContent = 'i';
    button.title = String(text || '');
    button.setAttribute?.('aria-label', `Hinweis: ${text}`);
    return bindInfoHintToggle(button);
}

/** Turns every static info "i" in the page into a working toggle. */
export function bindStaticInfoHints(root) {
    for (const button of Array.from(root?.querySelectorAll?.('button.menu-info-hint') || [])) {
        bindInfoHintToggle(button);
    }
}
