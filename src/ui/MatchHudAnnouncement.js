// Small, HUD-local event state. The runtime projection remains the source of truth.
export { rankScoreRows, scoreRank } from '../shared/contracts/MatchScoreRanking.js';

export class MatchHudEventState {
    constructor() {
        this.reset();
    }

    reset() {
        this._started = false;
        this._leaderIndex = null;
        this._matchPointKey = '';
    }

    consume(rows, { scoreKey = 'score', target = 0 } = {}) {
        if (!Array.isArray(rows) || rows.length === 0) return null;
        let topScore = -Infinity;
        let leader = null;
        let tied = false;
        for (const row of rows) {
            const score = Number(row?.[scoreKey]) || 0;
            if (score > topScore) {
                topScore = score;
                leader = row;
                tied = false;
            } else if (score === topScore) {
                tied = true;
            }
        }
        if (tied) leader = null;
        const index = leader?.playerIndex ?? leader?.index ?? null;
        if (!this._started) {
            this._started = true;
            this._leaderIndex = index;
            return null;
        }

        const previousLeader = this._leaderIndex;
        this._leaderIndex = index;
        const label = String(leader?.label || leader?.name || `P${Number(index) + 1}`);
        const boundedTarget = Math.max(0, Math.floor(Number(target) || 0));
        const matchPointKey = boundedTarget > 1 && index !== null && topScore === boundedTarget - 1
            ? `${index}:${boundedTarget}` : '';
        if (matchPointKey && matchPointKey !== this._matchPointKey) {
            this._matchPointKey = matchPointKey;
            return `Matchball für ${label}`;
        }
        if (index !== null && index !== previousLeader) {
            return `${label} übernimmt die Führung`;
        }
        return null;
    }
}

export class MatchHudAnnouncement {
    constructor(parent) {
        this.parent = parent;
        this.state = new MatchHudEventState();
        this.element = null;
        this.timerId = null;
    }

    observe(rows, options) {
        const message = this.state.consume(rows, options);
        if (message) this.show(message);
    }

    show(message) {
        if (!this.parent || !message) return;
        if (!this.element) {
            this.element = this.parent.ownerDocument.createElement('div');
            this.element.className = 'match-hud-announcement';
            this.element.setAttribute('role', 'status');
            this.element.setAttribute('aria-live', 'polite');
            this.parent.appendChild(this.element);
        }
        if (this.timerId !== null) clearTimeout(this.timerId);
        if (this.element.textContent !== message) this.element.textContent = message;
        this.element.classList.add('is-visible');
        this.timerId = setTimeout(() => {
            this.element?.classList.remove('is-visible');
            this.timerId = null;
        }, 1600);
    }

    reset() {
        this.state.reset();
        if (this.timerId !== null) clearTimeout(this.timerId);
        this.timerId = null;
        this.element?.remove();
        this.element = null;
    }

    dispose() {
        this.reset();
        this.parent = null;
    }
}
