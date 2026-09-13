// Structural feasibility only: success still depends on the pilot.
export function eligibleArcadeMission(entry, context = null, authored = false, selected = []) {
    if (!context) return entry;
    const params = { ...entry.params };
    const type = entry.type;
    const bots = Math.max(0, Number(context.botCount) || 0);
    if (type === 'KILL_COUNT' || type === 'MULTI_KILL') {
        if (bots === 0) return null;
        const minimum = type === 'MULTI_KILL' ? 2 : 1;
        const target = Number(params.target) || (type === 'MULTI_KILL' ? 3 : 5);
        if (!context.respawnEnabled) {
            if (bots < minimum || (authored && target > bots)) return null;
            params.target = Math.min(target, bots);
        }
    }
    if (type === 'REACH_PORTAL' && !context.hasExitPortal) return null;
    if (['COLLECT_ITEMS', 'ITEM_CHAIN'].includes(type) && !context.hasItems) return null;
    if (type === 'NO_DAMAGE' && context.unavoidableDamage) return null;
    if (type === 'CLOSE_CALL' && !context.hasHealing) {
        if (authored && (Number(params.target) || 3) > 1) return null;
        params.target = 1;
    }
    if (type === 'SURVIVE_DURATION' && context.maximumDurationSec > 0
        && (Number(params.target) || 45) > context.maximumDurationSec) return null;
    const survive = Math.max(0, Number(context.minimumDurationSec) || 0,
        ...selected.filter(m => m.type === 'SURVIVE_DURATION').map(m => Number(m.params?.target) || 45));
    const limits = selected.filter(m => m.type === 'TIME_TRIAL').map(m => Number(m.params?.target) || 30);
    if (type === 'TIME_TRIAL' && (Number(params.target) || 30) < survive) return null;
    if (type === 'SURVIVE_DURATION' && limits.some(limit => limit < (Number(params.target) || 45))) return null;
    return { ...entry, params };
}
