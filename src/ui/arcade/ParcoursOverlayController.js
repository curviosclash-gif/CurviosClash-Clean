import { ParcoursMinimapRenderer } from './ParcoursMinimapRenderer.js';

export function collectUnseenParcoursHudEvents(hudState, type, lastSequence = 0) {
    const source = Array.isArray(hudState?.events) ? hudState.events : [];
    const events = [];
    let nextSequence = Math.max(0, Number(lastSequence) || 0);
    for (let i = 0; i < source.length; i += 1) {
        const event = source[i];
        const sequence = Math.max(0, Number(event?.sequence) || 0);
        if (event?.type !== type || sequence <= nextSequence) continue;
        events.push(event);
        nextSequence = sequence;
    }
    if (events.length === 0 && nextSequence === 0) {
        const legacyEvent = type === 'parcours_xp'
            ? hudState?.parcoursXpGain
            : (type === 'parcours_split'
                ? hudState?.parcoursSegmentSplit
                : (type === 'parcours_penalty' ? hudState?.parcoursPenalty : null));
        if (legacyEvent) {
            events.push(legacyEvent);
            nextSequence = 1;
        }
    }
    return { events, lastSequence: nextSequence };
}

export class ParcoursOverlayController {
    constructor() {
        this._xpNotificationOverlay = null;
        this._xpNotificationHideAtMs = 0;
        this._splitDeltaOverlay = null;
        this._splitDeltaHideAtMs = 0;
        this._penaltyOverlay = null;
        this._penaltyHideAtMs = 0;
        this._statsFlashOverlay = null;
        this._statsFlashHideAtMs = 0;
        this._minimap = null;
        this._lastXpSequence = 0;
        this._lastSplitSequence = 0;
        this._lastPenaltySequence = 0;
    }

    _ensureOverlay(id, className) {
        if (!document?.body) return null;
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.className = className || '';
            document.body.appendChild(el);
        }
        return el;
    }

    tickXp(hudState, nowMs) {
        if (!document?.body) return;
        const pending = collectUnseenParcoursHudEvents(hudState, 'parcours_xp', this._lastXpSequence);
        this._lastXpSequence = pending.lastSequence;
        for (const parcoursXpGain of pending.events) {
            if (!(parcoursXpGain?.earned > 0)) continue;
            const levelUp = parcoursXpGain.leveledUp
                ? ` ↑ Lv ${parcoursXpGain.newLevel}!`
                : '';
            const text = `+${parcoursXpGain.earned} XP${levelUp}`;
            const el = this._ensureOverlay('parcours-xp-notification', 'hidden');
            if (el) {
                el.textContent = text;
                el.classList.remove('hidden');
                this._xpNotificationOverlay = el;
                this._xpNotificationHideAtMs = Math.max(0, nowMs) + 1500;
            }
        }
        if (this._xpNotificationOverlay && nowMs >= this._xpNotificationHideAtMs) {
            this._xpNotificationOverlay.classList.add('hidden');
        }
    }

    tickSplitDelta(hudState, nowMs) {
        if (!document?.body) return;
        const pending = collectUnseenParcoursHudEvents(hudState, 'parcours_split', this._lastSplitSequence);
        this._lastSplitSequence = pending.lastSequence;
        for (const parcoursSegmentSplit of pending.events) {
            const { deltaMs, isBetter } = parcoursSegmentSplit;
            if (!this._splitDeltaOverlay) {
                this._splitDeltaOverlay = this._ensureOverlay('parcours-split-delta', 'hidden');
            }
            if (this._splitDeltaOverlay) {
                this._splitDeltaOverlay.textContent = `${isBetter ? '-' : '+'}${(Math.abs(deltaMs) / 1000).toFixed(2)}s`;
                this._splitDeltaOverlay.classList.remove('hidden', 'split-better', 'split-worse');
                this._splitDeltaOverlay.classList.add(isBetter ? 'split-better' : 'split-worse');
                this._splitDeltaHideAtMs = nowMs + 1200;
            }
        }
        if (this._splitDeltaOverlay && nowMs >= this._splitDeltaHideAtMs) {
            this._splitDeltaOverlay.classList.add('hidden');
        }
    }

    tickPenalty(hudState, nowMs) {
        if (!document?.body) return;
        const pending = collectUnseenParcoursHudEvents(hudState, 'parcours_penalty', this._lastPenaltySequence);
        this._lastPenaltySequence = pending.lastSequence;
        for (const penalty of pending.events) {
            if (!(penalty?.penaltyMs > 0)) continue;
            if (!this._penaltyOverlay) {
                this._penaltyOverlay = this._ensureOverlay(
                    'parcours-penalty-notification',
                    'parcours-penalty-notification hidden'
                );
            }
            if (this._penaltyOverlay) {
                const seconds = (Math.max(0, Number(penalty.penaltyMs) || 0) / 1000).toFixed(1);
                this._penaltyOverlay.textContent = `+${seconds}s PENALTY`;
                this._penaltyOverlay.classList.remove('hidden');
                this._penaltyHideAtMs = Math.max(0, nowMs) + 1400;
            }
        }
        if (this._penaltyOverlay && nowMs >= this._penaltyHideAtMs) {
            this._penaltyOverlay.classList.add('hidden');
        }
    }

    // 82.8.3: Show effective stats banner for 2500ms at sector start
    tickStatsFlash(hudState, nowMs, sectorChanged) {
        if (!document?.body) return;
        const stats = hudState?.vehicleStats;
        if (sectorChanged && stats && stats.level > 1) {
            const parts = [`Lv ${stats.level}`];
            if (stats.speedBonusPct > 0) parts.push(`Speed +${stats.speedBonusPct}%`);
            if (stats.turningBonusPct > 0) parts.push(`Kurve +${stats.turningBonusPct}%`);
            if (stats.maxHpBonus > 0) parts.push(`HP +${stats.maxHpBonus}`);
            const el = this._ensureOverlay('arcade-stats-flash', 'arcade-stats-flash hidden');
            if (el) {
                el.textContent = parts.join('  |  ');
                el.classList.remove('hidden');
                this._statsFlashOverlay = el;
                this._statsFlashHideAtMs = Math.max(0, nowMs) + 2500;
            }
        }
        if (this._statsFlashOverlay && nowMs >= this._statsFlashHideAtMs) {
            this._statsFlashOverlay.classList.add('hidden');
        }
    }

    tickMinimap(entityManager, projection, localIdx) {
        const parcoursEnabled = projection?.parcours?.enabled === true;
        if (!parcoursEnabled) {
            this._minimap?._hide?.();
            return;
        }
        if (!this._minimap) this._minimap = new ParcoursMinimapRenderer();
        const routeSnapshot = entityManager?.getParcoursRouteSnapshot?.() || null;
        const nextCheckpointIndex = Math.max(0, Number(projection.parcours.currentCheckpoint) || 0);
        const passedCheckpointIds = Array.isArray(projection?.parcours?.passedCheckpointIds)
            ? projection.parcours.passedCheckpointIds
            : (entityManager?.getParcoursHudState?.(localIdx)?.passedCheckpointIds || []);
        const localPlayer = Array.isArray(projection?.players)
            ? projection.players.find((p) => p?.playerIndex === localIdx) || null
            : null;
        this._minimap.update(
            routeSnapshot,
            nextCheckpointIndex,
            passedCheckpointIds,
            localPlayer?.position || null,
            localPlayer?.quaternion || null
        );
    }

    hideMinimap() {
        this._minimap?._hide?.();
    }

    dispose() {
        if (this._xpNotificationOverlay?.parentElement) {
            this._xpNotificationOverlay.parentElement.removeChild(this._xpNotificationOverlay);
        }
        this._xpNotificationOverlay = null;
        if (this._splitDeltaOverlay?.parentElement) {
            this._splitDeltaOverlay.parentElement.removeChild(this._splitDeltaOverlay);
        }
        this._splitDeltaOverlay = null;
        if (this._penaltyOverlay?.parentElement) {
            this._penaltyOverlay.parentElement.removeChild(this._penaltyOverlay);
        }
        this._penaltyOverlay = null;
        if (this._statsFlashOverlay?.parentElement) {
            this._statsFlashOverlay.parentElement.removeChild(this._statsFlashOverlay);
        }
        this._statsFlashOverlay = null;
        this._minimap?.dispose?.();
        this._minimap = null;
        this._lastXpSequence = 0;
        this._lastSplitSequence = 0;
        this._lastPenaltySequence = 0;
    }
}
