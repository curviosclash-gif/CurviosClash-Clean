// Shared block for "nothing here", "did not work", "loading" and "info" states in menu screens.
// The kind is always readable without color: a visible text label plus a symbol character (W6).

export const MENU_STATE_NOTICE_KINDS = Object.freeze(['empty', 'error', 'loading', 'info']);

const KIND_PRESENTATION = Object.freeze({
    empty: Object.freeze({ label: 'Hinweis', symbol: '∅' }),
    error: Object.freeze({ label: 'Fehler', symbol: '⚠' }),
    loading: Object.freeze({ label: 'Lädt …', symbol: '⌛' }),
    info: Object.freeze({ label: 'Info', symbol: 'ℹ' }),
});

/** Per-element mutable state: the current click handler of the action button. */
const noticeState = new WeakMap();

/** @param {any} kind */
function normalizeKind(kind) {
    return MENU_STATE_NOTICE_KINDS.includes(kind) ? kind : 'info';
}

/** @param {any} doc @param {string} tag @param {string} part @param {string} [text] */
function createPart(doc, tag, part, text = '') {
    const node = doc.createElement(tag);
    node.dataset.part = part;
    node.className = `menu-state-notice__${part}`;
    node.textContent = text;
    return node;
}

/** @param {any} element @param {string} name */
function findPart(element, name) {
    return element.querySelector(`[data-part="${name}"]`);
}

/** @param {any} element @param {string} kind */
function applyKind(element, kind) {
    const presentation = KIND_PRESENTATION[kind];
    element.dataset.kind = kind;
    element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    findPart(element, 'symbol').textContent = presentation.symbol;
    findPart(element, 'label').textContent = presentation.label;
}

/** @param {any} element @param {string | undefined | null} actionLabel */
function applyActionLabel(element, actionLabel) {
    const button = findPart(element, 'action');
    const label = String(actionLabel ?? '');
    button.textContent = label;
    button.hidden = label === '';
}

/**
 * @param {any} doc
 * @param {{ kind?: string, title?: string, text?: string, actionLabel?: string, onAction?: Function }} [options]
 */
export function createMenuStateNotice(doc, { kind, title = '', text = '', actionLabel, onAction } = {}) {
    const element = doc.createElement('div');
    element.className = 'menu-state-notice';

    const head = createPart(doc, 'div', 'head');
    const symbol = createPart(doc, 'span', 'symbol');
    // The label carries the meaning; the symbol is decoration for screen readers.
    symbol.setAttribute('aria-hidden', 'true');
    head.append(symbol, createPart(doc, 'span', 'label'));
    const action = createPart(doc, 'button', 'action');
    action.type = 'button';
    element.append(head, createPart(doc, 'p', 'title', String(title)), createPart(doc, 'p', 'text', String(text)), action);

    const state = { onAction, handler: () => state.onAction?.() };
    action.addEventListener('click', state.handler);
    noticeState.set(element, state);

    applyKind(element, normalizeKind(kind));
    applyActionLabel(element, actionLabel);

    return {
        element,
        update: (patch) => updateMenuStateNotice(element, patch),
        dispose() {
            action.removeEventListener('click', state.handler);
            state.onAction = null;
        },
    };
}

/**
 * Changes texts, kind or action of an existing notice without rebuilding it.
 * @param {any} element
 * @param {{ kind?: string, title?: string, text?: string, actionLabel?: string, onAction?: Function }} [patch]
 */
export function updateMenuStateNotice(element, patch = {}) {
    if (!element) return;
    if (patch.kind !== undefined) applyKind(element, normalizeKind(patch.kind));
    if (patch.title !== undefined) findPart(element, 'title').textContent = String(patch.title);
    if (patch.text !== undefined) findPart(element, 'text').textContent = String(patch.text);
    if (patch.actionLabel !== undefined) applyActionLabel(element, patch.actionLabel);
    if (patch.onAction !== undefined) {
        const state = noticeState.get(element);
        if (state) state.onAction = patch.onAction;
    }
}
