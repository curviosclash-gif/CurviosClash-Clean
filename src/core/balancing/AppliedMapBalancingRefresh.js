// Map values approved or withdrawn in the Settings Studio while the game runs. They are read
// at startup and again whenever the menu rereads its map catalog; a running match keeps the
// values it started with.

import { refreshElectronAppliedMapBalancing } from '../../platform/electron/ElectronPlatformBridge.js';
import { GAME_STATE_IDS } from '../../shared/contracts/GameStateIds.js';
import { normalizeAppliedMapBalancingDocument } from '../../shared/contracts/AppliedMapBalancingContract.js';
import { getLocalAppliedMapBalancingDocument, setLocalAppliedMapBalancing } from '../../shared/maps/MapBalancingBundledData.js';

/**
 * Runs the menu's desktop rereads (editor maps, approvals) together; any change rebuilds the
 * menu runtime config exactly once and counts as a change for the caller.
 * @param {Array<() => Promise<boolean>>} refreshes
 * @param {() => unknown} [applySettings]
 */
export async function refreshDesktopMenuSources(refreshes, applySettings) {
    const changes = await Promise.all(refreshes.map((refresh) => refresh()));
    if (!changes.includes(true)) return false;
    applySettings?.();
    return true;
}

/**
 * @param {{
 *   gameState?: string,
 *   getGameState?: (() => string) | null,
 *   applySettings?: () => unknown,
 *   readApplied?: () => Promise<{ exists?: boolean, document?: unknown, error?: string | null } | null>,
 * }} [options]
 * @returns {Promise<boolean>} true when the approvals changed
 */
export async function refreshAppliedMapBalancing({
    gameState,
    getGameState = null,
    applySettings,
    readApplied = refreshElectronAppliedMapBalancing,
} = {}) {
    if (gameState !== GAME_STATE_IDS.MENU) return false;
    let snapshot;
    try {
        snapshot = await readApplied();
    } catch {
        return false;
    }
    if (typeof getGameState === 'function' && getGameState() !== GAME_STATE_IDS.MENU) return false;
    // Unreadable file: keep what is in effect instead of dropping every approval.
    if (!snapshot || typeof snapshot !== 'object' || snapshot.error) return false;
    const document = normalizeAppliedMapBalancingDocument(snapshot.document ?? null);
    if (JSON.stringify(document) === JSON.stringify(getLocalAppliedMapBalancingDocument())) return false;
    setLocalAppliedMapBalancing(document);
    applySettings?.();
    return true;
}
