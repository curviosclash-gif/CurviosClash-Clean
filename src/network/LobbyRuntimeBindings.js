import { createRuntimeClock } from '../shared/contracts/RuntimeClockContract.js';
import { createRuntimeRng } from '../shared/contracts/RuntimeRngContract.js';

/**
 * Uhr und Wuerfel einer Lobby, aus den Konstruktor-Optionen aufgeloest.
 *
 * Lobbys bauen daraus Beitritts- und Sichtungszeitstempel sowie Kommando- und
 * Quittungs-IDs. Beides hing vorher direkt an `Date.now` und `Math.random` des
 * jeweiligen Rechners, war also weder steuerbar noch im Test reproduzierbar.
 * Ohne Injektion bleibt es beim bisherigen Verhalten, weil die beiden Contracts
 * selbst auf Wanduhr und globalen Zufall zurueckfallen.
 *
 * @param {{ nowMs?: unknown, random?: unknown }} [options]
 * @returns {{ nowMs: () => number, random: () => number }}
 */
export function createLobbyRuntimeBindings(options = {}) {
    return {
        nowMs: createRuntimeClock({ nowMs: options.nowMs }).nowMs,
        random: createRuntimeRng({ random: options.random }).next,
    };
}
