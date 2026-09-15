// Guessed authoring defaults for a map document. Kept separate from the sanitizer so
// authoring tools can tell an author-set mode apart from one that was merely derived
// from the document content, without importing the whole sanitizer surface.

/**
 * @param {{hasAuthoredPortalPairs?: boolean, legacyPreferAuthored?: boolean}} [options]
 * @returns {'dynamic'|'authored'|'hybrid'}
 */
export function derivePortalModeDefault(options = {}) {
    if (options.legacyPreferAuthored === true) return 'authored';
    return options.hasAuthoredPortalPairs === true ? 'hybrid' : 'dynamic';
}

/**
 * @param {{hasAuthoredItems?: boolean}} [options]
 * @returns {'anchor-only'|'fallback-random'}
 */
export function deriveItemSpawnModeDefault(options = {}) {
    return options.hasAuthoredItems === true ? 'anchor-only' : 'fallback-random';
}
