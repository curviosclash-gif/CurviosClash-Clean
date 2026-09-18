// Copies a text to the clipboard and answers with a short toast either way.

export async function copyTextWithFeedback({ text, label, emit, eventTypes }) {
    const value = String(text || '').trim();
    if (!value) return false;
    try {
        const clipboard = globalThis.navigator?.clipboard;
        if (typeof clipboard?.writeText !== 'function') throw new Error('clipboard_unavailable');
        await clipboard.writeText(value);
        emit(eventTypes.SHOW_STATUS_TOAST, { message: `${label} kopiert.`, duration: 1200, tone: 'success' });
        return true;
    } catch {
        emit(eventTypes.SHOW_STATUS_TOAST, { message: `${label} konnte nicht kopiert werden.`, duration: 1600, tone: 'error' });
        return false;
    }
}

export function bindBuildInfoCopy({ ui, bind, emit, eventTypes }) {
    if (!ui?.copyBuildButton) return;
    bind(ui.copyBuildButton, 'click', () => copyTextWithFeedback({
        text: ui.buildInfoDetail?.textContent || ui.buildInfo?.textContent,
        label: 'Build-Info',
        emit,
        eventTypes,
    }));
}
