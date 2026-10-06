/* global window, document, location */
// Operating the app like a person: list what can be clicked or filled in a window, and
// perform real mouse, keyboard and form input through Playwright (CDP input events, no
// OS focus needed). Every action names its window; the default is the main game window.
import { findWindowPage } from './playtest-session.mjs';

export const UI_ACTIONS = Object.freeze([
    'click', 'dblclick', 'hover', 'fill', 'type', 'press', 'key_down', 'key_up', 'select', 'check', 'uncheck',
    'scroll', 'mouse_move', 'mouse_down', 'mouse_up', 'mouse_click', 'wait_for',
]);

/**
 * Visible interactive elements of a window with a selector that works for act: id when
 * there is one, otherwise data attributes, otherwise role and accessible name.
 */
export async function listInteractiveElements(session, { window: kind = 'main', limit = 120, within = null } = {}) {
    const page = await findWindowPage(session, kind, 5000);
    if (!page) throw new Error(`no ${kind} window is open`);
    return page.evaluate(({ max, scope }) => {
        const root = scope ? document.querySelector(scope) : document;
        if (!root) return { error: `scope ${scope} not found`, elements: [] };
        const candidates = root.querySelectorAll([
            'button', 'a[href]', 'input', 'select', 'textarea', 'summary', '[role="button"]', '[role="tab"]',
            '[role="menuitem"]', '[role="checkbox"]', '[role="option"]', '[data-action]', '[data-session-type]',
            '[data-mode-path]', '[tabindex]:not([tabindex="-1"])',
        ].join(','));
        const cssEscape = (value) => (window.CSS?.escape ? window.CSS.escape(value) : value.replace(/[^\w-]/g, '\\$&'));
        const out = [];
        const seen = new Set();
        for (const element of candidates) {
            if (seen.has(element)) continue;
            seen.add(element);
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
                && Number(style.opacity) > 0.05 && !element.closest('.hidden,[hidden],[aria-hidden="true"]');
            if (!visible) continue;
            const text = (element.innerText || element.value || element.getAttribute('aria-label') || element.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
            let selector = null;
            if (element.id) selector = `#${cssEscape(element.id)}`;
            else {
                for (const attribute of ['data-action', 'data-session-type', 'data-mode-path', 'data-nav-section', 'data-vehicle-id', 'name']) {
                    const value = element.getAttribute(attribute);
                    if (value) { selector = `${element.tagName.toLowerCase()}[${attribute}="${value.replace(/"/g, '\\"')}"]`; break; }
                }
            }
            if (!selector && text) selector = `${element.tagName.toLowerCase()}:has-text("${text.slice(0, 40).replace(/"/g, '\\"')}")`;
            out.push({
                selector, tag: element.tagName.toLowerCase(), type: element.type || null, role: element.getAttribute('role') || null,
                text, value: ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) && element.type !== 'password' ? String(element.value).slice(0, 60) : undefined,
                checked: element.type === 'checkbox' || element.type === 'radio' ? element.checked : undefined,
                disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
                options: element.tagName === 'SELECT' ? [...element.options].slice(0, 40).map((option) => option.value) : undefined,
                center: [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)],
            });
            if (out.length >= max) break;
        }
        return { title: document.title, url: location.href, count: out.length, elements: out };
    }, { max: limit, scope: within });
}

/**
 * Performs one UI action with real input events.
 * @param {object} spec { action, window, selector, text, key, value, x, y, deltaY, button, timeoutMs, state }
 */
export async function performUiAction(session, spec) {
    const { action, window: kind = 'main', selector = null, timeoutMs = 10_000 } = spec;
    if (!UI_ACTIONS.includes(action)) throw new Error(`unknown UI action ${action}; allowed: ${UI_ACTIONS.join(', ')}`);
    const page = await findWindowPage(session, kind, 5000);
    if (!page) throw new Error(`no ${kind} window is open`);
    const locate = () => {
        if (!selector) throw new Error(`${action} needs a selector`);
        return page.locator(selector).first();
    };
    const button = spec.button || 'left';
    switch (action) {
        case 'click': await locate().click({ timeout: timeoutMs, button }); break;
        case 'dblclick': await locate().dblclick({ timeout: timeoutMs }); break;
        case 'hover': await locate().hover({ timeout: timeoutMs }); break;
        case 'fill': await locate().fill(String(spec.text ?? spec.value ?? ''), { timeout: timeoutMs }); break;
        case 'type':
            if (selector) await locate().click({ timeout: timeoutMs });
            await page.keyboard.type(String(spec.text ?? ''), { delay: 20 });
            break;
        case 'press':
            if (selector) await locate().press(spec.key, { timeout: timeoutMs });
            else await page.keyboard.press(spec.key, { delay: Number(spec.holdMs) || 60 });
            break;
        case 'key_down':
            await page.keyboard.down(spec.key);
            session.heldKeys.add(spec.key);
            break;
        case 'key_up':
            await page.keyboard.up(spec.key);
            session.heldKeys.delete(spec.key);
            break;
        case 'select': await locate().selectOption(String(spec.value ?? spec.text), { timeout: timeoutMs }); break;
        case 'check': await locate().check({ timeout: timeoutMs }); break;
        case 'uncheck': await locate().uncheck({ timeout: timeoutMs }); break;
        case 'scroll':
            if (selector) await locate().hover({ timeout: timeoutMs });
            await page.mouse.wheel(Number(spec.deltaX) || 0, Number(spec.deltaY) || 300);
            break;
        case 'mouse_move': await page.mouse.move(Number(spec.x), Number(spec.y), { steps: Number(spec.steps) || 8 }); break;
        case 'mouse_down': await page.mouse.move(Number(spec.x), Number(spec.y)); await page.mouse.down({ button }); break;
        case 'mouse_up': await page.mouse.up({ button }); break;
        case 'mouse_click': await page.mouse.click(Number(spec.x), Number(spec.y), { button }); break;
        case 'wait_for': await locate().waitFor({ state: spec.state || 'visible', timeout: timeoutMs }); break;
        default: break;
    }
    return { action, window: kind, selector, ok: true };
}

/**
 * Leaves a running match through the pause menu like a player: "Hauptmenü" (or
 * "Verbindung trennen") only arms on the first click and ends the match on the second.
 */
export async function leaveMatchFromPauseMenu(page, { timeoutMs = 10_000 } = {}) {
    const button = page.locator('#btn-pause-menu');
    await button.click({ timeout: timeoutMs });
    await page.locator('#btn-pause-menu[data-confirm-armed="true"]').waitFor({ state: 'attached', timeout: timeoutMs });
    await button.click({ timeout: timeoutMs });
}
