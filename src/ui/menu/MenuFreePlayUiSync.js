import {
    deriveFreePlayVariant,
    resolveFreePlayVariantSettings,
} from '../../shared/contracts/FreePlayVariantContract.js';
import { MENU_VISIBILITY_REASONS, resolveMenuVisibility } from '../../shared/contracts/MenuVisibilityContract.js';
import { applyMenuVisibility } from './MenuVisibilityApplier.js';
import { isThreePlayerSplitSelected } from '../start-setup/StartSetupSplitPlayersSection.js';

const DISABLED_VARIANT_HINTS = Object.freeze({
    [MENU_VISIBILITY_REASONS.THREE_PLAYERS_NO_TEAMS]: 'Mit drei Spielern gibt es keine Teams.',
});
const BLOCKED_VARIANT_HINT = 'Nicht jede Spielart ist hier verfügbar.';

function toggleHidden(element, hidden) {
    element.classList.toggle('hidden', hidden);
    element.setAttribute('aria-hidden', String(hidden));
}

/**
 * Mirrors the free play variant into the hub and the free play screen: which title shows,
 * which variant is pressed, and which variants cannot be picked right now and why.
 *
 * @param {{ ui: object, settings: object, sessionType: string, isModePathAllowed?: (modePath: string) => boolean, huntFeatureEnabled?: boolean }} options
 */
export function syncFreePlayUi({ ui, settings, sessionType, isModePathAllowed = () => true, huntFeatureEnabled = true }) {
    const variant = deriveFreePlayVariant(settings);
    const isFreePlay = variant !== null;
    const hubSession = sessionType === 'splitscreen' ? 'splitscreen' : 'single';

    (ui.hubTitleSpans || []).forEach((span) => toggleHidden(span, span.dataset.hubTitleFor !== hubSession));
    (ui.freePlayOnlyElements || []).forEach((element) => toggleHidden(element, !isFreePlay));
    (ui.freePlayHiddenElements || []).forEach((element) => toggleHidden(element, isFreePlay));

    const isVariantModePathOpen = (candidate) => {
        const { modePath } = resolveFreePlayVariantSettings(candidate);
        return isModePathAllowed(modePath) && (modePath !== 'fight' || huntFeatureEnabled);
    };
    if (ui.freePlayEntryButton) {
        ui.freePlayEntryButton.disabled = !isVariantModePathOpen('ffa') && !isVariantModePathOpen('classic');
    }

    const buttons = ui.freePlayVariantButtons || [];
    const group = buttons[0]?.parentElement || null;
    const visibility = resolveMenuVisibility({
        sessionType,
        playerCount: sessionType === 'splitscreen' ? (isThreePlayerSplitSelected(settings) ? 3 : 2) : 1,
        variant: variant || undefined,
    });
    applyMenuVisibility(group, visibility);

    let hint = '';
    buttons.forEach((button) => {
        const buttonVariant = button.dataset.freePlayVariant;
        const blockedByPath = !isVariantModePathOpen(buttonVariant);
        if (blockedByPath) {
            button.disabled = true;
            hint = hint || BLOCKED_VARIANT_HINT;
        } else if (button.disabled) {
            hint = DISABLED_VARIANT_HINTS[button.getAttribute('data-menu-disabled-reason')] || hint;
        }
        const isActive = buttonVariant === variant;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
        button.setAttribute('data-menu-focus-preferred', String(isActive));
    });
    if (ui.freePlayVariantHint) {
        ui.freePlayVariantHint.textContent = hint;
        toggleHidden(ui.freePlayVariantHint, !isFreePlay || !hint);
    }
    return { variant };
}
