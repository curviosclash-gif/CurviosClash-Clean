// Council hardening v2 — Level 3
// Rollback reconciliation across sequence wrap, async validation, and shared state.

const UINT16_RANGE = 0x1_0000;

export function createRollbackReconciler({ initialState, applyInput, validateFrame }) {
    let state = { ...initialState };
    let lastSequence = 0;
    let disposed = false;
    const history = [];
    const validators = new Set();

    function isNewerSequence(sequence) {
        return sequence > lastSequence;
    }

    async function acceptFrame(frame) {
        if (disposed || !frame || !isNewerSequence(frame.sequence)) return false;

        const candidate = { ...state };
        for (const input of frame.inputs) {
            applyInput(candidate, input);
        }

        const validation = Promise.resolve(validateFrame(candidate, frame));
        validators.add(validation);
        const accepted = await validation;
        validators.delete(validation);

        if (!accepted) return false;
        history.push({ sequence: lastSequence, state });
        state = candidate;
        lastSequence = frame.sequence % UINT16_RANGE;
        return true;
    }

    function rollback(sequence) {
        const snapshot = history.findLast((entry) => entry.sequence <= sequence);
        if (!snapshot) return false;
        state = snapshot.state;
        lastSequence = snapshot.sequence;
        return true;
    }

    function dispose() {
        disposed = true;
        history.length = 0;
        validators.clear();
    }

    return {
        acceptFrame,
        dispose,
        getState: () => state,
        inspect: () => ({ disposed, lastSequence, historySize: history.length, validators: validators.size }),
        rollback,
    };
}
