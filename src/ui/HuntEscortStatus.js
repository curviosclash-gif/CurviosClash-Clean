import { formatHuntClock } from './HuntMatchStatusHelpers.js';

const PHASE_LABELS = Object.freeze({
    MOVING: 'Unterwegs',
    DOWNED: 'Ausgefallen',
    RECOVERING: 'Reparatur',
    GOAL: 'Ziel erreicht',
    DESTROYED: 'Zerstört',
});

export function createHuntEscortStatus(refs = {}) {
    return {
        root: refs.escortStatus ?? null,
        role: refs.escortRole ?? null,
        phaseElement: refs.escortPhase ?? null,
        progress: refs.escortProgress ?? null,
        progressFill: refs.escortProgressFill ?? null,
        checkpoints: refs.escortCheckpoints ?? null,
        health: refs.escortHealth ?? null,
        hpFill: refs.escortHpFill ?? null,
        hpText: refs.escortHpText ?? null,
        recovery: refs.escortRecovery ?? null,
        checkpointCount: -1,
        checkpointReached: -1,
        phase: null,
        objectiveText: null,
        scoreboardText: null,
        scoreboardDetails: null,
    };
}

export function resetHuntEscortStatus(status) {
    status.checkpointReached = -1;
    status.phase = null;
    status.root?.classList.add('hidden');
    status.root?.setAttribute?.('aria-hidden', 'true');
}

export function hideHuntEscortStatus(status) {
    status.root?.classList.add('hidden');
    status.root?.setAttribute?.('aria-hidden', 'true');
}

export function updateHuntEscortStatus(status, {
    huntProjection,
    localPlayerIndices,
    objectiveElement,
    scoreboardElement,
    targetProgress,
    matchAnnouncement,
} = {}) {
    const escort = huntProjection?.escort || {};
    const rows = Array.isArray(huntProjection?.scoreboardRows) ? huntProjection.scoreboardRows : [];
    const localIndex = localPlayerIndices.find((index) => Number.isInteger(index));
    const localTeam = rows.find((row) => row?.playerIndices?.includes?.(localIndex))?.teamId
        || rows.find((row) => row?.playerIndex === localIndex)?.teamId || 'ALPHA';
    const protecting = localTeam !== 'BRAVO';
    const progressPercent = Math.round(Math.max(0, Math.min(1, Number(escort.progress) || 0)) * 100);
    const hpPercent = Math.round(Math.max(0, Math.min(1, Number(escort.hpRatio) || 0)) * 100);
    const checkpointCount = Math.max(0, Number(escort.checkpointCount) || 0);
    const checkpointsReached = Math.max(0, Math.min(checkpointCount, Number(escort.checkpointsReached) || 0));
    const clock = Number(huntProjection?.timeLimitSeconds) > 0
        ? ` · ${formatHuntClock(huntProjection?.timeRemainingSeconds)}` : '';
    const alpha = rows.find((row) => row?.teamId === 'ALPHA') || {};
    const bravo = rows.find((row) => row?.teamId === 'BRAVO') || {};
    status.objectiveText = `${protecting ? 'Panzer schützen' : 'Panzer zerstören'}${clock}`;
    status.scoreboardText = `Blau ${Math.round(Number(alpha.escortSeconds) || 0)} s Eskorte · Orange ${Math.round(Number(bravo.escortTankDamage) || 0)} Schaden`;
    status.scoreboardDetails = `Team Blau: ${Math.round(Number(alpha.escortSeconds) || 0)} Sekunden Eskorte. Team Orange: ${Math.round(Number(bravo.escortTankDamage) || 0)} Panzerschaden.`;
    const repairProgress = Math.max(0, Math.min(1, Number(escort.repairProgress) || 0));
    const recoveryText = escort.phase === 'DOWNED'
        ? `Reparaturfenster ${Math.ceil(Number(escort.downedRemainingSeconds) || 0)} s`
        : (escort.phase === 'RECOVERING' ? `Reparatur ${Math.round(repairProgress * 100)}%` : '');

    targetProgress?.classList.add('hidden');
    targetProgress?.setAttribute?.('aria-hidden', 'true');
    status.root?.classList.remove('hidden');
    status.root?.setAttribute?.('aria-hidden', 'false');
    if (objectiveElement) objectiveElement.textContent = status.objectiveText;
    if (scoreboardElement) {
        scoreboardElement.textContent = status.scoreboardText;
        scoreboardElement.setAttribute?.('aria-label', status.scoreboardDetails);
    }
    if (status.role) status.role.textContent = protecting ? 'SCHÜTZEN' : 'ZERSTÖREN';
    if (status.phaseElement) status.phaseElement.textContent = PHASE_LABELS[escort.phase] || PHASE_LABELS.MOVING;
    if (status.progressFill) status.progressFill.style.width = `${progressPercent}%`;
    status.progress?.setAttribute?.('aria-valuenow', String(progressPercent));
    if (status.hpFill) status.hpFill.style.width = `${hpPercent}%`;
    status.health?.setAttribute?.('aria-valuenow', String(hpPercent));
    if (status.hpText) status.hpText.textContent = `${Math.ceil(Number(escort.hp) || 0)} / ${Math.ceil(Number(escort.maxHp) || 0)}`;
    if (status.recovery) {
        status.recovery.textContent = recoveryText;
        status.recovery.classList.toggle('hidden', !recoveryText);
    }
    if (status.checkpoints && checkpointCount !== status.checkpointCount) {
        status.checkpoints.replaceChildren();
        for (let i = 0; i < checkpointCount; i += 1) {
            const marker = status.checkpoints.ownerDocument.createElement('span');
            marker.className = 'escort-checkpoint';
            status.checkpoints.appendChild(marker);
        }
        status.checkpointCount = checkpointCount;
    }
    if (checkpointsReached !== status.checkpointReached) {
        const markers = status.checkpoints?.children || [];
        for (let i = 0; i < markers.length; i += 1) markers[i].classList.toggle('reached', i < checkpointsReached);
        if (status.checkpointReached >= 0 && checkpointsReached > status.checkpointReached) {
            matchAnnouncement?.show(`Checkpoint ${checkpointsReached}/${checkpointCount}`);
        }
        status.checkpointReached = checkpointsReached;
    }
    if (status.phase && escort.phase !== status.phase) {
        if (escort.phase === 'DOWNED') matchAnnouncement?.show('Panzer ausgefallen · reparieren!');
        else if (escort.phase === 'RECOVERING') matchAnnouncement?.show('Reparatur läuft');
        else if (escort.phase === 'MOVING') matchAnnouncement?.show('Panzer wieder einsatzbereit');
    }
    status.phase = escort.phase;
    return status;
}

export function syncHuntEscortStatus(owner, huntProjection, localPlayerIndices = []) {
    if (huntProjection?.escortMode !== true || huntProjection?.escort?.active !== true) {
        hideHuntEscortStatus(owner._escortStatus);
        return false;
    }
    const status = updateHuntEscortStatus(owner._escortStatus, {
        huntProjection,
        localPlayerIndices,
        objectiveElement: owner.objective,
        scoreboardElement: owner.scoreboard,
        targetProgress: owner.targetProgress,
        matchAnnouncement: owner._matchAnnouncement,
    });
    owner._objectiveText = status.objectiveText;
    owner._scoreboardText = status.scoreboardText;
    owner._scoreboardDetails = status.scoreboardDetails;
    return true;
}
