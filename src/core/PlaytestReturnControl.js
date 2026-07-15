// @ts-check

import { EDITOR_VIEW_PATHS } from '../shared/contracts/EditorPathContract.js';

export function installPlaytestReturnControl({ windowRef = window, documentRef = document } = {}) {
    if (!documentRef?.body || documentRef.getElementById('playtest-return-to-editor')) return () => {};
    const button = documentRef.createElement('button');
    button.id = 'playtest-return-to-editor';
    button.type = 'button';
    button.textContent = 'Zum Map-Editor';
    button.setAttribute('aria-label', 'Playtest beenden und zum Map-Editor zurueckkehren');
    Object.assign(button.style, {
        position: 'fixed', top: '14px', right: '14px', zIndex: '10000',
        padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.35)',
        background: 'rgba(8,17,31,.92)', color: '#fff', font: '600 13px system-ui', cursor: 'pointer',
    });
    const returnToEditor = () => {
        if (windowRef.opener && !windowRef.opener.closed) {
            windowRef.opener.focus?.();
            windowRef.close?.();
            return;
        }
        windowRef.location.href = `${EDITOR_VIEW_PATHS.MAP_EDITOR}?returnFromPlaytest=1`;
    };
    button.addEventListener('click', returnToEditor);
    documentRef.body.appendChild(button);
    return () => {
        button.removeEventListener('click', returnToEditor);
        button.remove();
    };
}
