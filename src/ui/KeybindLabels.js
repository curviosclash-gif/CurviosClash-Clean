// ============================================
// KeybindLabels.js - shared key code -> display label formatting
// ============================================
// Used by the keybind editor and by the in-match HUD, so a rebound key shows
// the same label in both places.

// German names, as printed on a German keyboard.
const NAMED_KEY_CODES = Object.freeze({
    ArrowUp: 'Pfeil hoch',
    ArrowDown: 'Pfeil runter',
    ArrowLeft: 'Pfeil links',
    ArrowRight: 'Pfeil rechts',
    ShiftLeft: 'Umschalt links',
    ShiftRight: 'Umschalt rechts',
    Space: 'Leertaste',
    Enter: 'Eingabe',
    Escape: 'Esc',
    Backspace: 'Rücktaste',
    Tab: 'Tab',
    CapsLock: 'Feststell',
    ControlLeft: 'Strg links',
    ControlRight: 'Strg rechts',
    AltLeft: 'Alt',
    AltRight: 'Alt Gr',
    NumpadDivide: 'Num /',
    NumpadMultiply: 'Num *',
    NumpadSubtract: 'Num -',
    NumpadAdd: 'Num +',
    NumpadEnter: 'Num Eingabe',
    NumpadDecimal: 'Num ,',
});

const SHORT_KEY_CODES = Object.freeze({
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'Umsch',
    ShiftRight: 'Umsch',
    ControlLeft: 'Strg',
    ControlRight: 'Strg',
    AltLeft: 'Alt',
    AltRight: 'AltGr',
    Space: 'Leer',
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
