// The foldable key overview in the pause window (#pause-controls). Plain DOM writes from the
// blocks that PauseMenuText.resolvePauseControlRows computes.

const PAD_HINT = 'Controller: Belegung unter Einstellungen, Steuerung.';

function createElement(doc, tagName, className, text) {
    const element = doc.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/**
 * @param {HTMLElement | null} panel
 * @param {Array<{ title: string, rows: Array<{ label: string, keys: string[] }> }>} blocks
 */
export function renderPauseControls(panel, blocks) {
    const doc = panel?.ownerDocument;
    if (!panel || !doc) return;
    const children = [];
    for (const block of blocks || []) {
        const group = createElement(doc, 'div', 'menu-q-controls__group');
        if (block.title) group.appendChild(createElement(doc, 'p', 'menu-q-controls__title', block.title));
        const list = createElement(doc, 'dl', 'menu-q-controls__list');
        for (const row of block.rows) {
            list.appendChild(createElement(doc, 'dt', '', row.label));
            const keys = createElement(doc, 'dd');
            for (const key of row.keys) keys.appendChild(createElement(doc, 'kbd', 'menu-q-key', key));
            list.appendChild(keys);
        }
        group.appendChild(list);
        children.push(group);
    }
    children.push(createElement(doc, 'p', 'menu-q-controls__pad', PAD_HINT));
    panel.replaceChildren(...children);
}
