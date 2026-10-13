import { resolveLevel4ResetLabel } from '../../shared/settings/Level4ResetScopes.js';

/**
 * Points the drawer's reset button at the open tab: "<Tab> zurücksetzen", or hidden when the tab
 * has nothing to reset. The click handler reads the tab from data-level4-reset-section.
 * @param {HTMLElement | null | undefined} button
 * @param {string} sectionId
 */
export function syncLevel4ResetButton(button, sectionId) {
    if (!button) return;
    const label = resolveLevel4ResetLabel(sectionId);
    const visible = label !== '';
    button.dataset.level4ResetSection = sectionId;
    // An armed button shows the confirm text; the label comes back once it disarms.
    if (visible && button.getAttribute('data-reset-armed') !== 'true') button.textContent = label;
    button.hidden = !visible;
    button.classList.toggle('hidden', !visible);
    button.setAttribute('aria-hidden', String(!visible));
    button.disabled = !visible;
}
