// @ts-check

/**
 * @param {string} [search]
 * @returns {URLSearchParams | null}
 */
function readSearchParams(search = window.location.search) {
    try {
        return new URLSearchParams(search);
    } catch {
        return null;
    }
}

/**
 * @param {string} [search]
 * @returns {boolean}
 */
export function isPlaytestLaunchRequested(search = window.location.search) {
    const params = readSearchParams(search);
    if (!params) {
        return false;
    }
    const raw = String(params.get('playtest') || '').toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * @param {string} paramName
 * @param {string} [search]
 * @returns {boolean | null}
 */
export function readPlaytestLaunchBoolParam(paramName, search = window.location.search) {
    const params = readSearchParams(search);
    if (!params || !params.has(paramName)) {
        return null;
    }
    const raw = String(params.get(paramName) || '').toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return null;
}
