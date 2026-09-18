import { MatchHudAnnouncement, rankScoreRows } from './MatchHudAnnouncement.js';
import { formatPlayerDisplayLabel } from '../shared/contracts/PlayerDisplayLabelContract.js';
import { getHuntScoreValue } from './HuntMatchStatusHelpers.js';
import { HUNT_WIN_CONDITIONS, normalizeHuntWinCondition } from '../shared/contracts/HuntWinConditionContract.js';

export class MatchScoreHudPresenter {
    constructor(hud) {
        this.hud = hud;
        this.networkBoard = null;
        this.classicLabel = null;
        this.announcement = new MatchHudAnnouncement(hud);
    }

    updateClassic(players) {
        if (!this.classicLabel) {
            const label = this.hud.ownerDocument.createElement('div');
            label.className = 'classic-match-score-label';
            label.setAttribute('aria-live', 'off');
            this.hud.appendChild(label);
            this.classicLabel = label;
        }
        const ranked = rankScoreRows(players);
        const first = ranked[0];
        const firstScore = Number(first?.score) || 0;
        const secondScore = Number(ranked[1]?.score) || 0;
        const leader = first && firstScore > secondScore ? first : null;
        const nextText = leader
            ? `${formatPlayerDisplayLabel(leader)} führt · +${firstScore - secondScore}`
            : 'Gleichstand';
        if (this.classicLabel.textContent !== nextText) this.classicLabel.textContent = nextText;
        this.classicLabel.classList.toggle('hidden', ranked.length < 2);
        this.announcement.observe(players);
    }

    hideClassic() {
        this.classicLabel?.classList.add('hidden');
    }

    updateNetwork(projection, fallbackPlayers, localIndex) {
        const sourcePlayers = Array.isArray(projection?.players)
            ? projection.players : fallbackPlayers;
        const fightRows = projection?.hunt?.active === true && Array.isArray(projection.hunt.scoreboardRows)
            ? projection.hunt.scoreboardRows : null;
        const winCondition = normalizeHuntWinCondition(projection?.hunt?.winCondition);
        const lives = projection?.hunt?.livesRemainingByPlayer || {};
        const fightScores = fightRows && new Map(fightRows.map((row) =>
            [row.playerIndex, getHuntScoreValue(row, winCondition, lives)]));
        const players = fightScores
            ? [...(sourcePlayers || [])].sort((left, right) =>
                (fightScores.get(right?.playerIndex ?? right?.index) || 0)
                - (fightScores.get(left?.playerIndex ?? left?.index) || 0))
            : rankScoreRows(sourcePlayers);
        if (players.length === 0) return;
        const container = this._ensureNetworkBoard();
        const metric = fightScores ? (winCondition === HUNT_WIN_CONDITIONS.LAST_ALIVE ? 'lives'
            : winCondition === HUNT_WIN_CONDITIONS.SCORE_TARGET ? 'points' : 'kills') : 'score';
        if (container.dataset.metric !== metric) container.dataset.metric = metric;
        const boardLabel = fightScores ? (winCondition === HUNT_WIN_CONDITIONS.LAST_ALIVE
            ? 'Fight-Rangliste nach verbleibenden Leben'
            : winCondition === HUNT_WIN_CONDITIONS.SCORE_TARGET
                ? 'Fight-Rangliste nach Punkten' : 'Fight-Rangliste nach Abschüssen') : 'Rangliste nach Punkten';
        if (container.getAttribute('aria-label') !== boardLabel) container.setAttribute('aria-label', boardLabel);
        while (container.children.length < players.length) {
            const row = this.hud.ownerDocument.createElement('div');
            row.className = 'mp-scoreboard-row';
            for (const className of ['mp-sb-name', 'mp-sb-score', 'mp-sb-ping']) {
                const cell = this.hud.ownerDocument.createElement('span');
                cell.className = className;
                row.appendChild(cell);
            }
            container.appendChild(row);
        }
        while (container.children.length > players.length) {
            container.removeChild(container.lastChild);
        }
        const sessionPlayers = Array.isArray(projection?.sessionPlayers)
            ? projection.sessionPlayers : [];
        const scoreOf = (player) => fightScores
            ? (fightScores.get(player?.playerIndex ?? player?.index) || 0)
            : (Number(player?.score) || 0);
        const topScore = scoreOf(players[0]);
        const uniqueLeader = players.length === 1 || topScore > scoreOf(players[1]);
        if (projection?.hunt?.active !== true) this.announcement.observe(players);
        for (let index = 0; index < players.length; index += 1) {
            const player = players[index];
            const row = container.children[index];
            const playerIndex = player.playerIndex ?? player.index ?? index;
            const name = formatPlayerDisplayLabel({ ...player, index: playerIndex });
            const score = String(scoreOf(player));
            const peer = sessionPlayers.find((entry) =>
                (entry?.playerIndex ?? entry?.index) === playerIndex);
            const pingMs = peer?.pingMs ?? peer?.ping ?? (player.isBot ? 0 : -1);
            const ping = pingMs >= 0 ? `${pingMs}ms` : '';
            if (row.children[0].textContent !== name) row.children[0].textContent = name;
            if (row.children[1].textContent !== score) row.children[1].textContent = score;
            if (row.children[2].textContent !== ping) row.children[2].textContent = ping;
            row.classList.toggle('is-local', playerIndex === localIndex);
            row.classList.toggle('is-leading', uniqueLeader && index === 0);
        }
    }

    _ensureNetworkBoard() {
        if (this.networkBoard) return this.networkBoard;
        let container = this.hud.querySelector('.mp-scoreboard');
        if (!container) {
            container = this.hud.ownerDocument.createElement('div');
            container.className = 'mp-scoreboard';
            this.hud.appendChild(container);
        }
        this.networkBoard = container;
        return container;
    }

    resetEvent() {
        this.announcement.reset();
    }

    reset() {
        this.networkBoard?.remove();
        this.networkBoard = null;
        this.classicLabel?.remove();
        this.classicLabel = null;
        this.announcement.reset();
    }

    dispose() {
        this.reset();
        this.announcement.dispose();
        this.hud = null;
    }
}
