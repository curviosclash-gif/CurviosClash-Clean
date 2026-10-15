import { getArcadeJourneyStage } from '../../shared/contracts/ArcadeJourneyContract.js';

function element(tag, text, className = '') {
    const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}

export function renderArcadeJourneyResult(panel, state, onAction) {
    const journey = state?.journey;
    const stage = getArcadeJourneyStage(journey?.stageId);
    if (!panel || !stage || !journey?.result) return false;
    panel.replaceChildren();
    panel.appendChild(element('h2', stage.label));
    const medal = Math.max(0, Math.min(3, journey.medal || 0));
    panel.appendChild(element('p', medal ? `${'★'.repeat(medal)} ${['', 'Bronze', 'Silber', 'Gold'][medal]}` : 'Ziel noch nicht erreicht', 'arcade-journey-result-medal'));
    if (stage.metric === 'time' && Number.isFinite(journey.result.value) && journey.result.value > 0) {
        panel.appendChild(element('p', `Zeit: ${(journey.result.value / 1000).toFixed(2)} s`, 'arcade-journey-result-time'));
    }
    const xp = Number(state.vehicleXpEarned ?? state.xpEarned ?? state.postRunSummary?.xpEarned) || 0;
    panel.appendChild(element('p', `${Math.max(0, Math.round(xp))} Fahrzeug-XP`));
    const primary = journey.recipients?.[0];
    if (primary?.rank) panel.appendChild(element('p', `Platz ${primary.rank} von ${primary.count} in deiner Etappen-Bestenliste`));
    const saved = journey.recipients?.filter(recipient => ['saved', 'unchanged'].includes(recipient.status)).length || 0;
    const status = element('p', journey.pending ? 'Speicherung ausstehend. Der nächste Start wartet auf deine gespeicherten Medaillen.'
        : medal ? `Medaille für ${saved} Spielerprofile gesichert` : 'Versuche die Etappe noch einmal.');
    panel.appendChild(status);
    const buttons = [];
    let busy = false;
    for (const [action, label] of [['retry', 'Nochmal'], ['next', 'Nächste Etappe'], ['map', 'Zur Landkarte'], ['hangar', 'Im Hangar anpassen']]) {
        const button = element('button', label, 'arcade-overlay-action-btn'); button.type = 'button';
        button.dataset.journeyAction = action;
        button.disabled = action === 'next' ? journey.pending || !journey.nextStageId : action === 'retry' && journey.pending;
        const disabled = button.disabled;
        button.addEventListener('click', () => {
            if (busy) return;
            busy = true; buttons.forEach(entry => { entry.button.disabled = true; });
            Promise.resolve().then(() => onAction(action, action === 'next' ? journey.nextStageId : stage.id)).catch(() => {
                busy = false; buttons.forEach(entry => { entry.button.disabled = entry.disabled; });
                status.textContent = 'Aktion konnte nicht gestartet werden. Bitte erneut versuchen.';
            });
        });
        buttons.push({ button, disabled });
        panel.appendChild(button);
    }
    panel.classList.remove('hidden');
    panel.querySelector?.('button:not(:disabled)')?.focus({ preventScroll: true });
    return true;
}

/** Return through the established lifecycle, then reuse the menu's validated start and hangar actions. */
export async function requestArcadeJourneyResultAction(controller, action, stageId) {
    if (typeof controller.runtimePort?.returnToMenu !== 'function') throw new Error('Menu lifecycle unavailable');
    await Promise.resolve(controller.runtimePort.returnToMenu({ reason: `journey_${action}`, panelId: 'submenu-custom' }));
    const ui = controller.game?.ui;
    ui?.arcadeJourneyOpenStage?.(stageId);
    if (action === 'retry' || action === 'next') ui?.arcadeJourneyStartButtons?.[stageId]?.click();
    if (action === 'hangar') ui?.arcadeJourneyHangarButton?.click();
}
