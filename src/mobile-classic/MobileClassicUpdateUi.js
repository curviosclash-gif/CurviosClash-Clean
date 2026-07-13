// @ts-check

import {
    createMobileClassicGithubUpdateConfig,
    normalizeMobileClassicUpdateConfig,
} from './MobileClassicUpdateConfig.js';

const MOBILE_CLASSIC_UPDATE_PANEL_ID = 'mobile-classic-update-panel';
const MOBILE_CLASSIC_UPDATE_CHECK_ID = 'mobile-classic-update-check';
const MOBILE_CLASSIC_UPDATE_OPEN_ID = 'mobile-classic-update-open';
const MOBILE_CLASSIC_UPDATE_STATUS_ID = 'mobile-classic-update-status';
const DEFAULT_MOBILE_CLASSIC_UPDATE_CONFIG = createMobileClassicGithubUpdateConfig();
const mobileClassicUpdateState = {
    updateConfig: { ...DEFAULT_MOBILE_CLASSIC_UPDATE_CONFIG },
    updateTargetUrl: DEFAULT_MOBILE_CLASSIC_UPDATE_CONFIG.latestReleaseUrl,
};

function resolveFetch(fetchImpl = null) {
    if (typeof fetchImpl === 'function') {
        return fetchImpl;
    }
    return typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : null;
}

function resolveWindow(doc = document) {
    return doc?.defaultView || (typeof window !== 'undefined' ? window : null);
}

function ensureMobileClassicUpdateUi(doc = document) {
    if (!doc?.createElement) {
        return null;
    }
    const existing = doc.getElementById(MOBILE_CLASSIC_UPDATE_PANEL_ID);
    if (existing) {
        return existing;
    }

    const panel = doc.createElement('div');
    panel.id = MOBILE_CLASSIC_UPDATE_PANEL_ID;
    panel.className = 'mobile-classic-update-panel';

    const actions = doc.createElement('div');
    actions.className = 'mobile-classic-update-actions';

    const checkButton = doc.createElement('button');
    checkButton.type = 'button';
    checkButton.id = MOBILE_CLASSIC_UPDATE_CHECK_ID;
    checkButton.className = 'secondary-btn mobile-classic-update-btn';
    checkButton.textContent = 'Update';

    const openButton = doc.createElement('button');
    openButton.type = 'button';
    openButton.id = MOBILE_CLASSIC_UPDATE_OPEN_ID;
    openButton.className = 'secondary-btn mobile-classic-update-btn';
    openButton.textContent = 'GitHub';
    openButton.hidden = true;

    const status = doc.createElement('span');
    status.id = MOBILE_CLASSIC_UPDATE_STATUS_ID;
    status.className = 'mobile-classic-update-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    actions.append(checkButton, openButton);
    panel.append(actions, status);

    const host = doc.querySelector('.menu-utility-shell')
        || doc.querySelector('.menu-hero-shell')
        || doc.getElementById('main-menu')
        || doc.body;
    host?.appendChild(panel);
    return panel;
}

function getMobileClassicUpdateRefs(doc = document) {
    return {
        panel: doc.getElementById(MOBILE_CLASSIC_UPDATE_PANEL_ID),
        checkButton: doc.getElementById(MOBILE_CLASSIC_UPDATE_CHECK_ID),
        openButton: doc.getElementById(MOBILE_CLASSIC_UPDATE_OPEN_ID),
        status: doc.getElementById(MOBILE_CLASSIC_UPDATE_STATUS_ID),
    };
}

export async function hydrateMobileClassicUpdateConfig(doc = document, fetchImpl = null) {
    const fetcher = resolveFetch(fetchImpl);
    if (!fetcher) {
        return mobileClassicUpdateState.updateConfig;
    }
    try {
        const response = await fetcher('./mobile-classic.manifest.json', {
            cache: 'no-store',
        });
        if (!response?.ok) {
            return mobileClassicUpdateState.updateConfig;
        }
        const manifest = await response.json();
        mobileClassicUpdateState.updateConfig = normalizeMobileClassicUpdateConfig(manifest);
        mobileClassicUpdateState.updateTargetUrl = mobileClassicUpdateState.updateConfig.latestReleaseUrl;
    } catch {
        // Offline starts keep the static release fallback.
    }
    return mobileClassicUpdateState.updateConfig;
}

export function openMobileClassicUpdateTarget(doc = document) {
    const targetUrl = mobileClassicUpdateState.updateTargetUrl
        || mobileClassicUpdateState.updateConfig.latestReleaseUrl;
    const ownerWindow = resolveWindow(doc);
    const opened = ownerWindow?.open?.(targetUrl, '_blank', 'noopener');
    if (!opened && ownerWindow?.location) {
        ownerWindow.location.href = targetUrl;
    }
}

export async function checkMobileClassicGithubRelease(doc = document, fetchImpl = null) {
    const refs = getMobileClassicUpdateRefs(doc);
    const fetcher = resolveFetch(fetchImpl);
    if (refs.checkButton) {
        refs.checkButton.disabled = true;
    }
    if (refs.openButton) {
        refs.openButton.hidden = true;
    }
    if (refs.status) {
        refs.status.textContent = 'GitHub prueft';
    }

    if (!fetcher) {
        if (refs.status) {
            refs.status.textContent = 'GitHub Releases';
        }
        if (refs.openButton) {
            refs.openButton.hidden = false;
        }
        if (refs.checkButton) {
            refs.checkButton.disabled = false;
        }
        return null;
    }

    try {
        const response = await fetcher(mobileClassicUpdateState.updateConfig.apiUrl, {
            cache: 'no-store',
            headers: { Accept: 'application/vnd.github+json' },
        });
        if (!response?.ok) {
            throw new Error(`${response?.status || 0} ${response?.statusText || 'GitHub'}`);
        }
        const release = await response.json();
        mobileClassicUpdateState.updateTargetUrl = release.html_url
            || mobileClassicUpdateState.updateConfig.latestReleaseUrl;
        if (refs.status) {
            refs.status.textContent = `Update ${release.tag_name || release.name || 'Release'}`;
        }
        return release;
    } catch {
        mobileClassicUpdateState.updateTargetUrl = mobileClassicUpdateState.updateConfig.latestReleaseUrl;
        if (refs.status) {
            refs.status.textContent = 'GitHub Releases';
        }
        return null;
    } finally {
        if (refs.openButton) {
            refs.openButton.hidden = false;
        }
        if (refs.checkButton) {
            refs.checkButton.disabled = false;
        }
    }
}

export function setupMobileClassicUpdateUi(doc = document) {
    const panel = ensureMobileClassicUpdateUi(doc);
    if (!panel || panel.dataset.updateBound === '1') {
        return panel;
    }
    const refs = getMobileClassicUpdateRefs(doc);
    refs.checkButton?.addEventListener('click', () => {
        void checkMobileClassicGithubRelease(doc);
    });
    refs.openButton?.addEventListener('click', () => {
        openMobileClassicUpdateTarget(doc);
    });
    panel.dataset.updateBound = '1';
    void hydrateMobileClassicUpdateConfig(doc);
    return panel;
}
