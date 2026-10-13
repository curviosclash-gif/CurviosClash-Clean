import { MENU_SESSION_TYPES } from '../menu/MenuStateContracts.js';
import { deriveFreePlayVariant } from '../../shared/contracts/FreePlayVariantContract.js';
import { FREE_PLAY_VARIANT_LABELS } from '../../shared/contracts/FreePlayMapChoiceContract.js';

// Labels of the start summaries: who plays and which way.
export function resolveSessionLabel(surfaceEntryCopy, sessionType) {
    return surfaceEntryCopy.sessionSummaryLabels[sessionType]
        || (sessionType === MENU_SESSION_TYPES.SPLITSCREEN
            ? 'Geteilter Bildschirm'
            : (sessionType === MENU_SESSION_TYPES.MULTIPLAYER ? 'Mehrspieler' : 'Einzelspieler'));
}

export function resolveModeLabel(modePath, settings) {
    const variant = deriveFreePlayVariant(settings);
    if (variant) return FREE_PLAY_VARIANT_LABELS[variant];
    if (modePath === 'fight') return 'Kampf';
    if (modePath === 'arcade') return 'Arcade-Reise';
    if (modePath === 'quick_action') return 'Schnellstart';
    return 'Klassisch';
}

/** Mode label of the menu context line: the free play variant, else the catalog text of the path. */
export function resolveContextModeLabel(modePath, settings, resolveText) {
    const variant = deriveFreePlayVariant(settings);
    if (variant) return FREE_PLAY_VARIANT_LABELS[variant];
    return resolveText(`menu.context.mode.${modePath}`, '') || resolveText('menu.context.mode.normal', 'Klassisch');
}

/** Breadcrumb of the setup screen: "Einzelspieler › Freies Spiel › Flaggen" or "… › Arcade › Match vorbereiten". */
export function resolveSetupBreadcrumb({ sessionLabel, modeLabel, settings, resolveText }) {
    if (deriveFreePlayVariant(settings)) {
        return `${sessionLabel} › ${resolveText('menu.context.free_play.step', 'Freies Spiel')} › ${modeLabel}`;
    }
    return `${sessionLabel} › ${modeLabel} › ${resolveText('menu.context.game.step', 'Match vorbereiten')}`;
}
