import { createFivePortalsBlocks, createDemolitionMapBlocks } from './postrun/ArcadeRunTypeBlocks.js';
import { createArcadeCardScroller } from './postrun/ArcadePostRunCards.js';
import { formatCount } from '../postmatch/PostMatchFormat.js';
import { createArcadeBlock, createArcadeRankingBlock, countRow, durationRow, textRow, resolveArcadeMapLabel } from './postrun/ArcadePostRunBlocks.js';
import { renderFoxHuntPostRunPanel } from './FoxHuntPostRunPanel.js';
const toSafeNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function renderFivePortalsPostRunPanel(controller, runtimeState) {
    const summary = runtimeState?.postRunSummary;
    if (runtimeState?.runType !== 'five_portals' || !summary || !Array.isArray(summary.maps)) return false;
    const panel = controller._ensureArcadeOverlayPanel(); if (!panel) return false;
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    const title = document.createElement('h2'); title.textContent = `${runtimeState?.chainLabel || 'Fünf Portale'} abgeschlossen`;
    const list = createArcadeCardScroller(createFivePortalsBlocks(summary), 'Zeiten', 'Keine Zeiten.');
    const close = document.createElement('button'); close.type = 'button'; close.className = 'arcade-overlay-action-btn'; close.textContent = 'Zum Menü';
    close.addEventListener('click', () => controller.runtimePort?.returnToMenu?.({ reason: 'five_portals_finished' }));
    panel.append(title, list, close); panel.classList.remove('hidden'); close.focus({ preventScroll: true }); return true;
}

export function renderDemolitionPostRunPanel(controller, runtimeState) {
    const summary = runtimeState?.postRunSummary;
    if (runtimeState?.runType !== 'demolition' || !summary || !Array.isArray(summary.maps)) return false;
    const panel = controller._ensureArcadeOverlayPanel(); if (!panel) return false;
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    const title = document.createElement('h2');
    title.textContent = `Abrisskommando abgeschlossen – ${formatCount(toSafeNumber(summary.total, 0))} Punkte`;
    const list = createArcadeCardScroller(createDemolitionMapBlocks(summary), 'Karten', 'Keine Kartendaten.');
    const xp = document.createElement('p'); xp.textContent = `${formatCount(toSafeNumber(summary.xpEarned, 0))} Fahrzeug-XP`;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'arcade-overlay-action-btn'; close.textContent = 'Zum Menü';
    close.addEventListener('click', () => controller.runtimePort?.returnToMenu?.({ reason: 'demolition_finished' }));
    panel.append(title, list, xp, close); panel.classList.remove('hidden'); close.focus({ preventScroll: true }); return true;
}

export function renderHuntParcoursPostRunPanel(controller, state) {
    const summary = state?.postRunSummary;
    if (state?.runType !== 'hunt_parcours' || !summary) return false;
    const panel = controller._ensureArcadeOverlayPanel();
    if (!panel) return false;
    if (state.variantId === 'fox_hunt') return renderFoxHuntPostRunPanel(controller, state, panel);
    if (state.variantId === 'thunderflight') return renderThunderflightPostRunPanel(controller, state, panel);
    panel.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = state.mapWins.human >= 2 ? 'Nemesis besiegt' : 'Nemesis gewinnt';
    const cards = [createArcadeRankingBlock(summary.ranking), createArcadeBlock('nemesis-result', summary.rival?.name || 'Rivale', [
    countRow('score', 'Punkte', summary.score), textRow('medal', 'Medaille', ({bronze:'Bronze',silver:'Silber',gold:'Gold'})[summary.medal] || 'Keine'),
    textRow('maps', 'Kartensiege', `${state.mapWins.human} : ${state.mapWins.rival}`),
    textRow('save', 'Profil', summary.saveFailures.length ? 'Speichern fehlgeschlagen' : 'Ergebnis ausgewertet'),
    textRow('xp', 'Fahrzeug-XP', summary.pendingRewardCount > 0 ? `${summary.vehicleXpEarned} gespeichert; weitere XP warten auf Speicherung` : `${summary.vehicleXpEarned} gespeichert`),
    ]), ...summary.maps.map((map,index) => createArcadeBlock(`nemesis-map-${index}`, resolveArcadeMapLabel(map.mapKey), [
    textRow('winner', 'Gewinner', map.won ? 'Spieler' : summary.rival.name),
    textRow('reason', 'Siegbedingung', map.reason === 'finish' ? 'Ziel erreicht' : 'Drei Abschüsse'),
    durationRow('time', 'Zeit', map.totalTimeMs / 1000),
    ]))].filter(Boolean);
    const list = createArcadeCardScroller(cards, 'Duell', 'Keine Kartendaten.');
    const close = document.createElement('button');close.type='button';close.className='arcade-overlay-action-btn';close.textContent='Zum Menü';
    close.addEventListener('click',()=>controller.runtimePort?.returnToMenu?.({reason:'hunt_parcours_finished'}));
    panel.append(title,list,close);panel.classList.remove('hidden');close.focus({preventScroll:true});return true;
}

function renderThunderflightPostRunPanel(controller, state, panel) {
    const summary = state.postRunSummary;
    panel.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = summary.runWinnerSide === 'human' ? 'Gewitterflug gewonnen'
        : summary.runWinnerSide === 'draw' ? 'Gewitterflug unentschieden' : 'Gewitterflug: Rennbot gewinnt';
    const cards = [createArcadeRankingBlock(summary.ranking), createArcadeBlock('thunderflight-result', 'Gesamtergebnis', [
        countRow('score', 'Ringpunkte', summary.score),
        textRow('medal', 'Medaille', ({ bronze: 'Bronze', silver: 'Silber', gold: 'Gold' })[summary.medal] || 'Keine'),
        ...Object.entries(summary.pointsByPlayer).map(([index, points]) => countRow(`player-${index}`, Number(index) === 0 ? 'Spieler' : `Rennbot ${index}`, points)),
        textRow('save', 'Profil', summary.saveFailures.length ? 'Speichern fehlgeschlagen' : 'Ergebnis ausgewertet'),
        textRow('xp', 'Fahrzeug-XP', summary.pendingRewardCount > 0 ? `${summary.vehicleXpEarned} gespeichert; weitere XP warten auf Speicherung` : `${summary.vehicleXpEarned} gespeichert`),
    ]), ...summary.maps.map((map, index) => createArcadeBlock(`thunderflight-map-${index}`, resolveArcadeMapLabel(map.mapKey), [
        countRow('points', 'Eigene Ringpunkte', map.pointsByPlayer?.[0] || 0),
        textRow('finisher', 'Zuerst im Ziel', map.finisherIndex === 0 ? 'Spieler' : `Rennbot ${map.finisherIndex}`),
        durationRow('time', 'Zeit', map.totalTimeMs / 1000),
    ]))].filter(Boolean);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'arcade-overlay-action-btn'; close.textContent = 'Zum Menü';
    close.addEventListener('click', () => controller.runtimePort?.returnToMenu?.({ reason: 'hunt_parcours_finished' }));
    panel.append(title, createArcadeCardScroller(cards, 'Gewitterflug-Ergebnisse', 'Keine Kartendaten.'), close);
    panel.classList.remove('hidden'); close.focus({ preventScroll: true }); return true;
}
