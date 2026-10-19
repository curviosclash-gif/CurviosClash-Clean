// @ts-check

import { createLogger } from '../shared/logging/Logger.js';

const logger = createLogger('Runtime');

/**
 * @typedef {object} RuntimeErrorOverlayPayload
 * @property {string=} title
 * @property {string[]=} lines
 * @property {string | null=} stack
 */

let globalRuntimeErrorHandlerAttached = false;

/**
 * @param {RuntimeErrorOverlayPayload} payload
 */
export function showRuntimeErrorOverlay({ title, lines = [], stack = null } = {}) {
    const existing = document.getElementById('runtime-error-overlay');
    if (existing) {
        existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'runtime-error-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(50,0,0,0.9);color:#fff;padding:20px;z-index:99999;font-family:monospace;overflow:auto;';

    const heading = document.createElement('h1');
    heading.textContent = String(title || 'ERROR');
    overlay.appendChild(heading);

    if (Array.isArray(lines)) {
        for (let i = 0; i < lines.length; i += 1) {
            const text = String(lines[i] ?? '').trim();
            if (!text) continue;
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            overlay.appendChild(paragraph);
        }
    }

    const stackElement = document.createElement('pre');
    stackElement.textContent = String(stack || 'No stack trace');
    overlay.appendChild(stackElement);

    // The notice must never trap the player: closing it uncovers the screen. After a stray window
    // error the game keeps running; after a stopped game loop the last frame stays until a reload.
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Schließen';
    closeButton.addEventListener('click', () => overlay.remove());
    overlay.appendChild(closeButton);

    document.body.appendChild(overlay);
}

// Browser noise that is not a game failure: ResizeObserver reports a skipped layout pass, and
// "Script error." without a file is an opaque error from a foreign origin we cannot act on.
/**
 * @param {ErrorEvent} event
 */
function isBenignRuntimeError(event) {
    const message = String(event?.message || '');
    if (message.startsWith('ResizeObserver loop')) return true;
    return message === 'Script error.' && !event?.filename;
}

/**
 * @param {ErrorEvent} event
 */
function handleGlobalRuntimeError(event) {
    if (isBenignRuntimeError(event)) return;
    showRuntimeErrorOverlay({
        title: 'CRITICAL ERROR',
        lines: [
            String(event?.message || ''),
            `${String(event?.filename || '')}:${Number(event?.lineno) || 0}:${Number(event?.colno) || 0}`,
        ],
        stack: event?.error?.stack || 'No stack trace',
    });
}

export function attachGlobalRuntimeErrorHandler() {
    if (globalRuntimeErrorHandlerAttached) return;
    window.addEventListener('error', handleGlobalRuntimeError);
    // Async failures used to vanish without a trace; log them instead of covering the game.
    window.addEventListener('unhandledrejection', (event) => {
        logger.error('Unhandled promise rejection:', event?.reason);
    });
    globalRuntimeErrorHandlerAttached = true;
}
