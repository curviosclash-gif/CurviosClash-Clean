// Hangar tab "Form": part colours, and the 3D preview that shows the ship's look. In the arcade
// hangar it also runs its sibling tab "Ausbau" (HangarUpgradeTab: size workshop, storage tiers,
// hit zone and the docked stone panel), because the preview combines both: the colours from
// here, the functional size from there - the unapplied size draft while "Ausbau" is open, the
// part boxes of "Trefferzone zeigen" only there. Size slider and shape choice are gone from
// "Form" (Plan, Aussehen).
// The Fight hangar keeps "Form" with the colour panel only and has no "Ausbau".
// Lives outside ArcadeHangarWorkshop.js, which is over the max-lines cap and must not grow.
import { createHangarPartStylePanel } from './HangarPartStylePanel.js';
import { createHangarUpgradeTab } from './HangarUpgradeTab.js';
import { normalizeVehiclePartStyle } from '../../shared/contracts/VehiclePartStyleContract.js';
import {
    normalizeArcadeSizeProfileFields,
    resolveArcadeSizedPartStyle,
} from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { listArcadeHitboxBoxes } from '../../shared/contracts/ArcadeVehicleHitboxContract.js';
import { resolveHangarPartSource } from './HangarPartSource.js';

/**
 * Tab state as the workshop renderer sets it for its other tabs.
 * @param {HTMLElement} tabButton
 * @param {HTMLElement} panel
 * @param {boolean} active
 */
function showTab(tabButton, panel, active) {
    tabButton.classList.toggle('is-active', active);
    tabButton.setAttribute('aria-selected', String(active));
    tabButton.tabIndex = active ? 0 : -1;
    panel.classList.toggle('hidden', !active);
}

/**
 * @param {{ bind: Function, enabled: boolean, viewport: { setPartStyle: Function, setHitboxOverlay: Function },
 *   panel: HTMLElement, tabButton: HTMLElement, upgradePanel?: HTMLElement|null, upgradeTabButton?: HTMLElement|null,
 *   getProfile: () => any, saveProfile: (profile: any) => boolean|void,
 *   toast: (message: string, tone?: string) => void, onChange: () => void,
 *   upgradeSections?: ReadonlyArray<HTMLElement>, getPool?: () => any }} options
 *   enabled: arcade hangar; upgradePanel/upgradeTabButton: the shell's "Ausbau" tab (arcade only);
 *   upgradeSections/getPool: the stone panel docked in "Ausbau" and its pool for the size preview.
 */
export function createHangarFormTab({
    bind, enabled, viewport, panel, tabButton, upgradePanel = null, upgradeTabButton = null,
    getProfile, saveProfile, toast, onChange, upgradeSections = [], getPool,
}) {
    const partsOf = (vehicleId) => resolveHangarPartSource(vehicleId)?.parts || [];
    const partStylePanel = createHangarPartStylePanel({
        bind,
        onStyleChange: (style) => saveProfile({ ...getProfile(), partStyle: normalizeVehiclePartStyle(style) }),
        onSelectPart: onChange,
    });
    panel.appendChild(partStylePanel.root);
    const upgradeTab = enabled && upgradePanel && upgradeTabButton
        ? createHangarUpgradeTab({ bind, panel: upgradePanel, getProfile, saveProfile, toast, onChange, partsOf, getPool, sections: upgradeSections })
        : null;

    return Object.freeze({
        /**
         * @param {string} vehicleId
         * @param {string} view the open workshop tab ('workshop', 'stats', 'presets', 'upgrade', 'form')
         */
        sync(vehicleId, view) {
            const formOpen = view === 'form';
            const profile = enabled ? getProfile() : {};
            const partStyle = normalizeVehiclePartStyle(profile.partStyle);
            partStylePanel.render({ vehicleId, style: partStyle });
            if (upgradeTab) {
                upgradeTab.render(vehicleId, profile, view === 'upgrade');
                showTab(upgradeTabButton, upgradePanel, view === 'upgrade');
            }
            const parts = partsOf(vehicleId);
            const sizes = upgradeTab ? upgradeTab.getDraftSizes() : normalizeArcadeSizeProfileFields(profile).partSizes;
            const style = enabled ? resolveArcadeSizedPartStyle(parts, partStyle, sizes) : {};
            viewport.setPartStyle(style, formOpen ? partStylePanel.getSelectedPart() : '');
            const showHitbox = upgradeTab?.showsHitbox() === true && parts.length > 0;
            viewport.setHitboxOverlay(showHitbox ? listArcadeHitboxBoxes({ parts }, sizes) : null);
            showTab(tabButton, panel, formOpen);
        },
    });
}
