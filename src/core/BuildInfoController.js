// ============================================
// BuildInfoController.js - build metadata render helpers
// ============================================
//
// Contract:
// - Inputs: ui refs + build metadata + status-toast callback
// - Outputs: formatted build-time metadata
// - Side effects: updates build-info DOM nodes (copying lives in src/ui/menu/MenuClipboardCopy.js)

export class BuildInfoController {
    constructor(options = {}) {
        this.ui = options.ui || null;
        this.showStatusToast = typeof options.showStatusToast === 'function'
            ? options.showStatusToast
            : (() => { });
        this.appVersion = String(options.appVersion || 'dev');
        this.buildId = String(options.buildId || 'dev');
        this.buildTime = options.buildTime || 'dev';
    }

    formatBuildTime() {
        if (this.buildTime === 'dev') {
            return {
                short: 'dev',
                iso: 'dev',
                local: 'Development Build',
            };
        }
        try {
            const date = new Date(this.buildTime);
            return {
                short: date.toLocaleDateString(),
                iso: date.toISOString(),
                local: date.toLocaleString(),
            };
        } catch {
            return { short: 'dev', iso: 'dev', local: 'Build-ID: ' + this.buildId };
        }
    }

    renderBuildInfo() {
        const buildTime = this.formatBuildTime();
        const shortInfo = `v${this.appVersion} \u00b7 Build ${this.buildId} \u00b7 ${buildTime.short}`;
        const detailInfo = [
            `Version: v${this.appVersion}`,
            `Build-ID: ${this.buildId}`,
            `Zeit (UTC): ${buildTime.iso}`,
            `Zeit (lokal): ${buildTime.local}`,
        ].join('\n');

        if (this.ui?.buildInfo) {
            this.ui.buildInfo.textContent = shortInfo;
        }
        if (this.ui?.buildInfoDetail) {
            this.ui.buildInfoDetail.textContent = detailInfo;
        }
        return detailInfo;
    }
}
