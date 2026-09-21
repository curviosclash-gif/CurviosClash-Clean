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
    menuTextRuntime = null,
    releaseState = null,
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
    const developerModeEnabled = !!settings?.localSettings?.developerModeEnabled
        && !!releaseState?.featureEnabled
        && !releaseState?.releasePreviewEnabled;
    const resolveMenuText = (textId, defaultText) => menuTextRuntime?.resolveText?.(textId, {
        defaultText,
        allowOverrides: true,
        developerFeatureEnabled: !!releaseState?.featureEnabled,
        developerModeEnabled,
        releasePreviewEnabled: !!releaseState?.releaseCutEnabled,
    }) || defaultText;

    if (ui.mainTutorialButton) {
        const completed = settings?.localSettings?.classicTutorial?.completed === true;
        ui.mainTutorialButton.textContent = completed
            ? resolveMenuText('menu.utility.tutorial.completed.label', 'Tutorial abgeschlossen — nochmal spielen')
            : resolveMenuText('menu.utility.tutorial.label', 'Neu hier? Steuerung lernen');
        ui.mainTutorialButton.classList.toggle('tutorial-completed', completed);
    }

    if (Array.isArray(ui.sessionButtons)) {
        ui.sessionButtons.forEach((button) => {
            const buttonSessionType = String(button?.dataset?.sessionType || '').trim().toLowerCase();
            const sessionTextId = {
                single: 'menu.level1.single.label',
                multiplayer: 'menu.level1.multiplayer.label',
                splitscreen: 'menu.level1.splitscreen.label',
            }[buttonSessionType] || '';
            const surfaceAllowed = !surfacePolicy || surfacePolicyPort.isSessionTypeAllowed(buttonSessionType);
            const labelNode = button?.querySelector?.('.nav-btn-label') || button;
            if (labelNode && !button.dataset.surfaceDefaultLabel) {
                button.dataset.surfaceDefaultLabel = String(labelNode.textContent || '').trim();
            }
            if (labelNode) {
                const surfaceSessionLabel = surfaceEntryCopy?.sessionLabels?.[buttonSessionType]
                    || button.dataset.surfaceDefaultLabel
                    || String(labelNode.textContent || '').trim();
                labelNode.textContent = sessionTextId
                    ? resolveMenuText(sessionTextId, surfaceSessionLabel)
                    : surfaceSessionLabel;
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
            button.title = disabledByFeatureFlag ? 'Kampf ist per Feature-Flag deaktiviert' : '';
        });
    }

    if (ui.openFightHangarButton) {
        const hangarWindowAvailable = ui.openFightHangarButton.dataset.hangarWindowAvailable !== 'false';
        const hangarVisible = modePath === 'fight' && hangarWindowAvailable;
        ui.openFightHangarButton.classList.toggle('hidden', !hangarVisible);
        ui.openFightHangarButton.setAttribute('aria-hidden', String(!hangarVisible));
        ui.openFightHangarButton.disabled = !hangarWindowAvailable;
    }

    // Sector count, combo window and multiplier only mean something for an Arcade run;
    // round wins mean nothing there because the sector count ends the run.
    if (Array.isArray(ui.arcadeOnlySections)) {
        ui.arcadeOnlySections.forEach((section) => {
            section.classList.toggle('hidden', modePath !== 'arcade');
        });
    }
    if (Array.isArray(ui.nonArcadeSections)) {
        ui.nonArcadeSections.forEach((section) => {
            section.classList.toggle('hidden', modePath === 'arcade');
        });
    }

    const quickStartButtons = [
        { button: ui.quickStartLastButton, actionId: PLATFORM_SURFACE_QUICK_START_ACTION_IDS.LAST_SETTINGS, alternative: false },
        { button: ui.quickStartEventPlaylistButton, actionId: PLATFORM_SURFACE_QUICK_START_ACTION_IDS.EVENT_PLAYLIST, alternative: true },
        { button: ui.quickStartRandomButton, actionId: PLATFORM_SURFACE_QUICK_START_ACTION_IDS.RANDOM_MAP, alternative: true },
    ];
    let visibleAlternativeQuickStartCount = 0;
    quickStartButtons.forEach(({ button, actionId, alternative }) => {
        if (!button) {
            return;
        }
        const surfaceAllowed = !surfacePolicy || surfacePolicyPort.isQuickStartAllowed(actionId);
        button.classList.toggle('hidden', !surfaceAllowed);
        button.setAttribute('aria-hidden', String(!surfaceAllowed));
        button.disabled = !surfaceAllowed;
        if (surfaceAllowed && alternative) {
            visibleAlternativeQuickStartCount += 1;
        }
    });

    const quickStartSection = ui.quickStartEventPlaylistButton?.closest('.menu-section')
        || ui.quickStartRandomButton?.closest('.menu-section')
        || null;
    if (quickStartSection) {
        quickStartSection.classList.toggle('hidden', visibleAlternativeQuickStartCount === 0);
        quickStartSection.setAttribute('aria-hidden', String(visibleAlternativeQuickStartCount === 0));
    }

    if (ui.startButton) {
        const surfaceStartButtonLabel = surfaceEntryCopy?.startButtonLabel || 'Spiel starten';
        ui.startButton.textContent = resolveMenuText('menu.level3.start.label', surfaceStartButtonLabel);
        ui.startButton.title = surfaceEntryCopy?.startButtonTitle || '';
    }

    if (ui.multiplayerInlineState) {
        const titleNode = ui.multiplayerInlineState.querySelector('.section-title');
        const copyNode = ui.multiplayerInlineState.querySelector('.menu-accordion-copy');
        if (titleNode) {
            titleNode.textContent = surfaceEntryCopy?.multiplayerTitle
                || resolveMenuText('menu.multiplayer.inline.title', 'Lobby & Bereitschaft');
        }
        if (copyNode) {
            copyNode.textContent = surfaceEntryCopy?.multiplayerSubtitle
                || resolveMenuText(
                    'menu.multiplayer.inline.subtitle',
                    'Session-Code, echte Lobby-Verbindung und Ready-Status.'
                );
        }
    }
    if (ui.multiplayerLobbyCodeInput) {
        ui.multiplayerLobbyCodeInput.placeholder = surfaceEntryCopy?.lobbyCodePlaceholder || 'z. B. TEST-1234';
    }
    if (ui.multiplayerHostButton) {
        ui.multiplayerHostButton.textContent = surfaceEntryCopy?.hostButtonLabel
            || resolveMenuText('menu.multiplayer.inline.host.label', 'Host');
        ui.multiplayerHostButton.title = surfaceEntryCopy?.hostButtonTitle || '';
        ui.multiplayerHostButton.disabled = surfaceEntryCopy?.hostActionAvailable === false;
    }
    if (ui.multiplayerJoinButton) {
        ui.multiplayerJoinButton.textContent = surfaceEntryCopy?.joinButtonLabel
            || resolveMenuText('menu.multiplayer.inline.join.label', 'Join');
        ui.multiplayerJoinButton.title = surfaceEntryCopy?.joinButtonTitle || '';
    }

    syncDesktopOnlyFeatureButton(
        ui.openEditorButton,
        surfacePolicy,
        PLATFORM_SURFACE_FEATURE_IDS.MAP_EDITOR,
        '3D Map-Editor',
        {
            label: resolveMenuText(
                'menu.level4.tools.map_editor.label',
                ui.openEditorButton?.dataset?.surfaceDefaultLabel || '3D-Map-Editor öffnen'
            ),
        }
    );
    syncDesktopOnlyFeatureButton(
        ui.openVehicleEditorButton,
        surfacePolicy,
        PLATFORM_SURFACE_FEATURE_IDS.VEHICLE_EDITOR,
        'Vehicle-Editor',
        {
            label: resolveMenuText(
                'menu.level4.tools.vehicle_editor.label',
                ui.openVehicleEditorButton?.dataset?.surfaceDefaultLabel || 'Vehicle-Editor öffnen'
            ),
        }
    );

    return {
        modePath,
        sessionType: resolvedSessionType,
        surfaceEntryCopy,
    };
}
