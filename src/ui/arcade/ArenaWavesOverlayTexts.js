// Player facing texts for the Five Fronts ("arena_waves") screens. The run reuses the round end
// board, whose own title ("Bot 2 gewinnt die Runde", "Nächste Runde in 3…") does not fit a death
// that only moves the run on to the next map.

import { resolveFightMachineGunModel } from '../../shared/contracts/FightMachineGunContract.js';

const CHOICE_LABELS = Object.freeze({
    speed: 'Antrieb: +4 % Tempo',
    max_hp: 'Panzerung: +12 max. HP',
    pickup: 'Nachschub: mehr Items auf dem Feld',
    mg_tuning: 'MG-Tuning: eine Stufe stärker',
    'supply:shield': 'Kampfvorrat: Schild',
    'supply:rocket': 'Kampfvorrat: Rakete',
    'supply:health': 'Kampfvorrat: Reparatur',
    'supply:thick': 'Kampfvorrat: Dicke Spur',
});

export function formatArenaWavesChoiceLabel(choiceId) {
    const id = String(choiceId || '');
    if (CHOICE_LABELS[id]) return CHOICE_LABELS[id];
    if (id.startsWith('machine_gun:')) return `MG wechseln: ${resolveFightMachineGunModel(id.slice(12))?.label || id.slice(12)}`;
    return id.replace(/_/g, ' ');
}

/** Title and subline for the round end board while a Five Fronts screen owns it, else null. */
export function resolveArenaWavesBoardTexts(runtimeState) {
    if (runtimeState?.runType !== 'arena_waves') return null;
    if (runtimeState.postRunSummary) return { title: 'Fünf Fronten beendet', sub: '' };
    if (runtimeState.phase !== 'upgrade') return null;
    const mapCount = Math.max(1, Number(runtimeState.mapCount) || 5);
    const nextMap = Math.min(mapCount, Math.max(1, (Number(runtimeState.mapIndex) || 0) + 1));
    return { title: 'Abgeschossen', sub: `Wähle einen Vorteil für Karte ${nextMap}/${mapCount}.` };
}
