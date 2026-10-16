import { resolveArcadeMapLabel } from './postrun/ArcadePostRunBlocks.js';

export function renderHuntParcoursHud(hud, state) {
    if (state.runType !== 'hunt_parcours') return false;
    if (hud._metricLine) hud._metricLine.style.display = 'none';
    hud._endlessSection?.hide();
    if (hud._breakdownWrap) hud._breakdownWrap.style.display = 'none';
    if (hud._modifierWrap) hud._modifierWrap.style.display = 'none';
    hud._suddenDeathBanner?.classList?.add('hidden');
    hud._arenaWavesSection.style.display = 'block';
    const mapNumber = Math.min(3, Math.max(1, Number(state.mapIndex) + 1));
    if (hud._scoreLabel.textContent !== 'Nemesis') hud._scoreLabel.textContent = 'Nemesis';
    const mapLabel = `${mapNumber}/3`;
    if (hud._scoreValue.textContent !== mapLabel) hud._scoreValue.textContent = mapLabel;
    const text = `${state.rival?.name || 'Rivale'} · Stufe ${state.rival?.stage || 0}\n${resolveArcadeMapLabel(state.currentMapKey)}\n`
        + `Karten ${state.mapWins.human}–${state.mapWins.rival} · Abschüsse ${state.humanKills}/3–${state.rivalKills}/3\nZiel zuerst oder drei Abschüsse · zwei Kartensiege gewinnen`;
    if (hud._arenaWavesSection.textContent !== text) hud._arenaWavesSection.textContent = text;
    return true;
}
