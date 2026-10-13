// The shipped data/balancing catalog (mode defaults plus one file per map). It sits in src/shared
// so the runtime (core) and the menu (ui) read the same files without importing each other's layer.
// Read only: in-session edits of the F7 console live in core/balancing/MapBalancingRuntime.js.

import modesDocument from '../../../data/balancing/modes.json' with { type: 'json' };
import {
    createMapBalancingCatalog,
    resolveMapBalancing,
} from '../contracts/MapBalancingContract.js';

export const bundledModesDocument = modesDocument;

// Vite inlines every map file at build time; plain Node (contract tests) has no import.meta.env
// and starts with mode defaults only.
export const bundledMapDocuments = import.meta.env
    ? import.meta.glob('../../../data/balancing/maps/*.json', { eager: true, import: 'default' })
    : {};

/** @type {ReturnType<typeof createMapBalancingCatalog> | null} */
let shippedCatalog = null;

/** Catalog of the shipped files only (no session edits). Built once; callers must not change it. */
export function getBundledMapBalancingCatalog() {
    shippedCatalog ||= createMapBalancingCatalog({
        modesDocument,
        mapDocuments: Object.values(bundledMapDocuments),
    });
    return shippedCatalog;
}

/**
 * Effective balancing values the shipped files give one map in one mode path ('normal' | 'fight' | 'arcade').
 * @param {{ modePath?: unknown, mapKey?: unknown, stageId?: unknown }} [target]
 */
export function resolveBundledMapBalancing(target = {}) {
    return resolveMapBalancing(getBundledMapBalancingCatalog(), target);
}
