// The settings drawer covers the menu screens; a 3D preview under it draws for nobody (Z2).
export const MENU_PREVIEW_OBSERVED_ROOT_ATTRIBUTES = Object.freeze(['class', 'aria-hidden', 'data-level4-open']);

/** @param {Element|null|undefined} mount */
export function isMenuPreviewCovered(mount) {
    return mount?.closest?.('#main-menu')?.getAttribute?.('data-level4-open') === 'true';
}
