import {
    ARCADE_RESULT_TEXTS,
    formatIntermissionTitle,
} from './arcade/ArcadeResultTexts.js';
import {
    createArcadeIntermissionBlocks,
    createArcadeNextSectorBlock,
    createArcadeRunBlocks,
    createArcadeSectorBlock,
    createArcadeVictoryBlocks,
} from './arcade/postrun/ArcadePostRunBlocks.js';
import { appendArcadeCards, createArcadeCardScroller } from './arcade/postrun/ArcadePostRunCards.js';
import { createArenaWavesMapBlocks, createFivePortalsBlocks } from './arcade/postrun/ArcadeRunTypeBlocks.js';
import { clearMessageStats, renderMessageStats } from './dom/MessageStatsDom.js';
import { resolveArenaWavesChoiceLabel } from '../shared/contracts/ArenaWavesContract.js';
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
        this.game?.ui?.messageOverlay?.classList?.remove?.('has-arcade-results');
        this._renderKey = null;
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

    _renderArcadeVictoryPanel(runtimeState) {
        if (runtimeState?.phase !== 'victory' || !runtimeState.victory) return false;
        const panel = this._ensureArcadeOverlayPanel();
        if (!panel) return false;
        panel.replaceChildren();
        const heading = document.createElement('h3');
        heading.textContent = 'Run geschafft!';
        panel.appendChild(heading);
        appendArcadeCards(panel, createArcadeVictoryBlocks(runtimeState.victory));
        for (const [choice, label] of [['finish', 'Run abschließen'], ['continue', 'In Sudden Death weiterspielen']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = `btn-arcade-victory-${choice}`;
            button.className = 'arcade-overlay-action-btn';
            button.textContent = label;
            button.addEventListener('click', () => {
                const transition = this.runtimePort?.resolveArcadeVictoryChoice?.(choice);
                if (!transition) return;
                this.runtimePort.applyRoundEndTransition?.(transition);
                this.matchFlowUiController?.applyMatchUiState({
                    messageText: choice === 'finish' ? 'Run abgeschlossen' : 'Sudden Death',
                    messageSub: choice === 'finish' ? 'ENTER für neuen Run oder ESC fürs Menü' : 'Wähle deinen nächsten Sektor',
                });
                this.syncArcadeOverlayPanel();
            });
            panel.appendChild(button);
        }
        panel.classList.remove('hidden');
        panel.querySelector('button')?.focus();
        return true;
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
        h3.textContent = formatIntermissionTitle(nextSectorIndex);
        header.appendChild(h3);

        appendArcadeCards(header, createArcadeIntermissionBlocks({
            ...intermission,
            lastSectorPoints,
            lastSectorXp,
            missionsCompleted,
            missionsTotal,
        }));
        if (missionsCompleted < missionsTotal) {
            const missed = document.createElement('p');
            missed.textContent = 'Bonus für alle Missionen verpasst.';
            header.appendChild(missed);
        }
        panel.appendChild(header);

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'arcade-overlay-body';

        // Section 1: next sector
        const sect1 = document.createElement('section');
        sect1.className = 'arcade-overlay-section';
        const s1h4 = document.createElement('h4');
        s1h4.textContent = ARCADE_RESULT_TEXTS.nextSectorHeading;
        sect1.appendChild(s1h4);
        appendArcadeCards(sect1, [createArcadeNextSectorBlock(preview)]);
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
            emptyP.textContent = ARCADE_RESULT_TEXTS.emptyChoices;
            choiceGrid.appendChild(emptyP);
        } else {
            choices.forEach((entry) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const active = entry?.id === intermission.selectedChoiceId;
                btn.className = `arcade-overlay-choice-btn${active ? ' is-active' : ''}`;
                const choiceId = String(entry?.id || '');
                btn.setAttribute('data-arcade-choice-id', choiceId);
                btn.id = `arcade-choice-${choiceId}`;
                btn.setAttribute('aria-pressed', String(active));

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
                    this.syncArcadeOverlayPanel();
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
        s3h4.textContent = 'Belohnung auswählen';
        sect3.appendChild(s3h4);

        const rewardGrid = document.createElement('div');
        rewardGrid.className = 'arcade-overlay-reward-grid';
        if (rewards.length === 0) {
            const emptyP = document.createElement('p');
            emptyP.className = 'arcade-overlay-empty';
            emptyP.textContent = ARCADE_RESULT_TEXTS.emptyRewards;
            rewardGrid.appendChild(emptyP);
        } else {
            rewards.forEach((entry) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const active = entry?.id === intermission.selectedRewardId;
                btn.className = `arcade-overlay-reward-btn${active ? ' is-active' : ''}`;
                const rewardId = String(entry?.id || '');
                btn.setAttribute('data-arcade-reward-id', rewardId);
                btn.id = `arcade-reward-${rewardId}`;
                btn.setAttribute('aria-pressed', String(active));

                const strong = document.createElement('strong');
                strong.textContent = String(entry?.label || entry?.id || '');
                btn.appendChild(strong);

                const small = document.createElement('small');
                small.textContent = String(entry?.effectText || '').trim() || 'Kein Effekttext';
                btn.appendChild(small);

                btn.addEventListener('click', () => {
                    if (!rewardId) return;
                    selectArcadeReward(this.runtimePort, this.game, rewardId);
                    this.syncArcadeOverlayPanel();
                });

                rewardGrid.appendChild(btn);
            });
        }
        sect3.appendChild(rewardGrid);
        bodyDiv.appendChild(sect3);

        const continueSection = document.createElement('section');
        continueSection.className = 'arcade-overlay-section arcade-overlay-continue';
        const continueHint = document.createElement('p');
        continueHint.textContent = runtimeState.intermissionPaused ? 'Countdown angehalten.' : `Automatischer Start in ${Math.max(0, Math.ceil(toSafeNumber(this.game?.roundPause, 10)))}s.`;
        continueSection.appendChild(continueHint);
        continueHint.id = 'arcade-intermission-countdown';
        const pauseButton = document.createElement('button');
        pauseButton.type = 'button';
        pauseButton.id = 'btn-arcade-intermission-pause';
        pauseButton.className = 'arcade-overlay-action-btn';
        pauseButton.textContent = runtimeState.intermissionPaused ? 'Countdown fortsetzen' : 'Countdown anhalten';
        pauseButton.setAttribute('aria-pressed', String(runtimeState.intermissionPaused === true));
        pauseButton.addEventListener('click', () => {
            this.runtimePort?.setArcadeIntermissionPaused?.(!runtimeState.intermissionPaused);
            this.syncArcadeOverlayPanel();
        });
        continueSection.appendChild(pauseButton);
        const continueButton = document.createElement('button');
        continueButton.type = 'button';
        continueButton.id = 'btn-arcade-intermission-continue';
        continueButton.className = 'arcade-overlay-action-btn';
        continueButton.textContent = ARCADE_RESULT_TEXTS.confirmSelection;
        continueButton.addEventListener('click', () => {
            continueButton.disabled = true;
            this.runtimePort?.setArcadeIntermissionPaused?.(false);
            this.runtimePort?.setRoundPause?.(0);
        });
        continueSection.appendChild(continueButton);
        bodyDiv.appendChild(continueSection);

        panel.appendChild(bodyDiv);
        panel.classList.remove('hidden');
        return true;
    }

    _renderArenaWavesUpgradePanel(runtimeState) {
        if (runtimeState?.runType !== 'arena_waves' || runtimeState?.phase !== 'upgrade') return false;
        const panel = this._ensureArcadeOverlayPanel();
        if (!panel) return false;
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        const title = document.createElement('h2');
        title.textContent = 'Fünf Fronten – Vorteil wählen';
        const copy = document.createElement('p');
        copy.textContent = 'Wähle einen dauerhaften Vorteil. Enter aktiviert die fokussierte Wahl.';
        const grid = document.createElement('div'); grid.className = 'arcade-overlay-choice-grid';
        for (const choiceId of runtimeState.choices || []) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'arcade-overlay-choice-btn';
            button.textContent = resolveArenaWavesChoiceLabel(choiceId);
            button.addEventListener('click', () => selectArcadeIntermissionChoice(this.runtimePort, this.game, choiceId));
            grid.appendChild(button);
        }
        panel.append(title, copy, grid); panel.classList.remove('hidden');
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
        const xpEarned = Math.max(0, Math.round(toSafeNumber(summary.xpEarned, 0)));
        const dailyResult = summary?.dailyResult && typeof summary.dailyResult === 'object'
            ? summary.dailyResult
            : null;

        const replay = runtimeState?.replay && typeof runtimeState.replay === 'object' ? runtimeState.replay : {};
        const replayHintText = replay.payloadAvailable ? 'Replay-Export verfügbar' : 'Replay nicht verfügbar';

        const header = document.createElement('header');
        header.className = 'arcade-overlay-header';
        
        const h3 = document.createElement('h3');
        h3.textContent = dailyResult ? (dailyResult.succeeded ? 'Daily geschafft' : 'Daily-Versuch beendet') : 'Arcade Run abgeschlossen';
        header.appendChild(h3);
        appendArcadeCards(header, createArcadeRunBlocks({
            ...summary,
            score,
            dailyResult: dailyResult
                ? { ...dailyResult, bestScore: toSafeNumber(dailyResult.bestScore, score) }
                : null,
        }));
        panel.appendChild(header);

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'arcade-overlay-body';

        // Section 1: points per sector
        const sect1 = document.createElement('section');
        sect1.className = 'arcade-overlay-section';
        const s1h4 = document.createElement('h4');
        s1h4.textContent = ARCADE_RESULT_TEXTS.sectorScoreHeading;
        sect1.appendChild(s1h4);
        
        sect1.appendChild(createArcadeCardScroller(
            [createArcadeSectorBlock(summary.scorePerSector)],
            ARCADE_RESULT_TEXTS.sectorScoreHeading,
            ARCADE_RESULT_TEXTS.emptySectors
        ));
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
        replayBtn.textContent = 'Replay exportieren';
        replayBtn.disabled = !replay.payloadAvailable;
        
        replayBtn.addEventListener('click', () => {
            const result = requestArcadeReplayPlayback(this.runtimePort, this.game);
            const code = String(result?.code || 'replay_unknown');
            if (code === 'replay_playback_started') {
                this.game?._showStatusToast?.('Replay der letzten Runde wird abgespielt.', 1800, 'info');
                return;
            }
            if (code === 'replay_export_ready') {
                const replayJson = typeof result?.replayJson === 'string' ? result.replayJson : '';
                const copyPromise = replayJson
                    && typeof navigator !== 'undefined'
                    && typeof navigator.clipboard?.writeText === 'function'
                    ? Promise.resolve(navigator.clipboard.writeText(replayJson)).then(() => true).catch(() => false)
                    : Promise.resolve(false);
                copyPromise.then((copied) => {
                    this.game?._showStatusToast?.(
                        copied ? 'Replay-JSON wurde in die Zwischenablage kopiert.' : 'Replay-JSON konnte nicht kopiert werden.',
                        1800,
                        copied ? 'info' : 'warning'
                    );
                });
                return;
            }
            const tone = code === 'replay_player_unavailable' ? 'warning' : 'info';
            const message = code === 'ghost_fallback_started'
                ? 'Ghost-Wiedergabe gestartet.'
                : (code === 'replay_player_unavailable'
                ? 'Replay-Export bereit.'
                : (code === 'replay_disabled'
                    ? 'Replay ist in den Runtime-Einstellungen deaktiviert.'
                    : (code === 'replay_unavailable'
                        ? ARCADE_RESULT_TEXTS.replayUnavailable
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

    _renderArenaWavesPostRunPanel(runtimeState) {
        const summary = runtimeState?.postRunSummary;
        if (runtimeState?.runType !== 'arena_waves' || !summary || !Array.isArray(summary.maps)) return false;
        const panel = this._ensureArcadeOverlayPanel(); if (!panel) return false;
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        const title = document.createElement('h2'); title.textContent = `Fünf Fronten abgeschlossen – ${Math.round(toSafeNumber(summary.total, 0))} Punkte`;
        const list = createArcadeCardScroller(createArenaWavesMapBlocks(summary), 'Karten', 'Keine Kartendaten.');
        const close = document.createElement('button'); close.type = 'button'; close.className = 'arcade-overlay-action-btn'; close.textContent = 'Schließen';
        close.addEventListener('click', () => { panel.classList.add('hidden'); this.game?.ui?.messageOverlay?.classList?.add?.('hidden'); });
        panel.append(title, list, close); panel.classList.remove('hidden'); close.focus({ preventScroll: true }); return true;
    }

    _renderFivePortalsPostRunPanel(runtimeState) {
        const summary = runtimeState?.postRunSummary;
        if (runtimeState?.runType !== 'five_portals' || !summary || !Array.isArray(summary.maps)) return false;
        const panel = this._ensureArcadeOverlayPanel(); if (!panel) return false;
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        const title = document.createElement('h2'); title.textContent = 'Fünf Portale abgeschlossen';
        const list = createArcadeCardScroller(createFivePortalsBlocks(summary), 'Zeiten', 'Keine Zeiten.');
        const close = document.createElement('button'); close.type = 'button'; close.className = 'arcade-overlay-action-btn'; close.textContent = 'Schließen';
        close.addEventListener('click', () => { panel.classList.add('hidden'); this.game?.ui?.messageOverlay?.classList?.add?.('hidden'); });
        panel.append(title, list, close); panel.classList.remove('hidden'); close.focus({ preventScroll: true }); return true;
    }

    syncArcadeOverlayPanel() {
        const game = this.game;
        const runtimeProjection = this.runtimePort?.getMatchRuntimeProjection?.() || null;
        const arcadeActive = !!runtimeProjection?.arcade;
        const overlayVisible = !!game?.ui?.messageOverlay && !game.ui.messageOverlay.classList.contains('hidden');
        const runtimeState = getArcadeMenuSurfaceState(this.runtimePort, this.game);
        const arenaUpgrade = runtimeState?.runType === 'arena_waves' && runtimeState?.phase === 'upgrade';
        const arenaFinished = runtimeState?.runType === 'arena_waves' && !!runtimeState?.postRunSummary;
        const fivePortalsFinished = runtimeState?.runType === 'five_portals' && !!runtimeState?.postRunSummary;
        if (arenaUpgrade || arenaFinished || fivePortalsFinished) game?.ui?.messageOverlay?.classList?.remove?.('hidden');
        if (!arcadeActive || (!overlayVisible && !arenaUpgrade && !arenaFinished && !fivePortalsFinished)) {
            this.clearArcadeOverlayPanel();
            return;
        }
        game.ui.messageOverlay.classList.toggle?.('has-arcade-results', !!(runtimeState?.victory || runtimeState?.intermission || runtimeState?.postRunSummary));
        const key = JSON.stringify([game.state, runtimeState]);
        const countdown = this._arcadeOverlayPanel?.querySelector('#arcade-intermission-countdown');
        if (countdown) countdown.textContent = runtimeState?.intermissionPaused
            ? 'Countdown angehalten.' : `Automatischer Start in ${Math.max(0, Math.ceil(game.roundPause))}s.`;
        if (runtimeState?.intermission && game.ui.messageSub) game.ui.messageSub.textContent = runtimeState.intermissionPaused
            ? 'Countdown angehalten – wähle Route und Belohnung.' : 'Wähle Route und Belohnung oder halte den Countdown an.';
        if (key === this._renderKey) return;
        const focusedId = this._arcadeOverlayPanel?.ownerDocument?.activeElement?.id;
        this._renderKey = key;
        if (this._renderFivePortalsPostRunPanel(runtimeState)) return;
        if (this._renderArenaWavesPostRunPanel(runtimeState)) return;
        if (this._renderArcadeVictoryPanel(runtimeState)) return;
        const state = normalizeGameStateId(game?.state, GAME_STATE_IDS.MENU);
        if (this._renderArenaWavesUpgradePanel(runtimeState)) {
            this._arcadeOverlayPanel?.querySelector('button')?.focus({ preventScroll: true });
            return;
        }
        if (state === GAME_STATE_IDS.ROUND_END && this._renderArcadeIntermissionPanel(runtimeState)) {
            const focus = focusedId && document.getElementById(focusedId);
            (focus || this._arcadeOverlayPanel?.querySelector('button'))?.focus({ preventScroll: true });
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
