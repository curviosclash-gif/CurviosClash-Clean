// ============================================
// NetworkHud.js - ping, status, warnings overlay
// ============================================

/**
 * Displays network status in a small HUD corner overlay:
 * - Ping (color-coded: green <10ms, yellow 10-80ms, red >80ms)
 * - Player count
 * - Connection status indicator
 * - Disconnect-Warning Overlay (C.2)
 * - Reconnect-Countdown (C.2)
 * - Bandbreiten-Anzeige (C.2)
 */
export class NetworkHud {
    constructor() {
        this._element = null;
        this._pingEl = null;
        this._playersEl = null;
        this._statusEl = null;
        this._bandwidthEl = null;
        this._visible = false;

        /** Disconnect warning overlay (C.2) */
        this._warningOverlay = null;
        this._warningTextEl = null;
        this._countdownEl = null;
        this._warningVisible = false;
    }

    create(container) {
        this._element = document.createElement('div');
        this._element.className = 'network-hud';
        this._element.style.cssText = `
            position: fixed; top: 8px; right: 8px; z-index: 900;
            background: rgba(0,0,0,0.6); color: white; padding: 6px 10px;
            border-radius: 4px; font-size: 12px; font-family: monospace;
            pointer-events: none; display: none;
        `;

        this._pingEl = document.createElement('div');
        this._playersEl = document.createElement('div');
        this._statusEl = document.createElement('div');
        this._bandwidthEl = document.createElement('div');
        this._bandwidthEl.style.cssText = 'color: #aaa; font-size: 10px;';

        this._element.appendChild(this._pingEl);
        this._element.appendChild(this._playersEl);
        this._element.appendChild(this._statusEl);
        this._element.appendChild(this._bandwidthEl);

        // Create disconnect warning overlay (C.2)
        this._warningOverlay = document.createElement('div');
        this._warningOverlay.className = 'network-disconnect-overlay';
        this._warningOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); z-index: 9999;
            display: none; align-items: center; justify-content: center;
            flex-direction: column;
        `;

        this._warningTextEl = document.createElement('div');
        this._warningTextEl.style.cssText = `
            color: #f44336; font-size: 28px; font-weight: bold;
            font-family: sans-serif; text-align: center; margin-bottom: 16px;
        `;

        this._countdownEl = document.createElement('div');
        this._countdownEl.style.cssText = `
            color: #ff9800; font-size: 20px; font-family: monospace;
            text-align: center;
        `;

        this._warningOverlay.appendChild(this._warningTextEl);
        this._warningOverlay.appendChild(this._countdownEl);

        const target = container || document.body;
        target.appendChild(this._element);
        target.appendChild(this._warningOverlay);
    }

    show() {
        if (this._element) {
            this._element.style.display = 'block';
            this._visible = true;
        }
    }

    hide() {
        if (this._element) {
            this._element.style.display = 'none';
            this._visible = false;
        }
    }

    update(stats) {
        if (!this._visible) return;

        const ping = stats.ping ?? 0;
        const players = stats.players ?? 0;
        const maxPlayers = stats.maxPlayers ?? 10;
        const connected = stats.connected ?? false;

        let pingColor = '#4caf50';
        if (ping > 80) pingColor = '#f44336';
        else if (ping > 10) pingColor = '#ff9800';

        if (this._pingEl) {
            this._pingEl.textContent = `Ping: ${ping}ms`;
            this._pingEl.style.color = pingColor;
        }
        if (this._playersEl) {
            this._playersEl.textContent = `Spieler: ${players}/${maxPlayers}`;
        }
        if (this._statusEl) {
            this._statusEl.innerHTML = connected
                ? '<span style="color:#4caf50">\u25CF Verbunden</span>'
                : '<span style="color:#f44336">\u25CF Getrennt</span>';
        }

        // Bandwidth display (C.2)
        if (this._bandwidthEl && stats.bandwidthKBs != null) {
            this._bandwidthEl.textContent = `BW: ${stats.bandwidthKBs.toFixed(1)} KB/s`;
        } else if (this._bandwidthEl) {
            this._bandwidthEl.textContent = '';
        }
    }

    /** Show disconnect warning overlay with optional reconnect countdown (C.2) */
    showDisconnectWarning(message, reconnectRemainingMs) {
        if (!this._warningOverlay) return;
        this._warningTextEl.textContent = message || 'Verbindung getrennt';
        if (reconnectRemainingMs != null && reconnectRemainingMs > 0) {
            const secs = Math.ceil(reconnectRemainingMs / 1000);
            this._countdownEl.textContent = `Reconnect in ${secs}s...`;
        } else {
            this._countdownEl.textContent = '';
        }
        this._warningOverlay.style.display = 'flex';
        this._warningVisible = true;
    }

    /** Update reconnect countdown (C.2) */
    updateReconnectCountdown(remainingMs) {
        if (!this._countdownEl) return;
        if (remainingMs > 0) {
            const secs = Math.ceil(remainingMs / 1000);
            this._countdownEl.textContent = `Reconnect in ${secs}s...`;
        } else {
            this._countdownEl.textContent = 'Reconnect-Fenster abgelaufen';
        }
    }

    /** Hide disconnect warning overlay (C.2) */
    hideDisconnectWarning() {
        if (this._warningOverlay) {
            this._warningOverlay.style.display = 'none';
            this._warningVisible = false;
        }
    }

    /** Show host disconnected dialog (C.2) */
    showHostDisconnected() {
        this.showDisconnectWarning('Host getrennt \u2014 Match beendet', null);
        this._countdownEl.textContent = '';
    }

    get isWarningVisible() {
        return this._warningVisible;
    }

    dispose() {
        if (this._element?.parentNode) {
            this._element.parentNode.removeChild(this._element);
        }
        if (this._warningOverlay?.parentNode) {
            this._warningOverlay.parentNode.removeChild(this._warningOverlay);
        }
        this._element = null;
        this._warningOverlay = null;
    }
}
