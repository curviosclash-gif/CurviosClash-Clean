import { EDITOR_VIEW_PATHS } from '../../shared/contracts/EditorPathContract.js';
import { PLATFORM_SURFACE_FEATURE_IDS } from '../../shared/contracts/PlatformSurfacePolicyOps.js';
import { clamp } from '../../shared/utils/MathOps.js';
import { setupArcadeMenuSurface } from '../arcade/ArcadeMenuSurface.js';
import { bindMenuMultiplayerActionButtons } from './MenuMultiplayerActionBindings.js';
import { bindStaticInfoHints } from './InfoHintToggle.js';
import { bindBuildInfoCopy } from './MenuClipboardCopy.js';
import { resolveSurfaceFeatureLaunchGuard } from './MenuSurfaceFeatureAccess.js';
import { createRuntimeSettingsLimitsForRuntime } from '../../shared/contracts/SettingsRuntimeLimitsContract.js';
import { armConfirmButton } from '../ConfirmButtonArming.js';

export function bindMenuExtrasButtons(ctx) {
    const ui = ctx.ui;
    const settings = ctx.settings;
    const emit = ctx.emit;
    const queueInputSettingsChanged = ctx.queueInputSettingsChanged;
    const eventTypes = ctx.eventTypes;
    const keys = ctx.settingsChangeKeys;
    const bind = ctx.bind;
    const gameplayLimits = createRuntimeSettingsLimitsForRuntime().gameplay;

    if (ui.level3ResetButton) {
        const confirmation = armConfirmButton(ui.level3ResetButton, {
            label: ui.level3ResetButton.textContent,
            onConfirm: () => emit(eventTypes.LEVEL3_RESET),
        });
        ctx.registerDisposer?.(() => confirmation.dispose());
    }

    if (ui.openLevel4Button) {
        bind(ui.openLevel4Button, 'click', () => {
            emit(eventTypes.LEVEL4_OPEN, {
                sectionId: String(ui.openLevel4Button?.dataset?.level4Section || '').trim(),
            });
        });
    }

    const legacyLevel4OpenButtons = Array.isArray(ui.legacyLevel4OpenButtons) ? ui.legacyLevel4OpenButtons : [];
    legacyLevel4OpenButtons.forEach((button) => {
        bind(button, 'click', () => {
            emit(eventTypes.LEVEL4_OPEN, {
                sectionId: String(button?.dataset?.level4Section || '').trim(),
                returnTarget: String(button?.dataset?.level4ReturnTarget || '').trim(),
            });
        });
    });

    if (ui.closeLevel4Button) {
        bind(ui.closeLevel4Button, 'click', () => {
            emit(eventTypes.LEVEL4_CLOSE);
        });
    }

    if (ui.level4ResetButton) {
        const resetLabel = String(ui.level4ResetButton.dataset?.resetLabel || 'Spieloptionen zurücksetzen');
        const resetConfirmLabel = String(ui.level4ResetButton.dataset?.resetConfirmLabel || 'Zum Bestätigen erneut klicken');
        const confirmation = armConfirmButton(ui.level4ResetButton, {
            label: resetLabel,
            confirmLabel: resetConfirmLabel,
            armedAttribute: 'data-reset-armed',
            onConfirm: () => emit(eventTypes.LEVEL4_RESET),
        });
        ctx.registerDisposer?.(() => confirmation.dispose());
    }

    if (ui.exportConfigCodeButton) {
        bind(ui.exportConfigCodeButton, 'click', () => {
            emit(eventTypes.CONFIG_EXPORT_CODE);
        });
    }

    if (ui.exportConfigJsonButton) {
        bind(ui.exportConfigJsonButton, 'click', () => {
            emit(eventTypes.CONFIG_EXPORT_JSON);
        });
    }

    if (ui.importConfigButton) {
        bind(ui.importConfigButton, 'click', () => {
            emit(eventTypes.CONFIG_IMPORT, {
                inputValue: String(ui.configShareInput?.value || ''),
            });
        });
    }

    if (ui.openEditorButton) {
        bind(ui.openEditorButton, 'click', () => {
            const featureAccess = resolveSurfaceFeatureLaunchGuard(
                ctx.featureFlags?.surfacePolicy,
                PLATFORM_SURFACE_FEATURE_IDS.MAP_EDITOR,
                '3D Map-Editor'
            );
            if (!featureAccess.allowed) {
                emit(eventTypes.SHOW_STATUS_TOAST, featureAccess);
                return;
            }
            window.open(EDITOR_VIEW_PATHS.MAP_EDITOR, '_blank');
        });
    }

    if (ui.openVehicleEditorButton) {
        bind(ui.openVehicleEditorButton, 'click', () => {
            const featureAccess = resolveSurfaceFeatureLaunchGuard(
                ctx.featureFlags?.surfacePolicy,
                PLATFORM_SURFACE_FEATURE_IDS.VEHICLE_EDITOR,
                'Vehicle-Editor'
            );
            if (!featureAccess.allowed) {
                emit(eventTypes.SHOW_STATUS_TOAST, featureAccess);
                return;
            }
            window.open(EDITOR_VIEW_PATHS.VEHICLE_LAB, '_blank');
        });
    }

    if (ui.planarLevelCountSlider && ui.planarLevelCountLabel) {
        bind(ui.planarLevelCountSlider, 'input', (e) => {
            const val = clamp(
                parseInt(e.target.value, 10),
                gameplayLimits.planarLevelCount.min,
                gameplayLimits.planarLevelCount.max
            );
            ui.planarLevelCountLabel.textContent = val;
            if (!settings.gameplay) settings.gameplay = {};
            settings.gameplay.planarLevelCount = val;
            queueInputSettingsChanged([keys.GAMEPLAY_PLANAR_LEVEL_COUNT]);
        });
    }

    bindStaticInfoHints(ui.mainMenu?.ownerDocument || globalThis.document);
    bindBuildInfoCopy({ ui, bind, emit, eventTypes });

    bindMenuMultiplayerActionButtons({
        ui,
        bind,
        emit,
        eventTypes,
        featureFlags: ctx.featureFlags,
    });

    setupArcadeMenuSurface(ctx);
}
