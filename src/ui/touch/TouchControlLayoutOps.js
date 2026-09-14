export const TOUCH_CONTROL_MODES = Object.freeze({
    JOYSTICK: 'joystick',
    TILT: 'tilt',
});

const JOYSTICK_BUTTON_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'fire', label: 'FIRE', bottom: '36%', right: '5%', size: 62 }),
    Object.freeze({ id: 'useItem', label: 'USE', bottom: '20%', right: '5%', size: 62 }),
    Object.freeze({ id: 'shootMG', label: 'MG', bottom: '36%', right: '20%', size: 54 }),
    Object.freeze({ id: 'nextItem', label: 'NEXT', bottom: '20%', right: '20%', size: 54 }),
    Object.freeze({ id: 'boost', label: 'BOOST', bottom: '52%', right: '12%', size: 54 }),
]);

const TILT_BUTTON_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'fire', label: 'SCHUSS', bottom: '9%', right: '6%', size: 86 }),
    Object.freeze({ id: 'useItem', label: 'ITEM', bottom: '9%', right: '35%', size: 58 }),
    Object.freeze({ id: 'nextItem', label: 'NXT', bottom: '9%', right: '52%', size: 52 }),
    Object.freeze({ id: 'boost', label: 'BOOST', bottom: '24%', right: '24%', size: 56 }),
]);

const MOBILE_ARCADE_PAUSE_BUTTON_DEFINITION = Object.freeze({
    id: 'pause',
    label: 'PAUSE',
    top: 'max(14px, env(safe-area-inset-top))',
    right: 'max(14px, env(safe-area-inset-right))',
    size: 58,
});

function resolveOwnerDocument(containerEl) {
    return containerEl?.ownerDocument || (typeof document !== 'undefined' ? document : null);
}

export function resolveTouchButtonDefinitions(controlMode = TOUCH_CONTROL_MODES.JOYSTICK, options = {}) {
    const definitions = controlMode === TOUCH_CONTROL_MODES.TILT
        ? TILT_BUTTON_DEFINITIONS
        : JOYSTICK_BUTTON_DEFINITIONS;
    const resolved = definitions.map((definition) => ({ ...definition }));
    if (options?.includePauseButton === true) {
        resolved.push({ ...MOBILE_ARCADE_PAUSE_BUTTON_DEFINITION });
    }
    return resolved;
}

export function createTouchJoystickElements({ containerEl, joystickRadius = 60 } = {}) {
    const doc = resolveOwnerDocument(containerEl);
    const joystickEl = doc?.createElement?.('div') || null;
    const joystickKnobEl = doc?.createElement?.('div') || null;
    if (!containerEl || !joystickEl || !joystickKnobEl) {
        return { joystickEl: null, joystickKnobEl: null };
    }

    joystickEl.className = 'touch-joystick';
    joystickEl.style.cssText = `
        position: fixed; bottom: 20%; left: 5%;
        width: ${joystickRadius * 2}px; height: ${joystickRadius * 2}px;
        border-radius: 50%; border: 2px solid rgba(255,255,255,0.4);
        background: rgba(0,0,0,0.2); touch-action: none; z-index: 1000;
    `;
    joystickKnobEl.className = 'touch-joystick-knob';
    joystickKnobEl.style.cssText = `
        position: absolute; top: 50%; left: 50%;
        width: 40px; height: 40px; margin: -20px 0 0 -20px;
        border-radius: 50%; background: rgba(255,255,255,0.6);
    `;
    joystickEl.appendChild(joystickKnobEl);
    containerEl.appendChild(joystickEl);
    return { joystickEl, joystickKnobEl };
}

export function createTouchButtonElements({ containerEl, buttonDefinitions = [] } = {}) {
    const doc = resolveOwnerDocument(containerEl);
    const buttonEls = {};
    if (!containerEl || !doc?.createElement) {
        return buttonEls;
    }

    for (const def of buttonDefinitions) {
        const size = Number(def.size) || 60;
        const verticalPosition = def.top
            ? `top: ${def.top};`
            : `bottom: ${def.bottom};`;
        const horizontalPosition = def.left
            ? `left: ${def.left};`
            : `right: ${def.right};`;
        const button = doc.createElement('div');
        button.className = `touch-button touch-button-${def.id}`;
        button.dataset.action = def.id;
        button.dataset.baseLabel = def.label;
        button.textContent = def.label;
        button.style.cssText = `
            position: fixed; ${verticalPosition} ${horizontalPosition}
            width: ${size}px; height: ${size}px; border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.4); background: rgba(0,0,0,0.3);
            color: white; display: flex; align-items: center; justify-content: center;
            font-size: 11px; font-weight: bold; touch-action: none;
            user-select: none; z-index: 1000;
            transition: opacity 120ms ease, transform 120ms ease, border-color 120ms ease;
        `;
        containerEl.appendChild(button);
        buttonEls[def.id] = button;
    }
    return buttonEls;
}

export function createTouchTiltControlElements({ containerEl, activateHandler } = {}) {
    const doc = resolveOwnerDocument(containerEl);
    const tiltButtonEl = doc?.createElement?.('button') || null;
    const tiltStatusEl = doc?.createElement?.('div') || null;
    if (!containerEl || !tiltButtonEl || !tiltStatusEl) {
        return { tiltButtonEl: null, tiltStatusEl: null };
    }

    tiltButtonEl.type = 'button';
    tiltButtonEl.className = 'touch-tilt-button';
    tiltButtonEl.dataset.tiltAction = 'calibrate';
    tiltButtonEl.textContent = 'NEIGUNG';
    tiltButtonEl.style.cssText = `
        position: fixed; top: max(14px, env(safe-area-inset-top)); left: max(14px, env(safe-area-inset-left));
        min-width: 96px; min-height: 42px; border-radius: 999px;
        border: 1px solid rgba(132,226,255,0.72); background: rgba(4,12,20,0.66);
        color: white; font-size: 12px; font-weight: 800; letter-spacing: 0;
        touch-action: manipulation; user-select: none; z-index: 1001;
    `;
    if (typeof activateHandler === 'function') {
        tiltButtonEl.addEventListener('click', activateHandler);
    }
    containerEl.appendChild(tiltButtonEl);

    tiltStatusEl.className = 'touch-tilt-status';
    tiltStatusEl.textContent = 'TILT';
    tiltStatusEl.style.cssText = `
        position: fixed; top: max(60px, calc(env(safe-area-inset-top) + 58px)); left: max(16px, env(safe-area-inset-left));
        color: rgba(210,245,255,0.82); font-size: 11px; font-weight: 700;
        text-shadow: 0 1px 8px rgba(0,0,0,0.7); z-index: 1001;
        pointer-events: none; user-select: none;
    `;
    containerEl.appendChild(tiltStatusEl);
    return { tiltButtonEl, tiltStatusEl };
}

export function applyTouchControlsVisibility({
    containerEl,
    joystickEl,
    buttonEls = {},
    tiltButtonEl,
    tiltStatusEl,
    visible = false,
    overlayActive = false,
    showJoystickFallback = false,
} = {}) {
    const controlsVisible = visible && !overlayActive;
    if (joystickEl) {
        joystickEl.style.display = controlsVisible && showJoystickFallback ? '' : 'none';
    }
    for (const element of Object.values(buttonEls)) {
        if (element) element.style.display = controlsVisible ? 'flex' : 'none';
    }
    if (tiltButtonEl) tiltButtonEl.style.display = controlsVisible ? 'flex' : 'none';
    if (tiltStatusEl) tiltStatusEl.style.display = controlsVisible ? 'block' : 'none';

    if (containerEl?.id === 'touch-controls') {
        containerEl.style.display = visible ? 'block' : 'none';
        containerEl.style.pointerEvents = controlsVisible ? 'auto' : 'none';
        containerEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
        containerEl.dataset.overlayActive = overlayActive ? '1' : '0';
    }
    return { controlsVisible };
}

export function applyTouchButtonVisualState(button, {
    enabled = true,
    visible = true,
    controlsVisible = true,
    title = '',
} = {}) {
    if (!button) return;
    button.style.display = visible && controlsVisible ? 'flex' : 'none';
    button.title = title;
    button.dataset.enabled = enabled ? '1' : '0';
    button.style.opacity = enabled ? '1' : '0.35';
    button.style.transform = enabled ? 'scale(1)' : 'scale(0.96)';
    button.style.borderColor = enabled ? 'rgba(132,226,255,0.85)' : 'rgba(255,255,255,0.18)';
    button.style.boxShadow = enabled ? '0 0 14px rgba(0,170,255,0.18)' : 'none';
}

export function shouldStartFloatingJoystick({
    touch,
    target,
    joystickEl,
    joystickActive = false,
    showJoystickFallback = false,
    containerEl,
} = {}) {
    if (!joystickEl || joystickActive || !showJoystickFallback) {
        return false;
    }
    if (target?.closest?.('[data-action], [data-tilt-action], button, input, select, textarea, a')) {
        return false;
    }
    const ownerWindow = containerEl?.ownerDocument?.defaultView
        || (typeof window !== 'undefined' ? window : null);
    const viewportWidth = Number(ownerWindow?.innerWidth)
        || Number(containerEl?.ownerDocument?.documentElement?.clientWidth)
        || 0;
    const viewportHeight = Number(ownerWindow?.innerHeight)
        || Number(containerEl?.ownerDocument?.documentElement?.clientHeight)
        || 0;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
        return false;
    }
    return touch?.clientX <= viewportWidth * 0.5
        && touch?.clientY >= viewportHeight * 0.16;
}

export function positionFloatingJoystick(joystickEl, { clientX, clientY, joystickRadius = 60 } = {}) {
    if (!joystickEl) return;
    const left = Math.round(Number(clientX) - joystickRadius);
    const top = Math.round(Number(clientY) - joystickRadius);
    joystickEl.style.setProperty('left', `${left}px`, 'important');
    joystickEl.style.setProperty('top', `${top}px`, 'important');
    joystickEl.style.setProperty('bottom', 'auto', 'important');
}

export function restoreJoystickHomePosition(joystickEl) {
    if (!joystickEl) return;
    joystickEl.style.setProperty('left', '5%');
    joystickEl.style.setProperty('bottom', '20%');
    joystickEl.style.setProperty('top', 'auto');
}
