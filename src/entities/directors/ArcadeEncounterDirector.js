import { buildArcadeSectorPlan } from './ArcadeEncounterCatalog.js';

function clonePlan(plan) {
    if (!plan || typeof plan !== 'object') return null;
    return {
        ...plan,
        sequence: Array.isArray(plan.sequence) ? plan.sequence.map((entry) => ({ ...entry })) : [],
    };
}

function createDirectorState(options = {}) {
    const plan = buildArcadeSectorPlan(options);
    return {
        plan,
        cursor: 0,
        completed: [],
    };
}

export function createArcadeEncounterDirector(options = {}) {
    let state = createDirectorState(options);

    function reset(nextOptions = options) {
        state = createDirectorState(nextOptions);
        return getSnapshot();
    }

    function peekNextSector() {
        return state.plan.sequence[state.cursor] || null;
    }

    function consumeNextSector(result = null) {
        const current = peekNextSector();
        if (!current) return null;
        state.completed.push({
            ...current,
            result: result || null,
        });
        state.cursor += 1;
        return current;
    }

    function getSnapshot() {
        return {
            cursor: state.cursor,
            remaining: Math.max(0, state.plan.sequence.length - state.cursor),
            plan: clonePlan(state.plan),
            completed: state.completed.map((entry) => ({ ...entry })),
        };
    }

    return {
        reset,
        peekNextSector,
        consumeNextSector,
        getSnapshot,
    };
}

export default createArcadeEncounterDirector;
