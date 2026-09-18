import { MatchHudAnnouncement, rankScoreRows } from './MatchHudAnnouncement.js';
import { formatPlayerDisplayLabel } from '../shared/contracts/PlayerDisplayLabelContract.js';

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
        const killCounts = fightRows && new Map(fightRows.map((row) => [row.playerIndex, Number(row.kills) || 0]));
        const players = killCounts
            ? [...(sourcePlayers || [])].sort((left, right) =>
                (killCounts.get(right?.playerIndex ?? right?.index) || 0)
                - (killCounts.get(left?.playerIndex ?? left?.index) || 0))
            : rankScoreRows(sourcePlayers);
        if (players.length === 0) return;
        const container = this._ensureNetworkBoard();
        const metric = killCounts ? 'kills' : 'score';
        if (container.dataset.metric !== metric) container.dataset.metric = metric;
        const boardLabel = killCounts ? 'Fight-Rangliste nach Abschüssen' : 'Rangliste nach Punkten';
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
        const scoreOf = (player) => killCounts
            ? (killCounts.get(player?.playerIndex ?? player?.index) || 0)
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
