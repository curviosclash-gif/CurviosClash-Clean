// ============================================
// SettingsOverrideRetiredPaths.js - override fields the product no longer has
// ============================================

import { deepCloneJson, isPlainObject, readPathValue } from './SettingsOverrideMergeOps.js';

/**
 * v4 dropped the portal count: every map brings its own. Older drafts may still set it,
 * and an unknown path would reject the whole override, so the migration removes it.
 */
export const RETIRED_OVERRIDE_PATHS = Object.freeze([
    'baseSettings.gameplay.portalCount',
    'configShare.gameplay.portalCount',
]);

export function dropRetiredOverridePaths(draft) {
    let result = draft;
    for (const path of RETIRED_OVERRIDE_PATHS) {
        const segments = path.split('.');
        const leaf = segments.pop();
        const parent = readPathValue(result, segments.join('.'));
        if (!isPlainObject(parent) || !(leaf in parent)) continue;
        // Clone the section we write into, so the stored draft the caller holds stays untouched.
        const [section] = segments;
        if (result === draft || result[section] === draft[section]) {
            result = { ...result, [section]: deepCloneJson(result[section]) };
        }
        delete readPathValue(result, segments.join('.'))[leaf];
    }
    return result;
}
