// Optional round-local fire simulation. Only the authoritative destructible system advances it.
const STEP = 0.1;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function createMapFireProgression(definition, serialized = null) {
    if (!definition?.segments?.length) return null;
    const source = serialized && typeof serialized === 'object' ? serialized : {};
    return {
        elapsed: Math.max(0, Math.min(36000, finite(source.elapsed))),
        skyProgress: Math.max(0, Math.min(1, finite(source.skyProgress))),
        segments: definition.segments.map((entry) => {
            const saved = Array.isArray(source.segments) ? source.segments.find((item) => item?.id === entry.id) : null;
            return { id: entry.id, heat: Math.max(0, Math.min(1, finite(saved?.heat))),
                attackHeat: Math.max(0, Math.min(1, finite(saved?.attackHeat))),
                warningAt: Math.max(-1, finite(saved?.warningAt, -1)),
                brokenAt: Math.max(-1, finite(saved?.brokenAt, -1)) };
        }),
    };
}

export function isFireSegmentUnlocked(definition, state, index) {
    const entry = definition.segments[index];
    return (entry.requires || []).every((id) => {
        const parent = state.segments.find((segment) => segment.id === id);
        return parent?.brokenAt >= 0 && state.elapsed >= parent.brokenAt + 6;
    });
}

export function damageMapFireSegment(definition, state, id, damage) {
    const index = state.segments.findIndex((segment) => segment.id === id);
    if (index < 0 || !isFireSegmentUnlocked(definition, state, index)) return false;
    const segment = state.segments[index];
    if (segment.brokenAt >= 0 || segment.warningAt >= 0 || !(finite(damage) > 0)) return false;
    const increase = damage / definition.segments[index].hp;
    segment.attackHeat = Math.min(1, segment.attackHeat + increase);
    segment.heat = Math.min(1, segment.heat + increase);
    if (segment.heat >= 1 - 1e-9) { segment.heat = 1; segment.warningAt = state.elapsed; }
    return true;
}

export function advanceMapFireProgression(definition, state, elapsed, onBreak) {
    const end = Math.max(state.elapsed, Math.min(36000, finite(elapsed)));
    if (state.skyProgress === 1 && state.segments.every((segment) => segment.brokenAt >= 0)) { state.elapsed = end; return state; }
    // Fixed substeps preserve spreading and warning times across frame rates and seeks.
    while (state.elapsed + 0.00001 < end) {
        const dt = Math.min(STEP, end - state.elapsed);
        state.elapsed += dt;
        for (let index = 0; index < state.segments.length; index += 1) {
            const segment = state.segments[index];
            if (segment.brokenAt >= 0 || !isFireSegmentUnlocked(definition, state, index)) continue;
            const entry = definition.segments[index];
            if (segment.warningAt >= 0) {
                if (state.elapsed + 0.00001 >= segment.warningAt + 3) {
                    segment.brokenAt = segment.warningAt + 3;
                    onBreak(segment.id, segment.brokenAt);
                }
                continue;
            }
            let neighbour = 0;
            for (const id of entry.neighbours || []) {
                const adjacent = state.segments.find((item) => item.id === id);
                neighbour = Math.max(neighbour, adjacent?.heat || 0);
            }
            if (state.elapsed < entry.ignition && neighbour < 0.2 && segment.heat === 0) continue;
            let advance = 0;
            for (const id of entry.requires || []) {
                const parentIndex = state.segments.findIndex((item) => item.id === id);
                advance = Math.max(advance, definition.segments[parentIndex].breakAt - state.segments[parentIndex].brokenAt);
            }
            const baseline = Math.max(0, (state.elapsed + advance - entry.ignition) / (entry.breakAt - 3 - entry.ignition));
            // Natural schedule is a floor; local attacks and adjacent burning parts add heat.
            segment.heat = Math.min(1, Math.max(baseline + segment.attackHeat, segment.heat + dt * (1 + neighbour * 0.25) / entry.duration));
            if (segment.heat >= 1 - 1e-9) { segment.heat = 1; segment.warningAt = state.elapsed; }
        }
        const target = resolveMapFireProgress(definition, state);
        // A hit never jumps the sky. The host owns this bounded, exponentially eased value,
        // so paused games and late joins show the same slow transition.
        const difference = target - state.skyProgress;
        state.skyProgress += Math.min(0.02 * dt, Math.max(0, difference * -Math.expm1(-dt / 4)));
        if (target === 1 && state.skyProgress > 0.99999) state.skyProgress = 1;
    }
    return state;
}

export function resolveMapFireProgress(definition, state) {
    if (!state) return 0;
    let heat = 0;
    let count = 0;
    for (let i = 0; i < state.segments.length; i++) {
        if (definition.segments[i].phase !== 'fire') continue;
        heat += state.segments[i].heat;
        count++;
    }
    return heat / Math.max(1, count);
}
