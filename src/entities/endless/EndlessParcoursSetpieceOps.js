import { EndlessParcoursSetpieceBank } from './EndlessParcoursSetpieceBank.js';

export async function prepareEndlessSetpieces(runtime, options = {}) {
    if (runtime._disposed) throw new Error('Cannot prepare a disposed Endlos run');
    if (!runtime._setpieceBank) runtime._setpieceBank = new EndlessParcoursSetpieceBank(options);
    const bank = runtime._setpieceBank;
    await bank.prepare();
    if (runtime._disposed) throw new Error('Endlos obstacle preparation was cancelled');
    // Preparation happens before the match is published or players spawn. Rebuild the
    // initial window once; gameplay streaming only creates synchronous ready instances.
    for (const [index, instance] of runtime.activeModules) {
        if (instance.setpiece) continue;
        runtime._removeModule(instance);
        runtime.activeModules.set(index, runtime._instantiateModule(instance.module));
    }
}

export function updateEndlessSetpieces(runtime, dt) {
    if (runtime._disposed || runtime._finalized || !runtime._setpieceBank?.ready) return;
    runtime._setpieceElapsedSeconds = (runtime._setpieceElapsedSeconds || 0) + Math.max(0, Number(dt) || 0);
    let changed = false;
    for (const instance of runtime.activeModules.values()) {
        if (!instance.setpiece) continue;
        instance.setpiece.update(runtime._setpieceElapsedSeconds);
        changed = true;
    }
    if (changed) runtime.arena?.invalidateDynamicColliders?.();
}
