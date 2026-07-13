import { createLogger } from '../../../shared/logging/Logger.js';

const logger = createLogger('TrailCollisionDebug');

function isTruthyFlag(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function readTrailCollisionDebugConfigFromUrl() {
    if (typeof window === 'undefined' || !window.location) {
        return { enabled: false, maxLogs: 80 };
    }

    try {
        const params = new URLSearchParams(window.location.search);
        const enabled = isTruthyFlag(params.get('traildebug')) || isTruthyFlag(params.get('collisiondebug'));
        const maxLogs = parsePositiveInt(
            params.get('traildebugmax') ?? params.get('collisiondebugmax'),
            80
        );
        return { enabled, maxLogs };
    } catch {
        return { enabled: false, maxLogs: 80 };
    }
}

export class TrailCollisionDebugTelemetry {
    constructor(debugConfig = null) {
        const config = debugConfig || readTrailCollisionDebugConfigFromUrl();
        this.enabled = !!config.enabled;
        this.logCount = 0;
        this.maxLogs = parsePositiveInt(config.maxLogs, 80);
        this.skipRecentSeen = 0;
        if (this.enabled) {
            console.info(`[TrailCollisionDebug] enabled via ?traildebug=1 (maxLogs=${this.maxLogs})`);
        }
    }

    log(tag, payload) {
        if (!this.enabled) return;
        if (this.logCount >= this.maxLogs) return;
        this.logCount++;
        console.debug(`[TrailCollisionDebug:${tag}]`, payload);
        if (this.logCount === this.maxLogs) {
            logger.warn('log cap reached; suppressing further logs');
        }
    }

    shouldLogSkipRecentCandidate(dist, skipRecent) {
        if (!this.enabled) return false;
        this.skipRecentSeen++;
        if (this.skipRecentSeen <= 8) return true;
        if (dist <= 1) return true;
        if (dist >= Math.max(0, skipRecent - 2)) return true;
        return (this.skipRecentSeen % 20) === 0;
    }
}
