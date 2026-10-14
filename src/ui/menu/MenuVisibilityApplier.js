const KEY_ATTRIBUTE = 'data-menu-visibility-key';
const REASON_ATTRIBUTE = 'data-menu-disabled-reason';

function setFlag(element, name, on) {
    if (on) element.setAttribute(name, 'true');
    else element.removeAttribute(name);
}

/**
 * Applies a resolved menu visibility result to every element carrying
 * `data-menu-visibility-key`. Uses the `hidden` property, never the `.hidden` class.
 * @param {ParentNode|null} root
 * @param {{visible: object, enabled: object, reasons: object}|null} result
 * @param {{touchDisabled?: boolean}} [options] `touchDisabled: false` leaves disabled and aria-disabled
 *   to the element's owner, e.g. a button whose lock comes from the surface policy.
 */
export function applyMenuVisibility(root, result, { touchDisabled = true } = {}) {
    if (!root || !result) return;
    const elements = root.querySelectorAll(`[${KEY_ATTRIBUTE}]`);
    for (let i = 0; i < elements.length; i++) {
        const element = /** @type {HTMLElement} */ (elements[i]);
        const key = element.getAttribute(KEY_ATTRIBUTE);
        if (!(key in result.visible)) continue;
        const visible = result.visible[key] === true;
        const enabled = result.enabled[key] === true;
        element.hidden = !visible;
        setFlag(element, 'aria-hidden', !visible);
        if (!touchDisabled) continue;
        setFlag(element, 'aria-disabled', visible && !enabled);
        if ('disabled' in element) element.disabled = visible && !enabled;
        const reason = enabled ? null : result.reasons[key];
        if (reason) element.setAttribute(REASON_ATTRIBUTE, reason);
        else element.removeAttribute(REASON_ATTRIBUTE);
    }
}
