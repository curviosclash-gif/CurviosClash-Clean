// ============================================
// BuildInfoController.js - build metadata render + clipboard copy helpers
// ============================================
//
// Contract:
// - Inputs: ui refs + build metadata + status-toast callback
// - Outputs: formatted build-time metadata and clipboard payload text
// - Side effects: updates build-info DOM nodes and optionally writes clipboard

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

    copyBuildInfoToClipboard(clipboardText = '') {
        const payload = clipboardText || `v${this.appVersion} \u00b7 Build ${this.buildId}`;
        const fallbackCopy = () => {
            const helper = document.createElement('textarea');
            helper.value = payload;
            helper.setAttribute('readonly', 'readonly');
            helper.style.position = 'fixed';
            helper.style.top = '-9999px';
            document.body.appendChild(helper);
            helper.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(helper);
            this.showStatusToast(copied ? 'Build-Info kopiert' : 'Kopieren nicht moeglich', 1400, copied ? 'success' : 'error');
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(payload)
                .then(() => this.showStatusToast('Build-Info kopiert', 1400, 'success'))
                .catch(() => fallbackCopy());
            return;
        }

        fallbackCopy();
    }
}
