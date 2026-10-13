import { armConfirmButton } from '../ConfirmButtonArming.js';
import { resolveMenuVisibility } from '../../shared/contracts/MenuVisibilityContract.js';
import { applyMenuVisibility } from './MenuVisibilityApplier.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../../shared/contracts/PlatformCapabilityRegistry.js';

const QUIT_CONFIRM_LABEL = 'Wirklich beenden? Erneut klicken';

/**
 * "Beenden" on the start screen: desktop only and two-step. Closing the window runs the
 * shell's regular close handshake, so nothing unsaved is cut off.
 */
export function bindMenuQuitControl({ ui, featureFlags = null, registerDisposer = null, closeWindow = null }) {
    const button = ui.quitGameButton;
    if (!button) return;
    const productSurfaceId = String(featureFlags?.surfacePolicy?.productSurfaceId || '').trim().toLowerCase();
    const platform = productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP ? 'desktop' : 'browser';
    applyMenuVisibility(button.parentElement, resolveMenuVisibility({ platform }));
    if (button.hidden) return;
    const close = typeof closeWindow === 'function' ? closeWindow : () => button.ownerDocument?.defaultView?.close?.();
    const confirmation = armConfirmButton(button, {
        label: button.textContent,
        confirmLabel: QUIT_CONFIRM_LABEL,
        onConfirm: close,
    });
    registerDisposer?.(() => confirmation.dispose());
}
