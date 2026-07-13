const ALLOWED_TOAST_TONES = new Set(['info', 'success', 'error']);

function normalizeToastTone(durationMsOrTone, tone) {
    const requestedTone = typeof durationMsOrTone === 'string' ? durationMsOrTone : tone;
    return ALLOWED_TOAST_TONES.has(requestedTone) ? requestedTone : 'info';
}

function normalizeToastDuration(durationMsOrTone) {
    return typeof durationMsOrTone === 'number' ? durationMsOrTone : 1200;
}

export function showStatusToast(toast, message, durationMsOrTone = 1200, tone = 'info') {
    if (!toast) {
        return { timerId: null };
    }
    const durationMs = normalizeToastDuration(durationMsOrTone);
    const normalizedTone = normalizeToastTone(durationMsOrTone, tone);
    toast.textContent = message;
    toast.classList.remove('hidden', 'show', 'toast-info', 'toast-success', 'toast-error');
    toast.classList.add(`toast-${normalizedTone}`);
    void toast.offsetWidth;
    toast.classList.add('show');
    const timerId = setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hidden');
    }, durationMs);
    return { timerId };
}
