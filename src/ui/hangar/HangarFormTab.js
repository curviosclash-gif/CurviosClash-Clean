// Hangar tab "Form" (arcade only): part colours plus the size workshop, and the 3D preview that
// shows the ship at its functional size - the unapplied size draft while editing (Paket 2a).
// Lives outside ArcadeHangarWorkshop.js, which is over the max-lines cap and must not grow.
import { createHangarPartStylePanel } from './HangarPartStylePanel.js';
import { createHangarSizePanel } from './HangarSizePanel.js';
import { normalizeVehiclePartStyle } from '../../shared/contracts/VehiclePartStyleContract.js';
import { resolveArcadeSizedPartStyle } from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { listPlayerShipPartDonors } from '../../shared/vehicle-lab/player-ships/index.js';

/**
 * @param {{ bind: Function, enabled: boolean, viewport: { setPartStyle: Function },
 *   panel: HTMLElement, tabButton: HTMLElement, getProfile: () => any,
 *   saveProfile: (profile: any) => void, toast: Function, onChange: () => void }} options
 */
export function createHangarFormTab({ bind, enabled, viewport, panel, tabButton, getProfile, saveProfile, toast, onChange }) {
    const donors = listPlayerShipPartDonors();
    const partStylePanel = createHangarPartStylePanel({
        bind,
        onStyleChange: (style) => saveProfile({ ...getProfile(), partStyle: normalizeVehiclePartStyle(style) }),
        onSelectPart: onChange,
    });
    const sizePanel = createHangarSizePanel({ bind, getProfile, saveProfile, toast, onDraftChange: onChange });
    if (enabled) panel.append(sizePanel.root, partStylePanel.root);
    else panel.appendChild(partStylePanel.root);

    return Object.freeze({
        sync(vehicleId, active) {
            const profile = enabled ? getProfile() : {};
            const partStyle = normalizeVehiclePartStyle(profile.partStyle);
            partStylePanel.render({ vehicleId, style: partStyle });
            // Leaving the tab drops an unapplied size draft: every other view shows the ship that flies.
            if (enabled) sizePanel.render(vehicleId, profile, active);
            const parts = donors.find((donor) => donor.id === vehicleId)?.parts || [];
            const style = enabled ? resolveArcadeSizedPartStyle(parts, partStyle, sizePanel.getDraftSizes()) : {};
            viewport.setPartStyle(style, active ? partStylePanel.getSelectedPart() : '');
            tabButton.classList.toggle('is-active', active);
            tabButton.setAttribute('aria-selected', String(active));
            tabButton.tabIndex = active ? 0 : -1;
            panel.classList.toggle('hidden', !active);
        },
    });
}
