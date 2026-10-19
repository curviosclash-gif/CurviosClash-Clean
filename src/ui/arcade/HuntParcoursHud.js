import { resolveArcadeMapLabel } from './postrun/ArcadePostRunBlocks.js';
import { isHuntParcoursConfig } from '../../shared/contracts/HuntParcoursContract.js';
import { resolveHuntObjectiveText } from '../HuntMatchStatusHelpers.js';

/** The combat panel supplies health; dedicated run scores are displayed by the Arcade HUD. */
export function syncHuntParcoursStatus(hud) {
    const config = hud.runtime?.runtimeConfig;
    const active = isHuntParcoursConfig(config);
    if (hud.scoreboard) hud.scoreboard.hidden = active;
    if (!active) return false;
    const text = resolveHuntObjectiveText(null, config, { killLimit: 0, timeText: '', matchPointText: '' });
    if (hud.objective) hud.objective.textContent = text;
    hud._objectiveText = text;
    hud.targetProgress?.classList.toggle('hidden', true);
    hud._leaderIndex = null; hud._leaderKills = 0;
    return true;
}

export function renderHuntParcoursHud(hud, state) {
    if (state.runType !== 'hunt_parcours') return false;
    if (hud._metricLine) hud._metricLine.style.display = 'none';
    hud._endlessSection?.hide();
    if (hud._breakdownWrap) hud._breakdownWrap.style.display = 'none';
    if (hud._modifierWrap) hud._modifierWrap.style.display = 'none';
    hud._suddenDeathBanner?.classList?.add('hidden');
    hud._arenaWavesSection.style.display = 'block';
    if (state.variantId === 'fox_hunt') {
        hud._scoreLabel.textContent = 'Fuchsjagd'; hud._scoreValue.textContent = String(state.score || 0);
        const section = hud._arenaWavesSection;
        if (hud._foxRoleLine?.parentNode !== section) {
            hud._foxRoleLine = document.createElement('div'); hud._foxRoleLine.style.color = '#ffcc66';
            hud._foxRulesText = document.createElement('div'); section.replaceChildren(hud._foxRoleLine, hud._foxRulesText);
        }
        hud._foxRoleLine.textContent = `🦊 ${state.foxLabel} trägt das Signalpaket · ${Math.ceil(state.remainingSeconds)} s`;
        hud._foxRulesText.textContent = `Karte ${state.mapIndex + 1}/${state.mapCount} · ${resolveArcadeMapLabel(state.currentMapKey)}\n`
            + 'Fuchs: Ringe und Ziel · Jäger: Fuchs abschießen\n100 je Fuchsring · 250 je Fuchsabschuss · 1.000 Zielbonus';
        return true;
    }
    if (state.variantId === 'thunderflight') {
        hud._scoreLabel.textContent = 'Gewitterflug';
        hud._scoreValue.textContent = String(state.score || 0);
        hud._arenaWavesSection.textContent = `Karte ${state.mapIndex + 1}/${state.mapCount} · ${resolveArcadeMapLabel(state.currentMapKey)}\n`
            + `Höhenwertung ×${state.heightMultiplier} · 100 / 200 / 400 Punkte je Ring\n`
            + (state.lightningWarning ? `Blitz in ${Math.ceil(state.lightningWarning.remainingSeconds)} s · Tief fliegen!`
                : 'Höchstes Fünftel: Blitzgefahr · Ringpunkte entscheiden');
        return true;
    }
    const mapNumber = Math.min(3, Math.max(1, Number(state.mapIndex) + 1));
    if (hud._scoreLabel.textContent !== 'Nemesis') hud._scoreLabel.textContent = 'Nemesis';
    const mapLabel = `${mapNumber}/3`;
    if (hud._scoreValue.textContent !== mapLabel) hud._scoreValue.textContent = mapLabel;
    const text = `${state.rival?.name || 'Rivale'} · Stufe ${state.rival?.stage || 0}\n${resolveArcadeMapLabel(state.currentMapKey)}\n`
        + `Karten ${state.mapWins.human}–${state.mapWins.rival} · Abschüsse ${state.humanKills}/3–${state.rivalKills}/3\nZiel zuerst oder drei Abschüsse · zwei Kartensiege gewinnen`;
    if (hud._arenaWavesSection.textContent !== text) hud._arenaWavesSection.textContent = text;
    return true;
}
