function includesPassedCheckpointId(passedIds, checkpointId) {
    return passedIds instanceof Set
        ? passedIds.has(checkpointId)
        : Array.isArray(passedIds) && passedIds.includes(checkpointId);
}

function isCheckpointPassed(route, checkpointId, passedIds) {
    if (includesPassedCheckpointId(passedIds, checkpointId)) return true;
    for (const checkpoint of route.checkpoints || []) {
        if (checkpoint?.aliasOf === checkpointId && includesPassedCheckpointId(passedIds, checkpoint.id)) return true;
    }
    return false;
}

export function resolveActiveParcoursGuidance(route, progress) {
    if (!route || route.enabled === false || !Array.isArray(route.guidancePaths)) return null;
    const passedIds = progress?.passedCheckpointIds;
    const nextIndex = Math.max(0, Math.trunc(Number(progress?.nextCheckpointIndex) || 0));
    let selected = null;
    let selectedBranchIndex = -1;
    for (const guidance of route.guidancePaths) {
        const passed = isCheckpointPassed(route, guidance?.branchCheckpointId, passedIds);
        if (!passed) continue;
        const end = route.checkpoints?.find((checkpoint) => checkpoint.id === guidance.endCheckpointId);
        if (!end) return null;
        const branch = route.checkpoints?.find((checkpoint) => checkpoint.id === guidance.branchCheckpointId);
        if (!branch || nextIndex <= branch.routeIndex || nextIndex > end.routeIndex) continue;
        if (branch.routeIndex <= selectedBranchIndex) continue;
        selected = guidance;
        selectedBranchIndex = branch.routeIndex;
    }
    return selected;
}

export function isParcoursGuidanceRequiredAfterBranch(route, progress) {
    if (route?.guidanceRequired !== true) return false;
    const passedIds = progress?.passedCheckpointIds;
    const nextIndex = Math.max(0, Math.trunc(Number(progress?.nextCheckpointIndex) || 0));
    const guidedBranchIds = route.guidanceBranchCheckpointIds;
    const guidancePaths = route.guidancePaths;
    let latestPassedBranch = null;
    const historyUnavailable = passedIds == null
        || (Array.isArray(passedIds) && passedIds.length === 0)
        || (passedIds instanceof Set && passedIds.size === 0);
    if (Array.isArray(route.guidancePathWindows)) {
        for (const window of route.guidancePathWindows) {
            const branch = route.checkpoints?.find((entry) => entry.id === window?.branchCheckpointId);
            const end = route.checkpoints?.find((entry) => entry.id === window?.endCheckpointId);
            if (!branch || !end || nextIndex <= branch.routeIndex || nextIndex > end.routeIndex) continue;
            const branchPassed = isCheckpointPassed(route, branch.id, passedIds);
            if (historyUnavailable) return true;
            if (!branchPassed) {
                let siblingBranchPassed = false;
                for (const checkpoint of route.checkpoints || []) {
                    if (checkpoint.routeIndex !== branch.routeIndex || checkpoint.isBranchOption !== true) continue;
                    const siblingPassed = includesPassedCheckpointId(passedIds, checkpoint.id);
                    if (!siblingPassed) continue;
                    siblingBranchPassed = true;
                    break;
                }
                if (!siblingBranchPassed) return true;
            }
        }
    }
    for (const checkpoint of route.checkpoints || []) {
        const passed = isCheckpointPassed(route, checkpoint?.id, passedIds);
        if (!passed) continue;
        let hasGuidedBranch = Array.isArray(guidedBranchIds) && guidedBranchIds.includes(checkpoint.id);
        if (!hasGuidedBranch && !Array.isArray(guidedBranchIds) && Array.isArray(guidancePaths)) {
            for (const path of guidancePaths) {
                if (path?.branchCheckpointId !== checkpoint.id) continue;
                hasGuidedBranch = true;
                break;
            }
        }
        if (!hasGuidedBranch) continue;
        const windows = route.guidancePathWindows;
        let endRouteIndex = checkpoint.routeIndex + 1;
        if (Array.isArray(windows)) {
            for (const window of windows) {
                if (window?.branchCheckpointId !== checkpoint.id) continue;
                const end = route.checkpoints?.find((entry) => entry.id === window.endCheckpointId);
                if (end) endRouteIndex = end.routeIndex;
                break;
            }
        }
        if (nextIndex <= checkpoint.routeIndex || nextIndex > endRouteIndex) continue;
        if (!latestPassedBranch || checkpoint.routeIndex > latestPassedBranch.routeIndex) latestPassedBranch = checkpoint;
    }
    return !!latestPassedBranch;
}

export function findParcoursGuidanceWaypoint(points, position) {
    if (!Array.isArray(points) || points.length === 0 || !position) return -1;
    let nearestIndex = 0;
    let nearestDistanceSq = Infinity;
    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const dx = Number(position.x) - point[0];
        const dy = Number(position.y) - point[1];
        const dz = Number(position.z) - point[2];
        const distanceSq = (dx * dx) + (dy * dy) + (dz * dz);
        if (distanceSq >= nearestDistanceSq) continue;
        nearestDistanceSq = distanceSq;
        nearestIndex = index;
    }
    return Math.min(points.length - 1, nearestIndex + 1);
}
