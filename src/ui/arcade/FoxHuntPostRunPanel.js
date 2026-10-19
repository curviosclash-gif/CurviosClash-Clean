import { createArcadeCardScroller } from './postrun/ArcadePostRunCards.js';
import { createArcadeBlock, createArcadeRankingBlock, countRow, durationRow, textRow, resolveArcadeMapLabel } from './postrun/ArcadePostRunBlocks.js';

export function renderFoxHuntPostRunPanel(controller, state, panel) {
    const summary = state.postRunSummary;
    panel.replaceChildren();
    const title = document.createElement('h2'); title.textContent = summary.resultTitle;
    const participants = summary.participants || [];
    const labels = Object.fromEntries(participants.map(p => [p.playerIndex, p.label]));
    const label = index => labels[index] || `Bot ${Number(index) + 1}`;
    const cards = [createArcadeRankingBlock(summary.ranking), createArcadeBlock('fox-hunt-result', 'Gesamtergebnis', [
        textRow('winner', 'Gesamtsieg', summary.leaders.map(label).join(' & ')),
        textRow('rules', 'Wertung', 'Gesamtpunkte → Fuchsringe → Fuchsabschüsse → geteilter Sieg'),
        ...Object.entries(summary.scoresByPlayer).map(([index, row]) => textRow(`score-${index}`, label(index),
            `${row.points} Punkte · ${row.rings} Fuchsringe · ${row.kills} Fuchsabschüsse`)),
    ]), ...participants.map(p => createArcadeBlock(`fox-hunt-profile-${p.playerIndex}`, p.label, [
        countRow('score', 'Punkte', p.score), textRow('success', 'Ergebnis', p.succeeded ? 'Erster Platz' : 'Lauf beendet'),
        textRow('medal', 'Medaille', ({ bronze: 'Bronze', silver: 'Silber', gold: 'Gold' })[p.medal] || 'Keine'),
        textRow('save', 'Profil', p.saveFailures.length ? 'Speichern ausstehend' : 'Ergebnis ausgewertet'),
        textRow('xp', 'Fahrzeug-XP', `${p.playerIndex === 0 ? summary.vehicleXpEarned : p.vehicleXpEarned} gespeichert`),
    ])), ...summary.maps.map((map, index) => createArcadeBlock(`fox-hunt-map-${index}`, resolveArcadeMapLabel(map.mapKey), [
        textRow('winner', map.leaders.length > 1 ? 'Geteilter Kartensieg' : 'Kartensieg', map.leaders.map(label).join(' & ')),
        textRow('reason', 'Kartenende', map.reason === 'finish' ? 'Fuchs im Ziel' : 'Fünf Minuten abgelaufen'),
        ...Object.entries(map.scoresByPlayer).map(([player, row]) => countRow(`points-${player}`, label(player), row.points)),
        durationRow('time', 'Aktive Spielzeit', map.totalTimeMs / 1000),
    ]))].filter(Boolean);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'arcade-overlay-action-btn'; close.textContent = 'Zum Menü';
    close.addEventListener('click', () => controller.runtimePort?.returnToMenu?.({ reason: 'hunt_parcours_finished' }));
    panel.append(title, createArcadeCardScroller(cards, 'Fuchsjagd-Ergebnisse', 'Keine Kartendaten.'), close);
    panel.classList.remove('hidden'); close.focus({ preventScroll: true }); return true;
}
