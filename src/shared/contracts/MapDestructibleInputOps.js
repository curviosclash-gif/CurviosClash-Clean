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
