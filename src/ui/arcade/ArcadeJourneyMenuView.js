import { ARCADE_JOURNEY_STAGES, ARCADE_JOURNEY_WORLDS, getArcadeJourneyStage, getArcadeJourneyStars, getArcadeJourneyMaxStars, resolveArcadeJourneyAccess } from '../../shared/contracts/ArcadeJourneyContract.js';
import { ARCADE_JOURNEY_MAP_WORLDS, ARCADE_JOURNEY_MAP_NODES, ARCADE_JOURNEY_MAP_LINKS } from '../../shared/contracts/ArcadeJourneyMapContract.js';
import { getArcadeJourneyLeaderboard } from '../../shared/contracts/ArcadeJourneyProgressContract.js';
import { createArcadeJourneyMapView } from './ArcadeJourneyMapView.js';

function medalDescription(stage) {
    if (!stage) return 'Die Medaillenziele folgen mit dieser Etappe.';
    if (stage.metric === 'time') return `Bronze: Ziel erreichen · Silber: ${stage.silver / 1000} s · Gold: ${stage.gold / 1000} s`;
    if (stage.metric === 'ratio') return 'Bronze: 50 % · Silber: 70 % · Gold: 90 %';
    if (stage.metric === 'completion') return 'Bronze: alle Ringe und das Ziel erreichen';
    if (stage.metric === 'place') return 'Gold: als Erster ins Ziel';
    return `Bronze: ${stage.bronze ? `${stage.bronze.toLocaleString('de-DE')} Punkte` : 'Ziel erreichen'} · Silber: ${stage.silver.toLocaleString('de-DE')} · Gold: ${stage.gold.toLocaleString('de-DE')}`;
}

function leaderboardValue(stage, value) {
    if (stage.metric === 'time') return `${(value / 1000).toFixed(2)} s`;
    if (stage.metric === 'ratio') return `${Math.round(value * 100)} %`;
    if (stage.metric === 'completion') return 'Abgeschlossen';
    if (stage.metric === 'place') return `Platz ${value}`;
    return `${value.toLocaleString('de-DE')} Punkte`;
}

export function createArcadeJourneyMenuView(createElement) {
    const element = createElement('section', 'arcade-journey');
    element.setAttribute('aria-label', 'Arcade-Reise');
    const heading = createElement('h3', 'section-title', 'Arcade-Reise');
    const status = createElement('p', 'menu-hint'); status.setAttribute('aria-live', 'polite');
    const back = createElement('button', 'secondary-btn hidden', '← Reiseübersicht');
    back.type = 'button'; back.dataset.journeyBack = 'true';
    const layout = createElement('div', 'journey-layout');
    const side = createElement('aside', 'journey-detail'); side.setAttribute('aria-label', 'Ausgewählte Etappe');
    const rankTabs = createElement('div', 'arcade-journey-rank-tabs');
    rankTabs.setAttribute('role', 'group'); rankTabs.setAttribute('aria-label', 'Bestenliste nach Spielerzahl');
    const rankButtons = [1, 2, 3].map(count => {
        const button = createElement('button', 'secondary-btn', ['Allein', 'Zu zweit', 'Zu dritt'][count - 1]);
        button.type = 'button'; button.dataset.journeyPlayers = String(count); rankTabs.appendChild(button); return button;
    });
    side.appendChild(rankTabs);
    const extras = ARCADE_JOURNEY_STAGES.filter(stage => !ARCADE_JOURNEY_MAP_NODES.some(node => node.stageId === stage.id))
        .map((stage, index) => ({ id: `extra_${stage.id}`, stageId: stage.id, worldId: 'extras', label: stage.label, goal: stage.goal, x: index * 100, y: 50 }));
    const nodes = [...ARCADE_JOURNEY_MAP_NODES, ...extras];
    const map = createArcadeJourneyMapView(createElement, ARCADE_JOURNEY_MAP_WORLDS, nodes, ARCADE_JOURNEY_MAP_LINKS);
    const cards = new Map();
    for (const node of nodes) {
        const stage = getArcadeJourneyStage(node.stageId);
        const card = createElement('article', 'arcade-journey-stage hidden');
        card.dataset.journeyStage = stage?.id || node.id;
        const title = createElement('h4', '', node.label);
        const goal = createElement('p', 'menu-hint', node.goal.replace(/^Noch offen:\s*/, ''));
        const briefing = createElement('div', 'arcade-journey-briefing');
        const thresholds = createElement('p', 'menu-hint', medalDescription(stage));
        const medal = createElement('p', 'arcade-journey-medal');
        const condition = createElement('p', 'menu-hint');
        const start = createElement('button', 'start-btn', stage ? 'Losfliegen' : 'Kommt bald');
        start.type = 'button'; start.dataset.journeyStart = stage?.id || node.id;
        start.setAttribute('aria-label', `${node.label}: ${stage ? 'Losfliegen' : 'Kommt bald'}`);
        const hangar = createElement('button', 'secondary-btn', 'Im Hangar anpassen');
        hangar.type = 'button'; hangar.dataset.journeyHangar = stage?.id || node.id;
        const boardLabel = createElement('p', 'menu-hint');
        const board = createElement('ol', 'arcade-journey-board');
        card.append(title, goal, briefing, thresholds, medal, condition, start, hangar, boardLabel, board);
        side.appendChild(card);
        cards.set(node.id, { node, stage, card, title, briefing, medal, condition, start, hangar, boardLabel, board });
    }
    layout.append(map.element, side);
    const legend = createElement('p', 'journey-map-legend', '★ Geschafft · ○ Offen · ◇ Nebenetappe · ◎ Endgegner · Pfeiltasten wählen, Enter / A startet');
    const extraGroup = createElement('details', 'journey-extra-runs');
    extraGroup.appendChild(createElement('summary', '', 'Weitere Herausforderungen'));
    const legacyRewards = createElement('p', 'menu-hint journey-legacy-rewards');
    extraGroup.appendChild(legacyRewards);
    const extraButtons = extras.map(node => {
        const button = createElement('button', 'secondary-btn', node.label);
        button.type = 'button'; button.dataset.journeyExtra = node.id; extraGroup.appendChild(button); return button;
    });
    element.append(heading, status, back, layout, legend, extraGroup);
    let selectedWorld = '', selectedNode = nodes[0].id;
    let lastState = { progress: null, playerCount: 1, legacyAccess: false, available: false };
    let currentProfileId = '', currentPartyCount = 0, rankPlayers = 1;
    let nodeStates = new Map();
    const render = (state = lastState) => {
        lastState = state;
        if (state.profileId !== currentProfileId) { currentProfileId = state.profileId; selectedWorld = ''; selectedNode = nodes[0].id; }
        if (state.playerCount !== currentPartyCount) { currentPartyCount = state.playerCount; rankPlayers = Math.min(3, currentPartyCount); }
        const solo = state.playerCount === 1;
        if (solo) rankPlayers = 1;
        rankTabs.classList.toggle('hidden', solo);
        rankTabs.setAttribute('aria-hidden', String(solo));
        rankButtons.forEach(button => { button.disabled = solo; button.tabIndex = solo ? -1 : 0; });
        heading.textContent = ARCADE_JOURNEY_MAP_WORLDS.find(world => world.id === selectedWorld)?.label || (selectedWorld === 'extras' ? 'Weitere Herausforderungen' : 'Arcade-Reise');
        status.textContent = state.available
            ? `${state.profileName || 'Spieler 1'} · ${getArcadeJourneyStars(state.progress)} Sterne · ${state.playerCount} Spieler`
            : 'Reisefortschritt kann gerade nicht sicher gelesen werden. Deine gespeicherten Daten bleiben erhalten.';
        back.classList.toggle('hidden', !selectedWorld);
        const earnedRewards = ARCADE_JOURNEY_WORLDS.filter(world => world.rewardStageIds
            .every(stageId => getArcadeJourneyStars(state.progress, stageId) > 0)).map(world => world.reward);
        legacyRewards.textContent = earnedRewards.length ? `Bereits verdient: ${earnedRewards.join(' · ')}` : '';
        legacyRewards.classList.toggle('hidden', !earnedRewards.length);
        rankButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index + 1 === rankPlayers)));
        nodeStates = new Map();
        for (const [id, ref] of cards) {
            const { node, stage, card, title, briefing, medal, condition, start, hangar, board, boardLabel } = ref;
            const access = stage ? resolveArcadeJourneyAccess(stage.id, state.progress, state) : { unlocked: false, label: 'Kommt bald' };
            const stars = stage ? getArcadeJourneyStars(state.progress, stage.id) : 0;
            // Preserve earned historical medals even if today's objective awards fewer stars.
            const maxStars = Math.max(stars, getArcadeJourneyMaxStars(stage?.id));
            const label = !state.available ? 'Speicher nicht verfügbar' : access.unlocked ? stars ? 'Geschafft' : 'Offen' : access.label;
            nodeStates.set(id, { unlocked: state.available && access.unlocked, stars, maxStars, label });
            card.classList.toggle('hidden', id !== selectedNode);
            title.textContent = `${node.label}${state.available && access.unlocked && !stars ? ' · Neu' : ''}`;
            briefing.replaceChildren();
            const preview = stage && state.briefings?.[stage.id];
            if (preview) briefing.append(createElement('span', 'arcade-journey-boss', preview.silhouette),
                createElement('p', 'menu-hint', `Endgegner: ${preview.label}`), createElement('p', 'menu-hint', preview.text));
            const nightmareMedal = state.progress?.stages?.[stage?.id]?.medals?.nightmare?.medal;
            medal.textContent = stage ? `${stars ? '★'.repeat(stars) : '☆'} ${stars}/${maxStars} Sterne${Number.isInteger(nightmareMedal) && nightmareMedal > 0 && nightmareMedal <= 3 ? ' · Albtraum-Abzeichen' : ''}` : 'Noch offen';
            condition.textContent = access.unlocked ? `${stage.maxPlayers === 1 ? 'Solo-Etappe' : '1–3 Spieler'} · ${label}` : label;
            start.disabled = !stage || !state.available || !access.unlocked;
            hangar.disabled = !state.profileId || !stage;
            board.replaceChildren();
            if (!stage) { boardLabel.textContent = ''; continue; }
            const count = Math.min(rankPlayers, stage.maxPlayers), tierId = state.tiers?.[stage.id] || 'normal';
            const rows = getArcadeJourneyLeaderboard(state.progress, stage.id, tierId, count);
            boardLabel.textContent = `Persönliche Bestenliste · ${['Allein', 'Zu zweit', 'Zu dritt'][count - 1]} · ${{ normal: 'Normal', hard: 'Hart', nightmare: 'Albtraum' }[tierId]}`;
            if (!rows.length) board.appendChild(createElement('li', 'menu-hint', 'Noch kein Ergebnis'));
            for (const row of rows) board.appendChild(createElement('li', '', leaderboardValue(stage, row.value)));
        }
        map.render(selectedWorld, selectedNode, nodeStates);
    };
    const select = id => { if (cards.has(id)) { selectedNode = id; render(); } };
    return {
        element, back, render, moveFocus: map.moveFocus, activateFocused: map.activateFocused,
        startButtons: Object.fromEntries(Array.from(cards.values()).filter(ref => ref.stage).map(ref => [ref.stage.id, ref.start])),
        openStage(stageId) {
            const ref = Array.from(cards.values()).find(entry => entry.stage?.id === stageId);
            if (!ref) return;
            selectedWorld = ref.node.worldId; select(ref.node.id); map.focusNode(ref.node.id);
        },
        bind(bind, onStart, onHangar) {
            const start = id => { const ref = cards.get(id); if (ref?.stage && !ref.start.disabled) onStart(ref.stage); };
            map.bind(bind, { onSelect: select, onStart: start, onWorld(id) {
                selectedWorld = id;
                const entries = nodes.filter(node => node.worldId === id);
                const preferred = entries.find(node => nodeStates.get(node.id)?.unlocked && !nodeStates.get(node.id)?.stars)
                    || entries.find(node => nodeStates.get(node.id)?.unlocked) || entries[0];
                select(preferred.id); map.focusNode(preferred.id);
            } });
            rankButtons.forEach((button, index) => bind(button, 'click', () => { rankPlayers = index + 1; render(); }));
            bind(back, 'click', () => { const oldWorld = selectedWorld; selectedWorld = ''; render(); map.focusWorld(oldWorld); });
            for (const ref of cards.values()) {
                bind(ref.start, 'click', () => start(ref.node.id));
                bind(ref.hangar, 'click', () => { if (!ref.hangar.disabled) onHangar?.(ref.stage); });
            }
            extraButtons.forEach(button => bind(button, 'click', () => {
                selectedWorld = 'extras'; select(button.dataset.journeyExtra); map.focusNode(button.dataset.journeyExtra);
            }));
        },
    };
}
