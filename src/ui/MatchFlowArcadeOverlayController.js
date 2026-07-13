import { clearMessageStats, renderMessageStats } from './dom/MessageStatsDom.js';
import {
    getArcadeMenuSurfaceState,
    requestArcadeReplayPlayback,
    selectArcadeIntermissionChoice,
    selectArcadeReward,
} from './MatchFlowTransitionHotspots.js';
import {
    GAME_STATE_IDS,
    normalizeGameStateId,
} from '../shared/contracts/GameStateIds.js';

function toSafeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function formatPercent(value) {
    return `${Math.round(Math.max(0, Math.min(1, toSafeNumber(value, 0))) * 100)}%`;
}

export class MatchFlowArcadeOverlayController {
    constructor(deps = {}) {
        this.matchFlowUiController = deps.matchFlowUiController || null;
        this.runtime = deps.runtime || deps.game || this.matchFlowUiController?.game || null;
        this.runtimePort = deps.runtimePort || this.matchFlowUiController?.runtimePort || null;
        this._arcadeOverlayPanel = null;
        this._arcadeXpAnimFrame = 0;
        this._arcadeXpAnimToken = 0;
    }

    get game() {
        return this.runtime;
    }

    _resolveMessageStatsContainer() {
        return this.game?.ui?.messageStats || null;
    }

    clearMessageStatsUi() {
        clearMessageStats(this._resolveMessageStatsContainer());
    }

    renderMessageStatsUi(overlayStats) {
        renderMessageStats(this._resolveMessageStatsContainer(), overlayStats);
    }

    _cancelArcadeXpAnimation() {
        this._arcadeXpAnimToken += 1;
        if (this._arcadeXpAnimFrame) {
            cancelAnimationFrame(this._arcadeXpAnimFrame);
            this._arcadeXpAnimFrame = 0;
        }
    }

    _ensureArcadeOverlayPanel() {
        const overlay = this.game?.ui?.messageOverlay || null;
        if (!overlay) return null;
        if (this._arcadeOverlayPanel && this._arcadeOverlayPanel.parentElement === overlay) {
            return this._arcadeOverlayPanel;
        }
        const panel = document.createElement('section');
        panel.id = 'arcade-overlay-panel';
        panel.className = 'arcade-overlay-panel hidden';
        overlay.appendChild(panel);
        this._arcadeOverlayPanel = panel;
        return panel;
    }

    clearArcadeOverlayPanel() {
        this._cancelArcadeXpAnimation();
        const panel = this._arcadeOverlayPanel;
        if (!panel) return;
        panel.classList.add('hidden');
        while (panel.firstChild) {
            panel.removeChild(panel.firstChild);
        }
    }

    _animateArcadeXpCounter(node, toValue, durationMs = 900) {
        if (!node) return;
        this._cancelArcadeXpAnimation();
        const token = this._arcadeXpAnimToken;
        const target = Math.max(0, Math.round(toSafeNumber(toValue, 0)));
        const duration = Math.max(180, Math.round(toSafeNumber(durationMs, 900)));
        const start = performance.now();
        const step = (now) => {
            if (token !== this._arcadeXpAnimToken) return;
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - ((1 - progress) * (1 - progress));
            node.textContent = `${Math.round(target * eased)} XP`;
            if (progress < 1) {
                this._arcadeXpAnimFrame = requestAnimationFrame(step);
            } else {
                this._arcadeXpAnimFrame = 0;
            }
        };
        this._arcadeXpAnimFrame = requestAnimationFrame(step);
    }

    _renderArcadeIntermissionPanel(runtimeState) {
        const panel = this._ensureArcadeOverlayPanel();
        const intermission = runtimeState?.intermission;
        if (!panel || !intermission || typeof intermission !== 'object') return false;

        // Clear panel securely
        while (panel.firstChild) {
            panel.removeChild(panel.firstChild);
        }

        const choices = Array.isArray(intermission.choices) ? intermission.choices : [];
        const rewards = Array.isArray(intermission.rewardChoices) ? intermission.rewardChoices : [];
        const nextSectorIndex = Math.max(1, Math.floor(toSafeNumber(intermission.nextSectorIndex, 1)));
        const lastSectorPoints = Math.max(0, Math.round(toSafeNumber(intermission.lastSectorPoints, 0)));
        const lastSectorXp = Math.max(0, Math.round(toSafeNumber(intermission.lastSectorXp, 0)));
        const missionsCompleted = Math.max(0, Math.floor(toSafeNumber(intermission.missionsCompleted, 0)));
        const missionsTotal = Math.max(0, Math.floor(toSafeNumber(intermission.missionsTotal, 0)));
        const preview = intermission.nextSectorPreview && typeof intermission.nextSectorPreview === 'object'
            ? intermission.nextSectorPreview
            : {};

        const header = document.createElement('header');
        header.className = 'arcade-overlay-header';

        const h3 = document.createElement('h3');
        h3.textContent = `Intermission Sektor ${nextSectorIndex}`;
        header.appendChild(h3);

        const headerP = document.createElement('p');
        headerP.textContent = `Letzter Sektor: ${lastSectorPoints} Punkte | ${lastSectorXp} XP | Missionen ${missionsCompleted}/${missionsTotal}`;
        header.appendChild(headerP);
        panel.appendChild(header);

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'arcade-overlay-body';

        // Section 1: Naechster Sektor
        const sect1 = document.createElement('section');
        sect1.className = 'arcade-overlay-section';
        const s1h4 = document.createElement('h4');
        s1h4.textContent = 'Naechster Sektor';
        sect1.appendChild(s1h4);

        const s1p1 = document.createElement('p');
        s1p1.textContent = `${String(preview.mapLabel || preview.mapKey || 'Unbekannte Map')} | ${String(preview.modifierLabel || 'Kein Modifier')}`;
        sect1.appendChild(s1p1);

        const s1p2 = document.createElement('p');
        s1p2.textContent = String(preview.modifierEffect || '').trim() || 'Keine zusaetzliche Wirkung.';
        sect1.appendChild(s1p2);
        bodyDiv.appendChild(sect1);

        // Section 2: Map-/Modifier-Wahl
        const sect2 = document.createElement('section');
        sect2.className = 'arcade-overlay-section';
        const s2h4 = document.createElement('h4');
        s2h4.textContent = 'Map-/Modifier-Wahl';
        sect2.appendChild(s2h4);

        const choiceGrid = document.createElement('div');
        choiceGrid.className = 'arcade-overlay-choice-grid';
        if (choices.length === 0) {
            const emptyP = document.createElement('p');
            emptyP.className = 'arcade-overlay-empty';
            emptyP.textContent = 'Keine Optionen verfuegbar.';
            choiceGrid.appendChild(emptyP);
        } else {
            choices.forEach((entry) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const active = entry?.id === intermission.selectedChoiceId;
                btn.className = `arcade-overlay-choice-btn${active ? ' is-active' : ''}`;
                const choiceId = String(entry?.id || '');
                btn.setAttribute('data-arcade-choice-id', choiceId);

                const strong = document.createElement('strong');
                strong.textContent = String(entry?.mapLabel || entry?.mapKey || 'Unbekannte Map');
                btn.appendChild(strong);

                const span = document.createElement('span');
                span.textContent = String(entry?.modifierLabel || 'Kein Modifier');
                btn.appendChild(span);

                const small = document.createElement('small');
                small.textContent = String(entry?.modifierEffect || '').trim() || 'Standardsektor';
                btn.appendChild(small);

                btn.addEventListener('click', () => {
                    if (!choiceId) return;
                    selectArcadeIntermissionChoice(this.runtimePort, this.game, choiceId);
                    const nextState = getArcadeMenuSurfaceState(this.runtimePort, this.game);
                    this._renderArcadeIntermissionPanel(nextState);
                });

                choiceGrid.appendChild(btn);
            });
        }
        sect2.appendChild(choiceGrid);
        bodyDiv.appendChild(sect2);

        // Section 3: Reward-Auswahl
        const sect3 = document.createElement('section');
        sect3.className = 'arcade-overlay-section';
        const s3h4 = document.createElement('h4');
        s3h4.textContent = 'Reward-Auswahl';
        sect3.appendChild(s3h4);

        const rewardGrid = document.createElement('div');
        rewardGrid.className = 'arcade-overlay-reward-grid';
        if (rewards.length === 0) {
            const emptyP = document.createElement('p');
            emptyP.className = 'arcade-overlay-empty';
            emptyP.textContent = 'Keine Rewards verfuegbar.';
            rewardGrid.appendChild(emptyP);
        } else {
            rewards.forEach((entry) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const active = entry?.id === intermission.selectedRewardId;
                btn.className = `arcade-overlay-reward-btn${active ? ' is-active' : ''}`;
                const rewardId = String(entry?.id || '');
                btn.setAttribute('data-arcade-reward-id', rewardId);

                const strong = document.createElement('strong');
                strong.textContent = String(entry?.label || entry?.id || '');
                btn.appendChild(strong);

                const small = document.createElement('small');
                small.textContent = String(entry?.effectText || '').trim() || 'Kein Effekttext';
                btn.appendChild(small);

                btn.addEventListener('click', () => {
                    if (!rewardId) return;
                    selectArcadeReward(this.runtimePort, this.game, rewardId);
                    const nextState = getArcadeMenuSurfaceState(this.runtimePort, this.game);
                    this._renderArcadeIntermissionPanel(nextState);
                });

                rewardGrid.appendChild(btn);
            });
        }
        sect3.appendChild(rewardGrid);
        bodyDiv.appendChild(sect3);

        panel.appendChild(bodyDiv);
        panel.classList.remove('hidden');
        return true;
    }

    _renderArcadePostRunPanel(runtimeState) {
        const panel = this._ensureArcadeOverlayPanel();
        const summary = runtimeState?.postRunSummary;
        if (!panel || !summary || typeof summary !== 'object') return false;

        // Clear panel securely
        while (panel.firstChild) {
            panel.removeChild(panel.firstChild);
        }

        const score = Math.max(0, Math.round(toSafeNumber(summary.score, 0)));
        const bestCombo = Math.max(0, Math.floor(toSafeNumber(summary.bestCombo, 0)));
        const missionRate = formatPercent(summary.missionCompletionRate);
        const xpEarned = Math.max(0, Math.round(toSafeNumber(summary.xpEarned, 0)));

        const replay = runtimeState?.replay && typeof runtimeState.replay === 'object' ? runtimeState.replay : {};
        const replayHintText = replay.playbackAvailable
            ? 'Replay verfuegbar'
            : (replay.payloadAvailable ? 'Replay als Export-Fallback verfuegbar' : 'Replay nicht verfuegbar');

        const header = document.createElement('header');
        header.className = 'arcade-overlay-header';
        
        const h3 = document.createElement('h3');
        h3.textContent = 'Arcade Run abgeschlossen';
        header.appendChild(h3);
        
        const headerP = document.createElement('p');
        headerP.textContent = `Gesamtscore ${score} | Best Combo ${bestCombo} | Mission-Rate ${missionRate}`;
        header.appendChild(headerP);
        panel.appendChild(header);

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'arcade-overlay-body';

        // Section 1: Score pro Sektor
        const sect1 = document.createElement('section');
        sect1.className = 'arcade-overlay-section';
        const s1h4 = document.createElement('h4');
        s1h4.textContent = 'Score pro Sektor';
        sect1.appendChild(s1h4);
        
        const ul = document.createElement('ul');
        ul.className = 'arcade-overlay-list';
        if (Array.isArray(summary.scorePerSector) && summary.scorePerSector.length > 0) {
            summary.scorePerSector.slice(0, 8).forEach((entry) => {
                const li = document.createElement('li');
                const sectorIdx = Math.max(0, Math.floor(toSafeNumber(entry?.sectorIndex, 0)));
                const mapKey = String(entry?.mapKey || '-');
                const awarded = Math.max(0, Math.round(toSafeNumber(entry?.awardedPoints, 0)));
                li.textContent = `S${sectorIdx} | ${mapKey} | ${awarded} Punkte`;
                ul.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = 'Keine Sektordaten.';
            ul.appendChild(li);
        }
        sect1.appendChild(ul);
        bodyDiv.appendChild(sect1);

        // Section 2: XP
        const sect2 = document.createElement('section');
        sect2.className = 'arcade-overlay-section';
        const s2h4 = document.createElement('h4');
        s2h4.textContent = 'XP';
        sect2.appendChild(s2h4);
        
        const xpP = document.createElement('p');
        xpP.id = 'arcade-overlay-xp-counter';
        xpP.textContent = '0 XP';
        sect2.appendChild(xpP);
        
        const multiP = document.createElement('p');
        multiP.textContent = `${Math.max(1, Math.round(toSafeNumber(summary.peakMultiplier, 1) * 10) / 10)}x Peak-Multi`;
        sect2.appendChild(multiP);
        bodyDiv.appendChild(sect2);

        // Section 3: Replay
        const sect3 = document.createElement('section');
        sect3.className = 'arcade-overlay-section';
        const s3h4 = document.createElement('h4');
        s3h4.textContent = 'Replay';
        sect3.appendChild(s3h4);
        
        const replayP = document.createElement('p');
        replayP.textContent = replayHintText;
        sect3.appendChild(replayP);
        
        const replayBtn = document.createElement('button');
        replayBtn.type = 'button';
        replayBtn.className = 'arcade-overlay-action-btn';
        replayBtn.id = 'btn-arcade-overlay-replay';
        replayBtn.textContent = 'Replay/Fallback';
        
        replayBtn.addEventListener('click', () => {
            const result = requestArcadeReplayPlayback(this.runtimePort, this.game);
            const code = String(result?.code || 'replay_unknown');
            const tone = code === 'replay_player_unavailable' ? 'warning' : 'info';
            const message = code === 'ghost_fallback_started'
                ? 'Ghost-Fallback wird abgespielt.'
                : (code === 'replay_player_unavailable'
                ? 'Replay-Player fehlt, Export-Fallback bereit.'
                : (code === 'replay_disabled'
                    ? 'Replay ist in den Runtime-Einstellungen deaktiviert.'
                    : (code === 'replay_unavailable'
                        ? 'Kein Replay fuer diesen Run verfuegbar.'
                        : 'Replay-Status aktualisiert.')));
            this.game?._showStatusToast?.(message, 1800, tone);
        });
        
        sect3.appendChild(replayBtn);
        bodyDiv.appendChild(sect3);

        panel.appendChild(bodyDiv);
        panel.classList.remove('hidden');

        const xpCounter = panel.querySelector('#arcade-overlay-xp-counter');
        this._animateArcadeXpCounter(
            xpCounter,
            xpEarned,
            Math.max(260, Math.round(toSafeNumber(summary?.xpAnimation?.durationMs, 900)))
        );

        return true;
    }

    syncArcadeOverlayPanel() {
        const game = this.game;
        const runtimeProjection = this.runtimePort?.getMatchRuntimeProjection?.() || null;
        const arcadeActive = String(runtimeProjection?.modeId || '').toUpperCase() === 'ARCADE';
        const overlayVisible = !!game?.ui?.messageOverlay && !game.ui.messageOverlay.classList.contains('hidden');
        if (!arcadeActive || !overlayVisible) {
            this.clearArcadeOverlayPanel();
            return;
        }
        const runtimeState = getArcadeMenuSurfaceState(this.runtimePort, this.game);
        const state = normalizeGameStateId(game?.state, GAME_STATE_IDS.MENU);
        if (state === GAME_STATE_IDS.ROUND_END && this._renderArcadeIntermissionPanel(runtimeState)) {
            return;
        }
        if (state === GAME_STATE_IDS.MATCH_END && this._renderArcadePostRunPanel(runtimeState)) {
            return;
        }
        this.clearArcadeOverlayPanel();
    }

    dispose() {
        this.clearArcadeOverlayPanel();
        this._arcadeOverlayPanel?.remove?.();
        this._arcadeOverlayPanel = null;
    }
}
