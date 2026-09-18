// Shared helper for contract tests that were moved out of Playwright specs (P3).
//
// Playwright's `expect(actual).toMatchObject(shape)` compares only the fields the
// shape names, recursively, in a single assertion. node:assert has no such matcher.
// `pickSubset` projects the actual value down to exactly those fields, so the moved
// test keeps one assertion per former expect call:
//
//     assert.deepStrictEqual(pickSubset(actual, shape), shape);
//
// Arrays keep toMatchObject's rule that the lengths must match: a length mismatch
// returns the actual array unchanged, so the comparison fails instead of passing on
// a silently truncated projection.

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} actual value under test
 * @param {unknown} shape expected subset; only its own keys are kept from `actual`
 * @returns {unknown} `actual` reduced to the keys of `shape`
 */
export function pickSubset(actual, shape) {
    if (Array.isArray(shape)) {
        if (!Array.isArray(actual) || actual.length !== shape.length) return actual;
        return actual.map((entry, index) => pickSubset(entry, shape[index]));
    }
    if (!isRecord(shape) || !isRecord(actual)) return actual;
    const picked = {};
    for (const key of Object.keys(shape)) {
        picked[key] = pickSubset(actual[key], shape[key]);
    }
    return picked;
}

/**
 * Replacement for `expect(list).toEqual(expect.arrayContaining(expected))` in a single
 * assertion: the returned list names exactly the entries that are missing, so a failing
 * `assert.deepStrictEqual(missingEntries(...), [])` reads like the Playwright failure did.
 * Entries are compared with `includes`, so this is for lists of primitives (strings,
 * numbers) only; objects would only match by reference, unlike arrayContaining.
 *
 * @param {unknown[]} list actual list
 * @param {unknown[]} expected primitive entries the list must contain
 * @returns {unknown[]} the expected entries that are absent
 */
export function missingEntries(list, expected) {
    const actual = Array.isArray(list) ? list : [];
    return expected.filter((entry) => !actual.includes(entry));
}
