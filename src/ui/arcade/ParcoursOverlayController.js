import { ParcoursMinimapRenderer } from './ParcoursMinimapRenderer.js';
import * as THREE from 'three';

const EDGE_INSET_PX = 16;

export function resolveGuidanceEdgeNdc(projectedX, projectedY, inFront, output = { x: 0, y: 0 }) {
    let x = inFront ? projectedX : -projectedX;
    let y = inFront ? projectedY : -projectedY;
    const magnitude = Math.max(Math.abs(x), Math.abs(y));
    if (magnitude < 0.0001) {
        output.x = 1;
        output.y = 0;
        return output;
    }
    x /= magnitude;
    y /= magnitude;
    output.x = x;
    output.y = y;
    return output;
}

function colorToCss(color) {
    return `#${Math.max(0, Math.min(0xffffff, Number(color) || 0)).toString(16).padStart(6, '0')}`;
}

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
        this._guidanceEdges = new Map();
        this._guidanceProjector = new THREE.Vector3();
        this._guidanceDirection = new THREE.Vector3();
        this._guidanceEdgeNdc = { x: 0, y: 0 };
        this._guidanceViewports = Array.from({ length: 4 }, () => ({ x: 0, y: 0, width: 0, height: 0, camera: null }));
        this._guidanceViewportCount = 0;
        this._guidanceTick = 0;
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
            this._hideGuidanceEdges();
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
        this._tickGuidanceEdges(entityManager);
    }

    _getGuidanceView(entityManager) {
        return entityManager?.arena?._portalGateSystem?.checkpointRingRuntime?.getGuidanceView?.() || null;
    }

    _getGuidanceViewports(renderer) {
        const system = renderer?.viewportSystem;
        const width = Math.max(1, Number(system?.width) || window.innerWidth || 1);
        const height = Math.max(1, Number(system?.height) || window.innerHeight || 1);
        const cameras = Array.isArray(renderer?.cameras) ? renderer.cameras : [];
        if (system?.networkEnabled === true) {
            const index = Math.max(0, Math.min(Number(system.localPlayerIndex) || 0, cameras.length - 1));
            this._guidanceViewportCount = cameras[index] ? 1 : 0;
            if (this._guidanceViewportCount) this._setGuidanceViewport(0, 0, 0, width, height, cameras[index]);
            return;
        }
        if (system?.layout === 'four_grid' && cameras.length >= 4) {
            const left = Math.floor(width / 2);
            const bottomHeight = Math.floor(height / 2);
            const topHeight = height - bottomHeight;
            this._guidanceViewportCount = 4;
            this._setGuidanceViewport(0, 0, 0, left, topHeight, cameras[0]);
            this._setGuidanceViewport(1, left, 0, width - left, topHeight, cameras[1]);
            this._setGuidanceViewport(2, 0, topHeight, left, bottomHeight, cameras[2]);
            this._setGuidanceViewport(3, left, topHeight, width - left, bottomHeight, cameras[3]);
            return;
        }
        if (system?.layout === 'three_columns' && cameras.length >= 3) {
            const column = Math.floor(width / 3);
            this._guidanceViewportCount = 3;
            this._setGuidanceViewport(0, 0, 0, column, height, cameras[0]); this._setGuidanceViewport(1, column, 0, column, height, cameras[1]); this._setGuidanceViewport(2, column * 2, 0, width - column * 2, height, cameras[2]);
            return;
        }
        if (system?.layout === 'two_columns' && cameras.length >= 2) {
            const left = Math.floor(width / 2);
            this._guidanceViewportCount = 2;
            this._setGuidanceViewport(0, 0, 0, left, height, cameras[0]); this._setGuidanceViewport(1, left, 0, width - left, height, cameras[1]);
            return;
        }
        this._guidanceViewportCount = cameras[0] ? 1 : 0;
        if (this._guidanceViewportCount) this._setGuidanceViewport(0, 0, 0, width, height, cameras[0]);
    }

    _setGuidanceViewport(index, x, y, width, height, camera) {
        const viewport = this._guidanceViewports[index];
        viewport.x = x;
        viewport.y = y;
        viewport.width = width;
        viewport.height = height;
        viewport.camera = camera || null;
    }

    _ensureGuidanceEdge(key) {
        let el = this._guidanceEdges.get(key);
        if (el || !document?.body) return el || null;
        el = document.createElement('div');
        el.setAttribute('aria-hidden', 'true');
        Object.assign(el.style, {
            position: 'fixed', width: '30px', height: '30px', marginLeft: '-15px', marginTop: '-15px',
            borderRadius: '50%', pointerEvents: 'none', zIndex: '12',
            background: 'radial-gradient(circle, rgba(255,255,255,.28) 0%, rgba(120,220,255,.12) 35%, rgba(120,220,255,0) 72%)',
            boxShadow: '0 0 16px 6px rgba(120,220,255,.18)',
            transition: 'opacity 120ms linear, left 120ms linear, top 120ms linear',
        });
        document.body.appendChild(el);
        this._guidanceEdges.set(key, el);
        return el;
    }

    _hideGuidanceEdges() {
        for (const el of this._guidanceEdges.values()) el.style.display = 'none';
    }

    _tickGuidanceEdges(entityManager) {
        const view = this._getGuidanceView(entityManager);
        if (!view?.active || !(view.intensity > 0) || !Array.isArray(view.targets)) {
            this._hideGuidanceEdges();
            return;
        }
        this._getGuidanceViewports(entityManager?.renderer);
        if (this._guidanceViewportCount === 0) {
            this._hideGuidanceEdges();
            return;
        }
        this._guidanceTick += 1;
        const tick = this._guidanceTick;
        const edgeOpacity = Math.min(0.30, Math.max(0, Number(view.intensity) || 0) * 0.15);
        for (let viewportIndex = 0; viewportIndex < this._guidanceViewportCount; viewportIndex += 1) {
            const viewport = this._guidanceViewports[viewportIndex];
            const { x, y, width, height, camera } = viewport;
            if (!camera?.position) continue;
            for (let targetIndex = 0; targetIndex < view.targets.length; targetIndex += 1) {
                const target = view.targets[targetIndex];
                if (!target?.pos) continue;
                const key = `${viewportIndex}:${target.checkpointId || 'finish'}`;
                const el = this._ensureGuidanceEdge(key);
                if (!el) continue;
                this._guidanceDirection.set(target.pos.x, target.pos.y, target.pos.z).sub(camera.position);
                const inFront = this._guidanceDirection.dot(camera.getWorldDirection(this._guidanceProjector)) > 0;
                this._guidanceProjector.set(target.pos.x, target.pos.y, target.pos.z).project(camera);
                const onScreen = inFront
                    && this._guidanceProjector.x >= -1 && this._guidanceProjector.x <= 1
                    && this._guidanceProjector.y >= -1 && this._guidanceProjector.y <= 1
                    && this._guidanceProjector.z >= -1 && this._guidanceProjector.z <= 1;
                if (onScreen) {
                    el.style.display = 'none';
                    continue;
                }
                const edge = resolveGuidanceEdgeNdc(this._guidanceProjector.x, this._guidanceProjector.y, inFront, this._guidanceEdgeNdc);
                const px = x + EDGE_INSET_PX + (edge.x + 1) * 0.5 * Math.max(0, width - EDGE_INSET_PX * 2);
                const py = y + EDGE_INSET_PX + (1 - edge.y) * 0.5 * Math.max(0, height - EDGE_INSET_PX * 2);
                el.style.display = 'block';
                el.style.left = `${px}px`;
                el.style.top = `${py}px`;
                el.style.opacity = String(edgeOpacity);
                const color = colorToCss(target.mesh?.userData?.checkpointColor);
                el.style.background = `radial-gradient(circle, ${color}55 0%, ${color}2e 35%, ${color}00 72%)`;
                el.style.boxShadow = `0 0 16px 6px ${color}3d`;
                el._guidanceTick = tick;
            }
        }
        for (const el of this._guidanceEdges.values()) {
            if (el._guidanceTick !== tick) el.style.display = 'none';
        }
    }

    hideMinimap() {
        this._minimap?._hide?.();
        this._hideGuidanceEdges();
    }

    /** The flashes only hide on the next HUD tick, and the menu never ticks the HUD. */
    hideFlashes() {
        for (const el of [this._xpNotificationOverlay, this._splitDeltaOverlay, this._penaltyOverlay, this._statsFlashOverlay]) {
            el?.classList?.add?.('hidden');
        }
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
        for (const el of this._guidanceEdges.values()) {
            if (el.parentElement) el.parentElement.removeChild(el);
        }
        this._guidanceEdges.clear();
        this._lastXpSequence = 0;
        this._lastSplitSequence = 0;
        this._lastPenaltySequence = 0;
    }
}
