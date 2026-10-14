// Persist rendered trail matrices, including destroyed segments. Reconstructing
// trails from pilot positions alone would restore segments already shot away.
const CHANNELS = ['mesh', 'glowMesh'];
export function clearReplayTrails(entityManager) {
    for (const player of entityManager?.players || []) player?.trail?.clear?.();
}

export function createTrailStateRecorder() {
    const previous = new WeakMap();
    return (players, timeMs) => players.filter((p) => p.trail?.mesh).map((player) => {
        const trail = player.trail;
        let cache = previous.get(trail);
        const full = !cache || timeMs - cache.timeMs >= 5000;
        if (full) { cache = { timeMs }; previous.set(trail, cache); }
        const state = { player: player.index, full, count: trail.segmentCount, writeIndex: trail.writeIndex, channels: {} };
        for (const name of CHANNELS) {
            const mesh = trail[name];
            if (!mesh?.instanceMatrix?.array) continue;
            const values = mesh.instanceMatrix.array;
            const old = cache[name] ||= new Float32Array(values.length).fill(NaN);
            const changes = [];
            for (let slot = 0; slot < trail.segmentCount; slot++) {
                const offset = slot * 16;
                let changed = full;
                for (let j = 0; j < 16 && !changed; j++) changed = old[offset + j] !== values[offset + j];
                if (changed) {
                    const matrix = Array.from(values.subarray(offset, offset + 16));
                    changes.push([slot, ...matrix]); old.set(matrix, offset);
                }
            }
            const colors = mesh.instanceColor?.array;
            const colorChanges = [];
            if (colors) {
                const oldColors = cache[`${name}Colors`] ||= new Float32Array(colors.length).fill(NaN);
                for (let slot = 0; slot < trail.segmentCount; slot++) {
                    const offset = slot * 3;
                    if (full || oldColors[offset] !== colors[offset] || oldColors[offset + 1] !== colors[offset + 1]
                        || oldColors[offset + 2] !== colors[offset + 2]) {
                        const color = Array.from(colors.subarray(offset, offset + 3));
                        colorChanges.push([slot, ...color]); oldColors.set(color, offset);
                    }
                }
            }
            state.channels[name] = { count: mesh.count, changes, colorChanges };
        }
        state.heads = ['headMesh', 'glowHeadMesh'].flatMap((name) => trail[name]
            ? [{ name, visible: trail[name].visible, matrix: trail[name].matrix.toArray() }] : []);
        return state;
    });
}

export function applyRecordedTrailState(entityManager, states) {
    if (!Array.isArray(states)) return;
    for (const state of states) {
        const trail = entityManager.players.find((p) => p.index === state.player)?.trail;
        if (!trail) continue;
        if (state.full) trail.clear();
        trail.segmentCount = state.count; trail.writeIndex = state.writeIndex;
        for (const [name, data] of Object.entries(state.channels)) {
            const mesh = trail[name];
            if (!mesh?.instanceMatrix) continue;
            for (const [slot, ...matrix] of data.changes) mesh.instanceMatrix.array.set(matrix, slot * 16);
            mesh.instanceMatrix.needsUpdate = true; mesh.count = data.count;
            if (data.colors && mesh.instanceColor) {
                mesh.instanceColor.array.set(data.colors); mesh.instanceColor.needsUpdate = true;
            }
            if (data.colorChanges?.length && mesh.instanceColor) {
                for (const [slot, ...color] of data.colorChanges) mesh.instanceColor.array.set(color, slot * 3);
                mesh.instanceColor.needsUpdate = true;
            }
        }
        for (const head of state.heads) {
            const mesh = trail[head.name];
            if (!mesh) continue;
            mesh.matrix.fromArray(head.matrix).decompose(mesh.position, mesh.quaternion, mesh.scale);
            mesh.visible = head.visible;
        }
    }
}
