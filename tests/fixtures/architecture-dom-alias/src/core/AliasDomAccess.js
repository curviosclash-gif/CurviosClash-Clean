export function mountOverlay(documentRef = globalThis.document) {
    const overlay = documentRef?.createElement?.('div');
    documentRef.body.appendChild(overlay);
    return overlay;
}

export class FocusWatcher {
    constructor() {
        this._document = globalThis.document;
        this._document?.addEventListener?.('visibilitychange', () => {});
    }

    isFocused(element) {
        return document.activeElement === element;
    }
}
