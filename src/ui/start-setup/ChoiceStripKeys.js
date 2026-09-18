// Keyboard for a tile strip with a roving tab stop: Tab reaches the chosen tile,
// arrow keys (and Home/End) move focus and choice along the strip.

const STEP_BY_KEY = Object.freeze({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 });

export function bindChoiceStripKeys({ strip, datasetKey, onChoose, bind }) {
    if (!strip || typeof onChoose !== 'function') return;
    const listen = typeof bind === 'function' ? bind : (el, type, handler) => el.addEventListener(type, handler);
    listen(strip, 'keydown', (event) => {
        const items = Array.from(strip.querySelectorAll?.(`[data-${datasetKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`) || [])
            .filter((item) => !item.disabled);
        if (items.length === 0) return;
        const doc = strip.ownerDocument;
        let index = items.indexOf(event.target);
        if (index < 0) index = items.indexOf(doc?.activeElement);
        if (index < 0) index = Math.max(0, items.findIndex((item) => item.getAttribute?.('aria-selected') === 'true'));
        let next;
        if (event.key in STEP_BY_KEY) next = Math.max(0, Math.min(items.length - 1, index + STEP_BY_KEY[event.key]));
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else return;
        event.preventDefault?.();
        const target = items[next];
        if (next !== index || items[index] !== doc?.activeElement) {
            items.forEach((item) => { item.tabIndex = item === target ? 0 : -1; });
            target.focus?.();
        }
        if (next !== index) onChoose(target.dataset[datasetKey]);
    });
}
