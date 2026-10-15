import { ARCADE_JOURNEY_STAGES, ARCADE_JOURNEY_WORLDS, getArcadeJourneyStars,
    resolveArcadeJourneyAccess } from '../../shared/contracts/ArcadeJourneyContract.js';
import { getArcadeJourneyLeaderboard } from '../../shared/contracts/ArcadeJourneyProgressContract.js';

function medalDescription(stage) {
    if (stage.metric === 'time') return `Bronze: Ziel erreichen · Silber: ${stage.silver / 1000} s · Gold: ${stage.gold / 1000} s`;
    if (stage.metric === 'ratio') return 'Bronze: 50 % · Silber: 70 % · Gold: 90 %';
    if (stage.metric === 'completion') return 'Bronze: alle Ringe und das Ziel erreichen';
    if (stage.metric === 'place') return 'Gold: als Erster ins Ziel';
    return `Bronze: ${stage.bronze ? `${stage.bronze.toLocaleString('de-DE')} Punkte` : 'Ziel erreichen'} · Silber: ${stage.silver.toLocaleString('de-DE')} · Gold: ${stage.gold.toLocaleString('de-DE')}`;
}

export function createArcadeJourneyMenuView(createElement) {
    const element = createElement('section', 'arcade-journey');
    element.setAttribute('aria-label', 'Arcade-Reise');
    const heading = createElement('h3', 'section-title', 'Deine Arcade-Reise');
    const status = createElement('p', 'menu-hint');
    status.setAttribute('aria-live', 'polite');
    const back = createElement('button', 'secondary-btn hidden', '← Reiseübersicht');
    back.type = 'button';
    back.dataset.journeyBack = 'true';
    const overview = createElement('div', 'arcade-journey-worlds');
    const rankTabs = createElement('div', 'arcade-journey-rank-tabs hidden');
    rankTabs.setAttribute('role', 'group'); rankTabs.setAttribute('aria-label', 'Bestenliste nach Spielerzahl');
    const rankButtons = [1, 2, 3].map((count) => {
        const button = createElement('button', 'secondary-btn', ['Allein', 'Zu zweit', 'Zu dritt'][count - 1]);
        button.type = 'button'; button.dataset.journeyPlayers = String(count); rankTabs.appendChild(button); return button;
    });
    const worlds = new Map();
    const cards = new Map();
    for (const world of ARCADE_JOURNEY_WORLDS) {
        const button = createElement('button', 'secondary-btn arcade-journey-world', world.label);
        button.type = 'button';
        button.dataset.journeyWorld = world.id;
        const copy = createElement('span', 'menu-hint', world.copy);
        button.appendChild(copy);
        const worldProgress = createElement('span', 'arcade-journey-world-progress'); button.appendChild(worldProgress);
        const reward = createElement('span', 'menu-hint'); button.appendChild(reward);
        overview.appendChild(button);
        const pane = createElement('div', 'arcade-journey-stages hidden');
        pane.dataset.journeyWorldPanel = world.id;
        pane.setAttribute('aria-label', world.label);
        for (const stage of ARCADE_JOURNEY_STAGES.filter(entry => entry.worldId === world.id)) {
            const card = createElement('article', 'arcade-journey-stage');
            card.dataset.journeyStage = stage.id;
            const title = createElement('h4', '', stage.label);
            const goal = createElement('p', 'menu-hint', stage.goal);
            const briefing = createElement('div', 'arcade-journey-briefing');
            const thresholds = createElement('p', 'menu-hint', medalDescription(stage));
            const medal = createElement('p', 'arcade-journey-medal');
            const condition = createElement('p', 'menu-hint');
            const start = createElement('button', 'start-btn', 'Losfliegen');
            start.type = 'button';
            start.dataset.journeyStart = stage.id;
            start.setAttribute('aria-label', `${stage.label}: Losfliegen`);
            const hangar = createElement('button', 'secondary-btn', 'Im Hangar anpassen'); hangar.type = 'button';
            hangar.dataset.journeyHangar = stage.id;
            const boardLabel = createElement('p', 'menu-hint');
            const board = createElement('ol', 'arcade-journey-board');
            card.append(title, goal, briefing, thresholds, medal, condition, boardLabel, board, start, hangar);
            pane.appendChild(card);
            cards.set(stage.id, { stage, card, title, briefing, medal, condition, start, hangar, boardLabel, board });
        }
        worlds.set(world.id, { button, pane, world, worldProgress, reward });
    }
    element.append(heading, status, back, rankTabs, overview, ...Array.from(worlds.values(), world => world.pane));
    let selectedWorld = '';
    let lastState = { progress: null, playerCount: 1, legacyAccess: false, available: false };
    let currentProfileId = '';
    let currentPartyCount = 0;
    let rankPlayers = 1;
    const render = (state = lastState) => {
        lastState = state;
        if (state.profileId !== currentProfileId) { currentProfileId = state.profileId; selectedWorld = ''; }
        if (state.playerCount !== currentPartyCount) { currentPartyCount = state.playerCount; rankPlayers = Math.min(3, currentPartyCount); }
        const stars = getArcadeJourneyStars(state.progress);
        heading.textContent = selectedWorld ? worlds.get(selectedWorld).world.label : 'Deine Arcade-Reise';
        status.textContent = state.available
            ? `${state.profileName || 'Spieler 1'} · ${stars} Sterne · ${state.playerCount} Spieler${state.legacyAccess ? ' · Bisherige Etappen bleiben frei' : ''}`
            : 'Reisefortschritt kann gerade nicht sicher gelesen werden. Deine gespeicherten Daten bleiben erhalten.';
        back.classList.toggle('hidden', !selectedWorld);
        overview.classList.toggle('hidden', Boolean(selectedWorld));
        rankTabs.classList.toggle('hidden', !selectedWorld);
        rankButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index + 1 === rankPlayers)));
        for (const [id, world] of worlds) {
            world.pane.classList.toggle('hidden', id !== selectedWorld);
            const worldStages = ARCADE_JOURNEY_STAGES.filter(stage => stage.worldId === id);
            const earned = worldStages.reduce((total, stage) => total + getArcadeJourneyStars(state.progress, stage.id), 0);
            world.button.setAttribute('aria-label', `${world.world.label}: ${earned} von ${worldStages.length * 3} Sternen`);
            const completed = worldStages.every(stage => getArcadeJourneyStars(state.progress, stage.id) > 0);
            world.reward.textContent = `Belohnung: ${world.world.reward}${completed ? ' · verdient' : ' · Bronze in jeder Etappe'}`;
            world.worldProgress.textContent = `${earned}/${worldStages.length * 3} Sterne · ${state.legacyAccess || stars >= world.world.starsRequired ? 'Welt offen' : `${world.world.starsRequired} Sterne benötigt`}`;
        }
        let recommended = false;
        for (const { stage, card, title, briefing, medal, condition, start, hangar, board, boardLabel } of cards.values()) {
            const access = resolveArcadeJourneyAccess(stage.id, state.progress, state);
            const earned = getArcadeJourneyStars(state.progress, stage.id);
            title.textContent = `${stage.label}${state.available && access.unlocked && !earned ? ' · Neu' : ''}`;
            briefing.replaceChildren();
            const preview = state.briefings?.[stage.id];
            if (preview) {
                const silhouette = createElement('span', 'arcade-journey-boss', preview.silhouette);
                silhouette.setAttribute('aria-hidden', 'true');
                briefing.append(silhouette, createElement('p', 'menu-hint', `Endgegner: ${preview.label}`),
                    createElement('p', 'menu-hint', preview.text));
            }
            const nightmareMedal = state.progress?.stages?.[stage.id]?.medals?.nightmare?.medal;
            const nightmare = Number.isInteger(nightmareMedal) && nightmareMedal >= 1 && nightmareMedal <= 3;
            medal.textContent = `${earned ? '★'.repeat(earned) : '☆'} ${earned}/3 Sterne${nightmare ? ' · Albtraum-Abzeichen' : ''}`;
            const next = state.available && access.unlocked && !earned && !stage.optional && !recommended;
            if (next) recommended = true;
            card.classList.toggle('is-recommended', next);
            condition.textContent = !state.available ? 'Speicher nicht verfügbar'
                : access.unlocked ? `${next ? 'Empfohlenes Ziel · ' : ''}${stage.optional ? 'Freiwillige Solo-Etappe' : '1–3 Spieler'}` : access.label;
            start.disabled = !state.available || !access.unlocked;
            hangar.disabled = !state.profileId;
            const count = Math.min(rankPlayers, stage.maxPlayers);
            const tierId = state.tiers?.[stage.id] || 'normal';
            const rows = getArcadeJourneyLeaderboard(state.progress, stage.id, tierId, count);
            boardLabel.textContent = `Persönliche Bestenliste · ${['Allein', 'Zu zweit', 'Zu dritt'][count - 1]} · ${{ normal: 'Normal', hard: 'Hart', nightmare: 'Albtraum' }[tierId]}`;
            board.replaceChildren();
            if (!rows.length) board.appendChild(createElement('li', 'menu-hint', 'Noch kein Ergebnis'));
            for (const row of rows) board.appendChild(createElement('li', '', stage.metric === 'time'
                ? `${(row.value / 1000).toFixed(2)} s` : stage.metric === 'ratio' ? `${Math.round(row.value * 100)} %`
                    : stage.metric === 'completion' ? 'Abgeschlossen' : stage.metric === 'place' ? `Platz ${row.value}` : `${row.value.toLocaleString('de-DE')} Punkte`));
        }
    };
    return {
        element, back, render,
        startButtons: Object.fromEntries(Array.from(cards, ([id, card]) => [id, card.start])),
        openStage(stageId) {
            const card = cards.get(stageId); if (!card) return;
            selectedWorld = card.stage.worldId; render(); (card.start.disabled ? back : card.start).focus();
        },
        bind(bind, onStart, onHangar) {
            rankButtons.forEach((button, index) => bind(button, 'click', () => { rankPlayers = index + 1; render(); }));
            for (const [id, world] of worlds) bind(world.button, 'click', () => {
                selectedWorld = id; render();
                (Array.from(cards.values()).find(card => card.stage.worldId === id && !card.start.disabled)?.start || back).focus();
            });
            bind(back, 'click', () => {
                const oldWorld = selectedWorld; selectedWorld = ''; render(); worlds.get(oldWorld)?.button.focus();
            });
            for (const { stage, start } of cards.values()) bind(start, 'click', () => {
                if (!start.disabled) onStart(stage);
            });
            for (const { stage, hangar } of cards.values()) bind(hangar, 'click', () => onHangar?.(stage));
        },
    };
}
