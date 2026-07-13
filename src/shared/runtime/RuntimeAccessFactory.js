export function resolveRuntimeAccessTarget(runtime) {
    return runtime && typeof runtime === 'object' ? runtime : null;
}

export function createRuntimeAccess(runtime, defineAccess) {
    const target = resolveRuntimeAccessTarget(runtime);
    const access = typeof defineAccess === 'function'
        ? defineAccess(target)
        : {};
    return Object.freeze(access && typeof access === 'object' ? access : {});
}
