import { ARCADE_JOURNEY_WORLDS, getArcadeJourneyStage, getArcadeJourneyStars, getArcadeJourneyMaxStars } from '../../shared/contracts/ArcadeJourneyContract.js';
import { ARCADE_JOURNEY_MAP_WORLDS, ARCADE_JOURNEY_MAP_NODES, ARCADE_JOURNEY_MAP_LINKS } from '../../shared/contracts/ArcadeJourneyMapContract.js';
import { getArcadeJourneyLeaderboard, getArcadeJourneyLegacyLeaderboard } from '../../shared/contracts/ArcadeJourneyProgressContract.js';
import { createArcadeJourneyMapView } from './ArcadeJourneyMapView.js';
import { resolveJourneyNodeState, journeyRequirements, nextJourneyNode, journeyMedalTarget } from '../../shared/contracts/ArcadeJourneyPresentationContract.js';
import { resolvePortalChain } from '../../shared/contracts/PortalChainContract.js';
import { resolveMapPreview } from '../menu/MenuPreviewCatalog.js';

function medalDescription(stage) {
    if (!stage) return 'Die Medaillenziele folgen mit dieser Etappe.';
    if (stage.metric === 'time') return `Bronze: Ziel erreichen · Silber: ${stage.silver / 1000} s · Gold: ${stage.gold / 1000} s`;
    if (stage.metric === 'ratio') return 'Drei Belagerungen abschließen · Silber: 70 % · Gold: 90 %';
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
    const hub = createElement('section', 'journey-start-hub'); hub.setAttribute('aria-label', 'Startzentrale');
    hub.appendChild(createElement('h3', 'section-title', 'Startzentrale'));
    const hubActions = createElement('div', 'journey-start-actions'); hub.appendChild(hubActions);
    const recommendation = createElement('button', 'secondary-btn journey-next'); recommendation.type = 'button'; hub.appendChild(recommendation);
    const filterLabel = createElement('label', 'journey-filter', 'Anzeigen');
    const filter = createElement('select', 'menu-select'); filter.setAttribute('aria-label', 'Kartenziele anzeigen');
    for (const [value, label] of [['all','Alle Ziele'],['tour','Portaltouren'],['combat','Kampf'],['ready','Jetzt startbar']]) { const o = createElement('option', '', label); o.value = value; filter.appendChild(o); } filter.value = 'all'; filterLabel.appendChild(filter);
    const empty = createElement('p', 'menu-hint hidden', 'Keine passenden Ziele. Ändere den Filter oder kehre zur Reiseübersicht zurück.'); empty.setAttribute('role', 'status');
    const layout = createElement('div', 'journey-layout');
    const side = createElement('aside', 'journey-detail'); side.setAttribute('aria-label', 'Ausgewählte Etappe');
    const rankTabs = createElement('div', 'arcade-journey-rank-tabs');
    rankTabs.setAttribute('role', 'group'); rankTabs.setAttribute('aria-label', 'Bestenliste nach Spielerzahl');
    const rankButtons = [1, 2, 3].map(count => {
        const button = createElement('button', 'secondary-btn', ['Allein', 'Zu zweit', 'Zu dritt'][count - 1]);
        button.type = 'button'; button.dataset.journeyPlayers = String(count); rankTabs.appendChild(button); return button;
    });
    side.appendChild(rankTabs);
    const nodes = ARCADE_JOURNEY_MAP_NODES;
    const map = createArcadeJourneyMapView(createElement, ARCADE_JOURNEY_MAP_WORLDS, nodes, ARCADE_JOURNEY_MAP_LINKS);
    const cards = new Map();
    for (const node of nodes) {
        const stage = getArcadeJourneyStage(node.stageId);
        const card = createElement('article', 'arcade-journey-stage hidden');
        card.dataset.journeyStage = stage?.id || node.id;
        const title = createElement('h4', '', node.label);
        title.tabIndex = -1;
        const goal = createElement('p', 'menu-hint', node.goal.replace(/^Noch offen:\s*/, ''));
        const briefing = createElement('div', 'arcade-journey-briefing');
        const thresholds = createElement('p', 'menu-hint', medalDescription(stage));
        const medal = createElement('p', 'arcade-journey-medal');
        const condition = createElement('p', 'menu-hint');
        const prerequisite = createElement('button', 'secondary-btn hidden', 'Zur Voraussetzung'); prerequisite.type = 'button';
        const modeLabel = createElement('label', 'journey-play-mode', 'Wertung wählen');
        const mode = createElement('select', 'menu-select'); mode.setAttribute('aria-label', node.label + ': Wertung');
        for (const [value, label] of [['journey','Reise · Sterne verdienen'],['free','Freier Lauf · eigenen Rekord verbessern']]) { const o = createElement('option', '', label); o.value = value; mode.appendChild(o); } mode.value = node.stageId ? 'journey' : 'free'; modeLabel.appendChild(mode);
        modeLabel.classList.toggle('hidden', !stage || !node.freeAction);
        const rules = createElement('p', 'menu-hint journey-start-rules');
        const target = createElement('p', 'journey-medal-target');
        const route = createElement('ol', 'journey-tour-route'); route.setAttribute('aria-label', 'Streckenfolge der Tour');
        if (node.portalChainId) for (const key of resolvePortalChain(node.portalChainId).maps) route.appendChild(createElement('li', '', resolveMapPreview(key).name));
        route.classList.toggle('hidden', !node.portalChainId);
        const start = createElement('button', 'start-btn', stage ? 'Losfliegen' : 'Kommt bald');
        start.type = 'button'; start.dataset.journeyStart = stage?.id || node.id;
        start.setAttribute('aria-label', `${node.label}: ${stage ? 'Losfliegen' : 'Kommt bald'}`);
        const hangar = createElement('button', 'secondary-btn', 'Im Hangar anpassen');
        hangar.type = 'button'; hangar.dataset.journeyHangar = stage?.id || node.id;
        const boardLabel = createElement('p', 'menu-hint');
        const board = createElement('ol', 'arcade-journey-board');
        const history = createElement('details', 'arcade-journey-board-history hidden');
        history.appendChild(createElement('summary', '', 'Frühere Regeln · Bestwerte erhalten'));
        const historyBoard = createElement('ol', 'arcade-journey-legacy-board');
        history.appendChild(historyBoard);
        const returnButton = createElement('button', 'secondary-btn journey-return-map', '↑ Zur Karte'); returnButton.type = 'button';
        card.append(title, goal, briefing, route, thresholds, medal, condition, prerequisite, modeLabel, rules, target, start, hangar, boardLabel, board, history, returnButton);
        side.appendChild(card);
        cards.set(node.id, { node, stage, card, title, briefing, thresholds, medal, condition, prerequisite, mode, rules, target, start, hangar, boardLabel, board, history, historyBoard, returnButton });
    }
    layout.append(map.element, side);
    const legend = createElement('p', 'journey-map-legend', '→ Bronze-Voraussetzung · ┄→ Geplanter Weg · ◎ Tour · ◆ Boss · ● Etappe · kleine Plakette: Status · Kreuzende Wege sind keine Abzweigungen. Enter / A öffnet die Auswahl.');
    const legacyRewards = createElement('p', 'menu-hint journey-legacy-rewards');
    element.append(heading, status, hub, filterLabel, back, empty, layout, legend, legacyRewards);
    let selectedWorld = '', selectedNode = nodes[0].id;
    let lastState = { progress: null, playerCount: 1, legacyAccess: false, available: false };
    let currentProfileId = '', currentPartyCount = 0, rankPlayers = 1;
    let nodeStates = new Map();
    let freeStarts = {};
    const matches = node => filter.value === 'all' || filter.value === 'tour' && node.kind === 'tour' || filter.value === 'combat' && ['combat','boss'].includes(node.kind) || filter.value === 'ready' && (nodeStates.get(node.id)?.unlocked || nodeStates.get(node.id)?.free);
    const render = (state = lastState) => {
        lastState = state;
        nodeStates = new Map(nodes.map(node => [node.id, resolveJourneyNodeState(node, state)]));
        if (state.profileId !== currentProfileId) { currentProfileId = state.profileId; selectedWorld = ''; selectedNode = nodes[0].id; }
        const visible = nodes.filter(node => matches(node) && (!selectedWorld || node.worldId === selectedWorld));
        if (!visible.some(node => node.id === selectedNode)) selectedNode = visible[0]?.id || '';
        empty.classList.toggle('hidden', visible.length > 0);
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
        const next = nextJourneyNode(nodes, state); recommendation.disabled = !next;
        recommendation.textContent = next ? 'Nächste Reise-Etappe: ' + next.label + ' →' : state.available ? 'Keine offene, erreichbare Reise-Etappe für diese Gruppe' : 'Keine Reise-Empfehlung: Fortschritt nicht lesbar';
        recommendation.dataset.journeyNext = next?.id || '';
        const earnedRewards = ARCADE_JOURNEY_WORLDS.filter(world => state.available && world.rewardStageIds
            .every(stageId => getArcadeJourneyStars(state.progress, stageId) > 0)).map(world => world.reward);
        legacyRewards.textContent = earnedRewards.length ? `Bereits verdient: ${earnedRewards.join(' · ')}` : '';
        legacyRewards.classList.toggle('hidden', !earnedRewards.length);
        rankButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index + 1 === rankPlayers)));
        for (const [id, ref] of cards) {
            const { node, stage, card, title, briefing, medal, condition, start, hangar, board, boardLabel, history, historyBoard } = ref;
            const access = nodeStates.get(id);
            const stars = stage ? getArcadeJourneyStars(state.progress, stage.id) : 0;
            // Preserve earned historical medals even if today's objective awards fewer stars.
            const maxStars = Math.max(stars, getArcadeJourneyMaxStars(stage?.id));
            const label = access.label, free = ref.mode.value === 'free';
            card.classList.toggle('hidden', id !== selectedNode);
            title.textContent = `${node.label}${state.available && access.unlocked && !stars ? ' · Neu' : ''}`;
            briefing.replaceChildren();
            const preview = stage && state.briefings?.[stage.id];
            if (preview) briefing.append(createElement('span', 'arcade-journey-boss', preview.silhouette),
                createElement('p', 'menu-hint', `Endgegner: ${preview.label}`), createElement('p', 'menu-hint', preview.text));
            const nightmareMedal = state.progress?.stages?.[stage?.id]?.medals?.nightmare?.medal;
            medal.textContent = stage ? !state.available ? 'Gespeicherte Medaillen gerade nicht lesbar' : `${stars ? '★'.repeat(stars) : '☆'} ${stars}/${maxStars} Sterne${Number.isInteger(nightmareMedal) && nightmareMedal > 0 && nightmareMedal <= 3 ? ' · Albtraum-Abzeichen' : ''}` : node.development ? 'In Entwicklung' : 'Freie Tour · keine Reise-Sterne';
            medal.classList.toggle('hidden', free); ref.thresholds.classList.toggle('hidden', free || node.development);
            condition.textContent = stage ? journeyRequirements(stage, state) + (access.reason === 'player_count' ? ' · ' + access.label + ': Spielerzahl bewusst in der Zentrale ändern.' : '') : label;
            ref.prerequisite.classList.toggle('hidden', !stage?.predecessorId || !state.available || getArcadeJourneyStars(state.progress, stage.predecessorId) > 0 || state.legacyAccess || state.progress?.allStagesUnlocked === true);
            start.disabled = free ? !access.free : !access.unlocked;
            start.textContent = node.development ? 'In Entwicklung' : free ? 'Freien Lauf starten' : 'Reise starten';
            start.setAttribute('aria-label', node.label + ': ' + start.textContent);
            hangar.disabled = !state.profileId || node.development;
            ref.rules.textContent = node.development ? 'Dieser Kartenplatz bleibt für den entstehenden Inhalt reserviert.' : free ? 'Eigene Rekordwertung · keine Reise-Sterne oder Reisefreischaltungen.' : (node.maxPlayers === 1 ? 'Solo' : '1–3 lokale Spieler') + ' · Zugang über Spieler 1; gewertete Reiseergebnisse erhalten alle beteiligten Profile.';
            board.replaceChildren();
            historyBoard.replaceChildren(); history.classList.add('hidden');
            if (!stage) { boardLabel.textContent = node.development ? '' : state.freeRecords?.[node.id] || ''; ref.target.textContent = ''; continue; }
            const count = Math.min(rankPlayers, stage.maxPlayers), tierId = state.tiers?.[stage.id] || 'normal';
            const tierLabel = { normal: 'Normal', hard: 'Hart', nightmare: 'Albtraum' }[tierId];
            const fixedRules = node.portalChainId ? 'Feste Streckenfolge · 0 Bots · eigenes Hangar-Schiff · keine wählbare Laufstufe'
                : stage.runType === 'weapon_race' ? 'Angriffsparcours · Solo gegen 4 Bots · Waffenwechsel an Checkpoints'
                    : stage.runType === 'demolition' ? 'Drei Belagerungen · Karte, Bots und Ausrüstung je Auftrag festgelegt'
                        : resolveMapPreview(stage.mapKey).name + ' · ' + stage.botCount + ' Bots · ' + tierLabel + (stage.sectorCount ? ' · ' + stage.sectorCount + ' Sektoren' : '');
            ref.rules.textContent += ' ' + fixedRules + '.';
            const rows = getArcadeJourneyLeaderboard(state.progress, stage.id, tierId, count);
            const ownRows = getArcadeJourneyLeaderboard(state.progress, stage.id, tierId, state.playerCount);
            ref.target.textContent = state.available && !free ? journeyMedalTarget(stage, state.progress, tierId, state.playerCount, ownRows) : '';
            boardLabel.textContent = `Persönliche Bestenliste${stage.leaderboardLabel ? ` · ${stage.leaderboardLabel}` : ''} · ${['Allein', 'Zu zweit', 'Zu dritt'][count - 1]} · ${{ normal: 'Normal', hard: 'Hart', nightmare: 'Albtraum' }[tierId]}`;
            if (!rows.length) board.appendChild(createElement('li', 'menu-hint', 'Noch kein Ergebnis'));
            for (const row of rows) board.appendChild(createElement('li', '', leaderboardValue(stage, row.value)));
            const oldRows = getArcadeJourneyLegacyLeaderboard(state.progress, stage.id, tierId, count);
            history.classList.toggle('hidden', !oldRows.length);
            for (const row of oldRows) historyBoard.appendChild(createElement('li', '', leaderboardValue({ metric: stage.legacyLeaderboardMetric }, row.value)));
            boardLabel.classList.toggle('hidden', free || !state.available); board.classList.toggle('hidden', free || !state.available); history.classList.toggle('hidden', free || !state.available || !oldRows.length);
            if (free) { boardLabel.textContent = state.freeRecords?.[node.id] || 'Rekorde bleiben nach Strecke, Regeln und Spielerzahl getrennt.'; boardLabel.classList.remove('hidden'); }
        }
        map.render(selectedWorld, selectedNode, nodeStates, visible.map(node => node.id));
    };
    const select = (id, focusDetail = false) => { if (cards.has(id)) { selectedNode = id; render(); if (focusDetail) { const ref = cards.get(id); (ref.start.disabled ? ref.stage && ref.node.freeAction ? ref.mode : ref.title : ref.start).focus(); } } };
    return {
        element, back, hubActions, render, moveFocus: map.moveFocus, activateFocused: map.activateFocused, dispose: map.dispose,
        setFreeStarts(actions) { freeStarts = actions; },
        startButtons: Object.fromEntries(Array.from(cards.values()).filter(ref => ref.stage).map(ref => [ref.stage.id, ref.start])),
        openStage(stageId) {
            const ref = Array.from(cards.values()).find(entry => entry.stage?.id === stageId);
            if (!ref) return;
            filter.value = 'all'; ref.mode.value = 'journey'; selectedWorld = ref.node.worldId; select(ref.node.id); map.focusNode(ref.node.id);
        },
        bind(bind, onStart, onHangar) {
            const start = id => { const ref = cards.get(id); if (!ref || ref.start.disabled) return; const current = resolveJourneyNodeState(ref.node, lastState); if (ref.mode.value === 'free') { if (current.free) freeStarts[ref.node.freeAction]?.(); } else if (current.unlocked && ref.stage) onStart(ref.stage); };
            map.bind(bind, { onSelect: select, onWorld(id) {
                if (selectedWorld === id) { selectedWorld = ''; render(); map.focusWorld(id); return; }
                selectedWorld = id;
                const entries = nodes.filter(node => node.worldId === id && matches(node));
                const preferred = entries.find(node => nodeStates.get(node.id)?.unlocked && !nodeStates.get(node.id)?.stars)
                    || entries.find(node => nodeStates.get(node.id)?.unlocked) || entries[0];
                if (preferred) { select(preferred.id); map.focusNode(preferred.id); } else render();
            } });
            rankButtons.forEach((button, index) => bind(button, 'click', () => { rankPlayers = index + 1; render(); }));
            bind(back, 'click', () => { const oldWorld = selectedWorld; selectedWorld = ''; render(); map.focusWorld(oldWorld); });
            bind(filter, 'change', () => render());
            bind(recommendation, 'click', () => { const next = nextJourneyNode(nodes, lastState); if (!next) return; filter.value = 'all'; selectedWorld = ''; cards.get(next.id).mode.value = 'journey'; select(next.id); map.focusNode(next.id); });
            for (const ref of cards.values()) {
                bind(ref.start, 'click', () => start(ref.node.id));
                bind(ref.hangar, 'click', () => { if (!ref.hangar.disabled) onHangar?.(ref.stage); });
                bind(ref.mode, 'change', () => render());
                bind(ref.returnButton, 'click', () => { map.focusNode(ref.node.id); map.element.scrollIntoView?.({ block: 'nearest' }); });
                bind(ref.prerequisite, 'click', () => { const n = nodes.find(node => node.stageId === ref.stage?.predecessorId); if (!n) return; filter.value = 'all'; selectedWorld = n.worldId; select(n.id); map.focusNode(n.id); });
            }
        },
    };
}
