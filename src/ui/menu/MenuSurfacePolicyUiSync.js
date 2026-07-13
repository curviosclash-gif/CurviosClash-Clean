import { PLATFORM_SURFACE_QUICK_START_ACTION_IDS } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import {
    PLATFORM_SURFACE_FEATURE_IDS,
    resolveSurfaceMenuState,
    resolveSurfaceEntryCopy,
} from '../../shared/contracts/PlatformSurfacePolicyOps.js';
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import { syncDesktopOnlyFeatureButton } from './MenuSurfaceFeatureAccess.js';

export function syncMenuSurfacePolicyUi({
    ui,
    settings,
    sessionType,
    surfacePolicy = null,
    huntFeatureEnabled = true,
}) {
    const surfacePolicyPort = createSurfacePolicyPort({
        getProductSurfaceId: () => surfacePolicy?.productSurfaceId || '',
        getSettings: () => settings
    });
    const surfaceMenuState = surfacePolicy
        ? resolveSurfaceMenuState(settings, {
            productSurfaceId: surfacePolicy.productSurfaceId,
        })
        : null;
    const modePath = surfaceMenuState?.modePath || String(settings?.localSettings?.modePath || 'normal').toLowerCase();
    const resolvedSessionType = surfaceMenuState?.sessionType || String(sessionType || 'single').toLowerCase();

    const surfaceEntryCopy = surfacePolicy
        ? resolveSurfaceEntryCopy({
            productSurfaceId: surfacePolicy.productSurfaceId,
            sessionType: resolvedSessionType,
        })
        : null;

    if (Array.isArray(ui.sessionButtons)) {
        ui.sessionButtons.forEach((button) => {
            const buttonSessionType = String(button?.dataset?.sessionType || '').trim().toLowerCase();
            const surfaceAllowed = !surfacePolicy || surfacePolicyPort.isSessionTypeAllowed(buttonSessionType);
            const labelNode = button?.querySelector?.('.nav-btn-label') || button;
            if (labelNode && !button.dataset.surfaceDefaultLabel) {
                button.dataset.surfaceDefaultLabel = String(labelNode.textContent || '').trim();
            }
            if (labelNode) {
                labelNode.textContent = surfaceEntryCopy?.sessionLabels?.[buttonSessionType]
                    || button.dataset.surfaceDefaultLabel
                    || String(labelNode.textContent || '').trim();
            }
            button.classList.toggle('hidden', !surfaceAllowed);
            button.setAttribute('aria-hidden', String(!surfaceAllowed));
            button.disabled = !surfaceAllowed;
            button.title = surfaceEntryCopy?.sessionDescriptions?.[buttonSessionType] || '';
            const isActive = buttonSessionType === resolvedSessionType;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    if (Array.isArray(ui.modePathButtons)) {
        ui.modePathButtons.forEach((button) => {
            const buttonModePath = String(button?.dataset?.modePath || '').trim().toLowerCase();
            const surfaceAllowed = !surfacePolicy || surfacePolicyPort.isModePathAllowed(buttonModePath);
            const isActive = buttonModePath === modePath;
            const disabledByFeatureFlag = buttonModePath === 'fight' && !huntFeatureEnabled;
            button.classList.toggle('active', isActive);
            button.classList.toggle('hidden', !surfaceAllowed);
            button.setAttribute('aria-pressed', String(isActive));
            button.setAttribute('aria-hidden', String(!surfaceAllowed));
            button.disabled = !surfaceAllowed || disabledByFeatureFlag;
            button.title = disabledByFeatureFlag ? 'Fight ist per Feature-Flag deaktiviert' : '';
        });
    }

    const quickStartButtons = [{ button: ui.quickStartLastButton, actionId: PLATFORM_SURFACE_QUICK_START_ACTION_IDS.LAST_SETTINGS }, { button: ui.quickStartEventPlaylistButton, actionId: PLATFORM_SURFACE_QUICK_START_ACTION_IDS.EVENT_PLAYLIST }, { button: ui.quickStartRandomButton, actionId: PLATFORM_SURFACE_QUICK_START_ACTION_IDS.RANDOM_MAP }];
    let visibleQuickStartCount = 0;
    quickStartButtons.forEach(({ button, actionId }) => {
        if (!button) {
            return;
        }
        const surfaceAllowed = !surfacePolicy || surfacePolicyPort.isQuickStartAllowed(actionId);
        button.classList.toggle('hidden', !surfaceAllowed);
        button.setAttribute('aria-hidden', String(!surfaceAllowed));
        button.disabled = !surfaceAllowed;
        if (surfaceAllowed) {
            visibleQuickStartCount += 1;
        }
    });

    const quickStartSection = ui.quickStartLastButton?.closest('.menu-section') || ui.quickStartEventPlaylistButton?.closest('.menu-section') || ui.quickStartRandomButton?.closest('.menu-section') || null;
    if (quickStartSection) {
        quickStartSection.classList.toggle('hidden', visibleQuickStartCount === 0);
        quickStartSection.setAttribute('aria-hidden', String(visibleQuickStartCount === 0));
    }

    if (ui.startButton) {
        ui.startButton.textContent = surfaceEntryCopy?.startButtonLabel || 'Starten';
        ui.startButton.title = surfaceEntryCopy?.startButtonTitle || '';
    }

    if (ui.multiplayerInlineState) {
        const titleNode = ui.multiplayerInlineState.querySelector('.section-title');
        const copyNode = ui.multiplayerInlineState.querySelector('.menu-accordion-copy');
        if (titleNode) {
            titleNode.textContent = surfaceEntryCopy?.multiplayerTitle || 'Lobby & Bereitschaft';
        }
        if (copyNode) {
            copyNode.textContent = surfaceEntryCopy?.multiplayerSubtitle || 'Session-Code, echte Lobby-Verbindung und Ready-Status.';
        }
    }
    if (ui.multiplayerLobbyCodeInput) {
        ui.multiplayerLobbyCodeInput.placeholder = surfaceEntryCopy?.lobbyCodePlaceholder || 'z. B. TEST-1234';
    }
    if (ui.multiplayerHostButton) {
        ui.multiplayerHostButton.textContent = surfaceEntryCopy?.hostButtonLabel || 'Host';
        ui.multiplayerHostButton.title = surfaceEntryCopy?.hostButtonTitle || '';
        ui.multiplayerHostButton.disabled = surfaceEntryCopy?.hostActionAvailable === false;
    }
    if (ui.multiplayerJoinButton) {
        ui.multiplayerJoinButton.textContent = surfaceEntryCopy?.joinButtonLabel || 'Join';
        ui.multiplayerJoinButton.title = surfaceEntryCopy?.joinButtonTitle || '';
    }

    syncDesktopOnlyFeatureButton(
        ui.openEditorButton,
        surfacePolicy,
        PLATFORM_SURFACE_FEATURE_IDS.MAP_EDITOR,
        '3D Map-Editor'
    );
    syncDesktopOnlyFeatureButton(
        ui.openVehicleEditorButton,
        surfacePolicy,
        PLATFORM_SURFACE_FEATURE_IDS.VEHICLE_EDITOR,
        'Vehicle-Editor'
    );

    return {
        modePath,
        sessionType: resolvedSessionType,
        surfaceEntryCopy,
    };
}
