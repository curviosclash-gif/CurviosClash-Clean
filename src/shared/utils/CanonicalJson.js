/**
 * @param {unknown} value
 * @param {WeakSet<object> | null} [seen]
 * @returns {string}
 */
export function stableCanonicalSerialize(value, seen = null) {
    if (value === null || value === undefined) return String(value);
    const valueType = typeof value;
    if (valueType === 'number') {
        if (Number.isNaN(value)) return 'number:NaN';
        if (value === Infinity) return 'number:Infinity';
        if (value === -Infinity) return 'number:-Infinity';
        return `number:${value}`;
    }
    if (valueType === 'string') return `string:${value}`;
    if (valueType === 'boolean') return value ? 'boolean:true' : 'boolean:false';
    if (valueType === 'bigint') return `bigint:${value.toString()}`;
    if (valueType !== 'object') return `other:${String(value)}`;
    const objectValue = /** @type {Record<string, any>} */ (value);
    if (typeof objectValue.toJSON === 'function') {
        return stableCanonicalSerialize(objectValue.toJSON(), seen);
    }

    const activeSeen = seen || new WeakSet();
    if (activeSeen.has(value)) return 'cycle';
    activeSeen.add(value);

    if (Array.isArray(value)) {
        const serialized = value.map((entry) => stableCanonicalSerialize(entry, activeSeen));
        activeSeen.delete(value);
        return `[${serialized.join(',')}]`;
    }

    const keys = Object.keys(value).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableCanonicalSerialize(objectValue[key], activeSeen)}`);
    activeSeen.delete(value);
    return `{${pairs.join(',')}}`;
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function areCanonicalJsonValuesEqual(left, right) {
    try {
        return stableCanonicalSerialize(left) === stableCanonicalSerialize(right);
    } catch {
        return false;
    }
}
