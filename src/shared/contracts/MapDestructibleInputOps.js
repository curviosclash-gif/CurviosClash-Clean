/** Small bounded readers shared by scene and segment normalization. */

/**
 * @param {unknown} value
 * @param {number} maxEntries
 * @param {number} maxLength
 * @returns {string[]}
 */
export function readIdList(value, maxEntries, maxLength) {
    const entries = Array.isArray(value) ? value : [];
    /** @type {string[]} */
    const ids = [];
    for (const entry of entries) {
        if (ids.length >= maxEntries) break;
        if (typeof entry !== 'string') continue;
        const id = entry.trim().slice(0, maxLength);
        if (!id || ids.includes(id)) continue;
        ids.push(id);
    }
    return ids;
}

/**
 * @param {unknown} value
 * @param {string} ownerModelId
 * @param {number} maxEntries
 * @param {number} maxLength
 * @returns {readonly Readonly<{modelId: string, parentNodeName: string}>[]}
 */
export function readBreakSceneAttachments(value, ownerModelId, maxEntries, maxLength) {
    const entries = Array.isArray(value) ? value : [];
    /** @type {Readonly<{modelId: string, parentNodeName: string}>[]} */
    const attachments = [];
    for (const entry of entries) {
        if (attachments.length >= maxEntries) break;
        const modelId = typeof entry?.modelId === 'string'
            ? entry.modelId.trim().slice(0, maxLength) : '';
        const parentNodeName = typeof entry?.parentNodeName === 'string'
            ? entry.parentNodeName.trim().slice(0, maxLength) : '';
        if (!modelId || modelId === ownerModelId || !parentNodeName
            || attachments.some((attachment) => attachment.modelId === modelId)) continue;
        attachments.push(Object.freeze({ modelId, parentNodeName }));
    }
    return Object.freeze(attachments);
}

const TWO_PI = Math.PI * 2;

/**
 * An angle folded into [0, 2pi). Headings are compared and subtracted, so they have to live in one
 * range - otherwise the same direction reads as two different numbers on the wire.
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeHeading(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    const wrapped = parsed % TWO_PI;
    if (wrapped < 0) return wrapped + TWO_PI;
    return wrapped || 0;
}

/**
 * The host's rolls a break event carries, present only when the event had them: the visual
 * variant and the wind heading. Serializing and applying a snapshot both read them here.
 * @param {Record<string, unknown>} source
 * @returns {{ variantIndex?: number, windYaw?: number }}
 */
export function readEventChoices(source) {
    return {
        ...(source.variantIndex !== undefined ? { variantIndex: readVariantIndex(source.variantIndex) } : {}),
        ...(source.windYaw !== undefined ? { windYaw: normalizeHeading(source.windYaw) } : {}),
    };
}

/** @param {unknown} value */
export function readVariantIndex(value) {
    const index = Number(value);
    return Number.isFinite(index) ? Math.max(0, Math.min(7, Math.floor(index))) : 0;
}

/** @param {string} modelId @param {unknown[]} variants */
export function readModelVariants(modelId, variants) {
    return Object.freeze(readIdList([modelId, ...variants], 8, 80));
}
