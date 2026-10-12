// Shows the arcade companions (allied bots on the human's team) with a health bar each,
// so the player sees at a glance who is still flying. Rows are built once and only their
// text and bar width change per update.
const MAX_ROWS = 2;

/**
 * The companions in a projected player list: bots that share the human's team. Outside a
 * companion run nobody has a team in arcade, so the list stays empty.
 * @param {Array<{ isBot?: boolean, teamId?: string | null, playerIndex?: number, alive?: boolean, hp?: number, maxHp?: number }> | null | undefined} players
 */
export function selectArcadeCompanions(players) {
    const list = Array.isArray(players) ? players : [];
    const human = list.find((player) => player && player.isBot !== true && player.teamId);
    if (!human) return [];
    return list.filter((player) => player?.isBot === true && player.teamId === human.teamId).slice(0, MAX_ROWS);
}

function healthPercent(player) {
    if (player?.alive === false) return 0;
    const maxHp = Math.max(1, Number(player?.maxHp) || 1);
    return Math.max(0, Math.min(100, Math.round((Math.max(0, Number(player?.hp) || 0) / maxHp) * 100)));
}

export class ArcadeCompanionHUD {
    constructor(parentElement, doc = document) {
        this._doc = doc;
        this._container = doc.createElement('div');
        this._container.id = 'arcade-companion-hud';
        this._container.className = 'arcade-companion-hud';
        this._container.style.cssText = [
            'position: fixed', 'left: 12px', 'bottom: 140px', 'z-index: 900', 'display: none',
            'flex-direction: column', 'gap: 4px', 'pointer-events: none', 'font: 600 12px/1.3 sans-serif',
        ].join(';');
        this._rows = [];
        for (let index = 0; index < MAX_ROWS; index += 1) this._rows.push(this._createRow(index));
        (parentElement || doc.body).appendChild(this._container);
    }

    _createRow(index) {
        const row = this._doc.createElement('div');
        row.className = 'arcade-companion-row';
        row.style.cssText = 'display: none; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 6px; background: rgba(0, 20, 40, 0.65); color: #cfeaff';
        const label = this._doc.createElement('span');
        label.textContent = `Mitstreiter ${index + 1}`;
        const track = this._doc.createElement('span');
        track.style.cssText = 'width: 80px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.18); overflow: hidden';
        const fill = this._doc.createElement('span');
        fill.style.cssText = 'display: block; height: 100%; width: 0%; background: #00aaff';
        track.appendChild(fill);
        const status = this._doc.createElement('span');
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(status);
        this._container.appendChild(row);
        return { row, fill, status, shown: false, percent: -1 };
    }

    update(players) {
        const companions = selectArcadeCompanions(players);
        this._container.style.display = companions.length > 0 ? 'flex' : 'none';
        for (let index = 0; index < this._rows.length; index += 1) {
            const entry = this._rows[index];
            const companion = companions[index] || null;
            if (!companion) {
                if (entry.shown) { entry.row.style.display = 'none'; entry.shown = false; }
                continue;
            }
            if (!entry.shown) { entry.row.style.display = 'flex'; entry.shown = true; }
            const percent = healthPercent(companion);
            if (percent === entry.percent) continue;
            entry.percent = percent;
            entry.fill.style.width = `${percent}%`;
            entry.status.textContent = companion.alive === false ? 'ausgeschaltet' : `${percent}%`;
        }
    }

    hide() {
        this._container.style.display = 'none';
    }

    dispose() {
        this._container.remove?.();
        this._rows.length = 0;
    }
}
