// Page visibility is the one document detail that input, lobby and telemetry code outside
// src/ui needs. Reading it here gives the DOM guard one named exception instead of scattered
// document reads. Pass a document to use an injected one; omit it to use the global document.

function resolveDocument(documentRef) {
    if (documentRef !== undefined) return documentRef;
    return typeof globalThis.document !== 'undefined' ? globalThis.document : null;
}

/** True while the page is hidden or another window has the focus. */
export function isPageInactive(documentRef) {
    documentRef = resolveDocument(documentRef);
    return documentRef?.hidden === true || documentRef?.hasFocus?.() === false;
}

export function addPageVisibilityListener(documentRef, handler) {
    documentRef = resolveDocument(documentRef);
    documentRef?.addEventListener?.('visibilitychange', handler);
}

export function removePageVisibilityListener(documentRef, handler) {
    documentRef = resolveDocument(documentRef);
    documentRef?.removeEventListener?.('visibilitychange', handler);
}
