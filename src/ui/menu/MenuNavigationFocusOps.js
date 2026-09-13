export function isAvailable(element) {
    if (!element || element.disabled || element.matches?.(':disabled') || element.getAttribute?.('aria-disabled') === 'true') return false;
    if (element.closest?.('[inert], [hidden], [aria-hidden="true"], .hidden')) return false;
    let ancestor = element.parentElement;
    while (ancestor) {
        if (ancestor.tagName === 'DETAILS' && !ancestor.open
            && !ancestor.querySelector('summary')?.contains(element)) return false;
        ancestor = ancestor.parentElement;
    }
    return !element.getClientRects || element.getClientRects().length > 0;
}

export function getFocusableElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(
        'button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(isAvailable);
}

export function focusWithoutScroll(element) {
    if (!element || typeof element.focus !== 'function') return;
    try {
        element.focus({ preventScroll: true });
    } catch {
        element.focus();
    }
}

export function moveMainMenuFocus(actions, direction, active) {
    if (!actions.includes(active) || !active.getBoundingClientRect) {
        actions[0]?.focus();
        return;
    }
    const origin = active.getBoundingClientRect();
    const horizontal = direction === 'left' || direction === 'right';
    const sign = direction === 'left' || direction === 'up' ? -1 : 1;
    const candidates = actions.filter((entry) => entry !== active).map((entry) => {
        const rect = entry.getBoundingClientRect();
        const dx = rect.x + rect.width / 2 - origin.x - origin.width / 2;
        const dy = rect.y + rect.height / 2 - origin.y - origin.height / 2;
        return { entry, along: (horizontal ? dx : dy) * sign, across: Math.abs(horizontal ? dy : dx) };
    }).filter((candidate) => candidate.along > 1 && (!horizontal || candidate.across < origin.height / 2));
    candidates.sort((a, b) => (a.along + a.across * 2) - (b.along + b.across * 2));
    candidates[0]?.entry.focus();
}


export function adjustGamepadControl(active, direction) {
    const delta = direction === 'left' ? -1 : 1;
    if ((direction === 'left' || direction === 'right') && isAvailable(active)) {
        if (active.matches?.('input[type="range"]')) {
            if (delta > 0) active.stepUp();
            else active.stepDown();
            active.dispatchEvent(new Event('input', { bubbles: true }));
            active.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        if (active.tagName === 'SELECT') {
            const options = Array.from(active.options).filter((option) => !option.disabled && !option.hidden);
            if (!options.length) return true;
            const index = options.indexOf(active.selectedOptions[0]);
            active.value = options[(index + delta + options.length) % options.length].value;
            active.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
    }
    return false;
}
