// Hangar tab "Ausbau" (arcade only): what the vehicle's XP buys for its build. Today the size
// workshop with its value preview, storage tiers and the hit zone boxes; stones and weapon tiers
// (Pakete 3 and 4) append their sections to the same panel. Locked sections stay visible, dimmed
// and name their condition (HangarLockedSection).
import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { createHangarSizePanel } from './HangarSizePanel.js';

/**
 * @param {{ bind: Function, panel: HTMLElement, getProfile: () => any,
 *   saveProfile: (profile: any) => boolean|void, toast: (message: string, tone?: string) => void,
 *   onChange: () => void, partsOf: (vehicleId: string) => ReadonlyArray<any> }} options
 */
export function createHangarUpgradeTab({ bind, panel, getProfile, saveProfile, toast, onChange, partsOf }) {
    const sizePanel = createHangarSizePanel({ bind, getProfile, saveProfile, toast, onDraftChange: onChange, partsOf });
    const hitboxToggle = el('label', 'hangar-hitbox-toggle');
    const hitboxInput = el('input', 'hangar-hitbox-toggle-input');
    hitboxInput.type = 'checkbox';
    hitboxToggle.append(hitboxInput, ' Trefferzone zeigen');
    bind(hitboxInput, 'change', onChange);
    panel.append(sizePanel.root, hitboxToggle);
    let open = false;

    return Object.freeze({
        /** Sizes the 3D preview shows: the unapplied draft only while the tab is open. */
        getDraftSizes: sizePanel.getDraftSizes,
        /** "Trefferzone zeigen" is on and the tab is open. */
        showsHitbox: () => open && hitboxInput.checked === true,
        /**
         * @param {string} vehicleId
         * @param {any} profile
         * @param {boolean} active the tab is open; leaving it drops an unapplied size draft, so
         *   no other view shows a ship that differs from the one that flies.
         */
        render(vehicleId, profile, active) {
            open = active;
            sizePanel.render(vehicleId, profile, active);
        },
    });
}
