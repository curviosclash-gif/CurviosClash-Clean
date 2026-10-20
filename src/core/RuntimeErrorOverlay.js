// @ts-check

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

    document.body.appendChild(overlay);
}

/**
 * @param {ErrorEvent} event
 */
function handleGlobalRuntimeError(event) {
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
    globalRuntimeErrorHandlerAttached = true;
}
