export class MatchFeedbackAdapter {
    constructor({ showToast, logger = console } = {}) {
        this.showToast = typeof showToast === 'function' ? showToast : null;
        this.logger = logger || console;
    }

    applyFeedbackPlan(feedbackPlan) {
        if (!feedbackPlan) return;

        for (const entry of feedbackPlan.consoleEntries || []) {
            const level = entry?.level === 'warn' ? 'warn' : 'log';
            const args = Array.isArray(entry?.args) ? entry.args : [entry];
            if (typeof this.logger?.[level] === 'function') {
                this.logger[level](...args);
            }
        }

        if (!this.showToast) return;
        for (const toast of feedbackPlan.toasts || []) {
            this.showToast(toast.message, toast.durationMs, toast.tone);
        }
    }
}

