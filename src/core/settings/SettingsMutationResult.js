export function withMutationChangedKeys(result, changedKeys = [], metadata = null) {
    return {
        ...result,
        changedKeys: result?.success ? changedKeys.slice() : [],
        metadata: result?.success && metadata && typeof metadata === 'object'
            ? { ...metadata }
            : null,
    };
}

export function createSettingsMutationFailure(reason, metadata = null) {
    return {
        success: false,
        reason: String(reason || 'failed'),
        changedKeys: [],
        metadata: metadata && typeof metadata === 'object' ? { ...metadata } : null,
    };
}
