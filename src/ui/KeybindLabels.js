// ============================================
// KeybindLabels.js - shared key code -> display label formatting
// ============================================
// Used by the keybind editor and by the in-match HUD, so a rebound key shows
// the same label in both places.

const NAMED_KEY_CODES = Object.freeze({
    ArrowUp: 'Arrow Up',
    ArrowDown: 'Arrow Down',
    ArrowLeft: 'Arrow Left',
    ArrowRight: 'Arrow Right',
    ShiftLeft: 'Shift Left',
    ShiftRight: 'Shift Right',
    Space: 'Space',
    Enter: 'Enter',
    Escape: 'Escape',
    ControlLeft: 'Ctrl Left',
    ControlRight: 'Ctrl Right',
    AltLeft: 'Alt Left',
    AltRight: 'Alt Right',
});

const SHORT_KEY_CODES = Object.freeze({
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    Space: 'Space',
    Quote: "'",
    Semicolon: ';',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
});

/** Long, readable label (keybind editor rows). */
export function formatKeyCode(code) {
    if (!code) return '-';
    if (NAMED_KEY_CODES[code]) return NAMED_KEY_CODES[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
    return code;
}

/** Compact label for tight HUD surfaces such as item slot key caps. */
export function formatKeyCodeShort(code) {
    if (!code) return '-';
    if (SHORT_KEY_CODES[code]) return SHORT_KEY_CODES[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return `#${code.slice(6)}`;
    return code;
}
