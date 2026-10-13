import { resolveMenuVisibility } from '../../shared/contracts/MenuVisibilityContract.js';
import { applyMenuVisibility } from './MenuVisibilityApplier.js';
import { resolveMenuDeveloperEnvironment } from './MenuDeveloperEnvironment.js';

/**
 * Tools screen: the editors are for everyone on the desktop, the developer block
 * (fine tuning, key hints, F7 hint) appears only in the development environment.
 */
export function bindMenuToolsScreen({ ui, runtimeGlobal = globalThis }) {
    const panel = ui?.toolsPanel;
    if (!panel) return;
    applyMenuVisibility(panel, resolveMenuVisibility({
        devEnvironment: resolveMenuDeveloperEnvironment({ runtimeGlobal }),
    }));
}
