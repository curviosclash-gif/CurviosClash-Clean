import { ARCADE_JOURNEY_WORLDS, getArcadeJourneyStage, getArcadeJourneyStars, resolveArcadeJourneyAccess } from './ArcadeJourneyContract.js';

export function resolveJourneyNodeState(node, context) {
    const stage = getArcadeJourneyStage(node.stageId);
    const party = Number.isInteger(context.playerCount) && context.playerCount >= 1 && context.playerCount <= node.maxPlayers;
    const free = Boolean(node.freeAction) && !node.development && party;
    if (node.development) return { unlocked: false, free: false, label: 'In Entwicklung', reason: 'development', stars: 0, maxStars: 0 };
    const stars = stage && context.available ? getArcadeJourneyStars(context.progress, stage.id) : 0;
    const access = !party ? { unlocked: false, reason: 'player_count', label: node.maxPlayers === 1 ? 'Nur allein' : 'Für 1–3 Spieler' }
        : stage && !context.available ? { unlocked: false, reason: 'unavailable', label: 'Fortschritt nicht lesbar' }
            : stage ? resolveArcadeJourneyAccess(stage.id, context.progress, context) : { unlocked: free, reason: '', label: 'Freie Portaltour' };
    return { ...access, free, stars, maxStars: stage ? Math.max(stars, stage.metric === 'completion' ? 1 : 3) : 0,
        label: access.unlocked ? stars ? '★'.repeat(stars) : stage ? 'Bereit' : 'Freie Portaltour' : access.label };
}

export function journeyRequirements(stage, context) {
    if (!context.available) return 'Reisefortschritt kann gerade nicht sicher gelesen werden. Gespeicherte Medaillen bleiben erhalten.';
    if (context.legacyAccess || context.progress?.allStagesUnlocked) return 'Bestehender Sonderzugang · Spielergrenzen gelten weiterhin.';
    const threshold = ARCADE_JOURNEY_WORLDS.find(world => world.id === stage.worldId).starsRequired;
    const parts = threshold ? [`${threshold} ${threshold === 1 ? 'Reisestern' : 'Reisesterne'} insgesamt erforderlich · aktuell ${getArcadeJourneyStars(context.progress)}`] : [];
    if (stage.predecessorId) parts.push(`Bronze in „${getArcadeJourneyStage(stage.predecessorId).label}“${getArcadeJourneyStars(context.progress, stage.predecessorId) ? ' erreicht' : ' erforderlich'}`);
    return parts.join(' · ') || 'Reise-Einstieg ohne vorherige Medaille.';
}

export function nextJourneyNode(nodes, context) {
    if (!context.available) return null;
    const order = ['first_run', 'five_portals', 'five_fronts', ...nodes.map(node => node.stageId)];
    return order.map(id => nodes.find(node => node.stageId === id)).find(node => node && !node.development
        && !getArcadeJourneyStars(context.progress, node.stageId) && resolveJourneyNodeState(node, context).unlocked) || null;
}

export function journeyMedalTarget(stage, progress, tier, playerCount, rows) {
    const savedMedal = progress?.stages?.[stage.id]?.medals?.[tier]?.medal;
    const medal = Number.isInteger(savedMedal) && savedMedal >= 1 && savedMedal <= 3 ? savedMedal : 0;
    if (medal >= (stage.metric === 'completion' ? 1 : 3)) return 'Alle Medaillen dieser Wertung erreicht.';
    const name = stage.metric === 'place' ? 'Gold' : medal >= 2 ? 'Gold' : medal === 1 ? 'Silber' : 'Bronze';
    const threshold = name === 'Gold' ? stage.gold : name === 'Silber' ? stage.silver : stage.bronze;
    // The caller supplies only the stage/tier/party/version-partitioned current board.
    const best = rows.find(row => row.playerCount === playerCount && Number.isFinite(row.value));
    if (best && threshold && stage.metric === 'time' && best.value > threshold) return `Noch ${((best.value - threshold) / 1000).toFixed(2)} s schneller für ${name}.`;
    if (best && threshold && stage.metric === 'score' && best.value < threshold) return `Noch ${(threshold - best.value).toLocaleString('de-DE')} Punkte für ${name}.`;
    const goal = stage.metric === 'place' ? 'Platz 1' : stage.metric === 'time' && threshold ? `${threshold / 1000} s oder schneller`
        : stage.metric === 'score' && threshold ? `${threshold.toLocaleString('de-DE')} Punkte`
            : stage.metric === 'ratio' && threshold ? `${Math.round(threshold * 100)} % bei vollständigem Abschluss` : 'Ziel vollständig erreichen';
    return `Nächstes Ziel: ${name} · ${goal}.`;
}
