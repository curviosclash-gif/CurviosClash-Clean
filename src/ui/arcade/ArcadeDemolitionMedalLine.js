import {
    DEMOLITION_MEDAL_RECORD_STORAGE_KEY,
    formatDemolitionBestMedalsLine,
} from '../../shared/contracts/DemolitionMedalRecordContract.js';

const LINE_CLASS = 'arcade-demolition-medals-line';

/** Shows the active profile's best demolition medals under the "Abrisskommando" start button. */
export function renderArcadeDemolitionMedalLine(startButton, store) {
    const option = startButton?.parentElement;
    const doc = option?.ownerDocument;
    if (!option || !doc) return '';
    let text = '';
    try {
        text = formatDemolitionBestMedalsLine(store?.loadJsonRecord?.(DEMOLITION_MEDAL_RECORD_STORAGE_KEY, null));
    } catch {
        text = '';
    }
    let line = Array.from(option.children || []).find((child) => child?.classList?.contains(LINE_CLASS));
    if (!line) {
        line = doc.createElement('p');
        line.className = `arcade-start-option-copy ${LINE_CLASS}`;
        option.appendChild(line);
    }
    line.textContent = text;
    line.classList.toggle('hidden', !text);
    return text;
}

/**
 * The menu render does not reach this button, so the line refreshes when the player can see it:
 * on bind, when an enclosing section opens, and when the option is pointed at or focused.
 */
export function bindArcadeDemolitionMedalLine(startButton, bind, getStore) {
    if (!startButton || typeof bind !== 'function') return;
    const refresh = () => renderArcadeDemolitionMedalLine(startButton, getStore?.() || null);
    refresh();
    for (let node = startButton.parentElement; node; node = node.parentElement) {
        if (String(node.tagName || '').toUpperCase() === 'DETAILS') bind(node, 'toggle', refresh);
    }
    const option = startButton.parentElement;
    if (!option) return;
    // The option, not the button: the button's own click binding stays the only one on it.
    bind(option, 'pointerenter', refresh);
    bind(option, 'focusin', refresh);
}
