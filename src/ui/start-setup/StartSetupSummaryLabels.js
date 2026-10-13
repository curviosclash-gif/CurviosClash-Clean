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
