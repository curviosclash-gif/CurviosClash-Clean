import './three-player-split.css';

import { resolveInventoryActionAvailability } from '../shared/contracts/GameplayActionAvailabilityContract.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { scoreRank } from '../shared/contracts/MatchScoreRanking.js';
import {
    FOUR_PLAYER_PLANAR_MODES,
    THREE_PLAYER_SPLIT_HUMAN_COUNT,
    THREE_PLAYER_SPLIT_PLAYER_COLORS,
    isThreePlayerSplitRuntime,
} from './FourPlayerPlanarContract.js';

/**
 * Drives the in-match surface of the local 3-player split-screen. Setup lives
 * in the shared match menu ("Spieler & Geräte"), so two and three players pick
 * map, planes and rules in one place; this module only owns the compact HUD.
 *
 * The HUD view is injected by the composition side: feature modules may not
 * import src/ui or src/core (see ArchitectureConfig.mjs).
 */
export class ThreePlayerSplitModule {
    /**
     * @param {object} options
     * @param {any} options.runtimePort
     * @param {any} options.hudView  ThreePlayerSplitHudView or an object with the same methods
     */
    constructor({ runtimePort, hudView }) {
        this.runtime = runtimePort || null;
        this.hudView = hudView;
        this._matchActive = false;
        this._hudTickTimer = 0;
        this._lastHudValues = Array.from({ length: THREE_PLAYER_SPLIT_HUMAN_COUNT }, () => ({}));
    }

    isRuntimeActive() {
        return isThreePlayerSplitRuntime(this.runtime?.getRuntimeConfig?.());
    }

    activateMatch() {
        if (this._matchActive) return;
        this._matchActive = true;
        this.hudView.setRuntimeSurfaceActive(true);
        this.hudView.setViewportLayout?.(this.runtime?.getRuntimeConfig?.()?.session?.viewportLayout);
        this.hudView.ensureRows({
            playerCount: THREE_PLAYER_SPLIT_HUMAN_COUNT,
            playerColors: THREE_PLAYER_SPLIT_PLAYER_COLORS,
        });
        this.hudView.setVisible(true);
    }

    deactivateMatch() {
        if (!this._matchActive && !this.hudView.hasRoot()) return;
        this._matchActive = false;
        this._hudTickTimer = 0;
        this.hudView.setRuntimeSurfaceActive(false);
        this.hudView.setVisible(false);
        this.hudView.resetScoreEvent?.();
        this._lastHudValues.forEach((state) => {
            for (const key of Object.keys(state)) delete state[key];
        });
    }

    resetMatchScoreEvents() {
        this.hudView.resetScoreEvent?.();
    }

    update(dt = 1 / 60) {
        const runtimeActive = this.isRuntimeActive()
            && this.runtime?.getGameStateId?.() !== GAME_STATE_IDS.MENU;
        if (!runtimeActive) {
            this.deactivateMatch();
            return;
        }
        const firstFrame = !this._matchActive;
        this.activateMatch();
        this.runtime.forceThirdPersonCameras(THREE_PLAYER_SPLIT_HUMAN_COUNT);
        this._hudTickTimer += Math.max(0, Number(dt) || 0);
        if (!firstFrame && this._hudTickTimer < 0.1) return;
        this._hudTickTimer %= 0.1;
        const runtimeConfig = this.runtime.getRuntimeConfig();
        const projection = this.runtime.getMatchRuntimeProjection?.() || null;
        const hunt = runtimeConfig?.session?.threePlayerSplit?.mode === FOUR_PLAYER_PLANAR_MODES.HUNT;
        const projectedPlayers = Array.isArray(projection?.players) ? projection.players : [];
        const players = projectedPlayers.length > 0 ? projectedPlayers : this.runtime.getPlayers();
        const huntProjection = hunt ? projection?.hunt || null : null;
        const fightRows = hunt
            ? (Array.isArray(huntProjection?.scoreboardRows)
                ? huntProjection.scoreboardRows
                : this.runtime.getHuntScoreboard?.() || [])
            : [];
        const scoreRows = hunt ? fightRows : players;
        const scoreKey = hunt ? 'kills' : 'score';
        this.hudView.observeScores?.(scoreRows, { scoreKey });
        this.hudView.updateMatch?.({
            huntActive: hunt,
            scoreRows,
            huntProjection,
            runtimeConfig,
        });
        const globalFog = projection?.globalFog || this.runtime.getGlobalFogState?.();
        const fogLabel = globalFog?.active === true && Number(globalFog.remainingSeconds) > 0
            ? `☁ Nebel ${Math.ceil(Number(globalFog.remainingSeconds))}s`
            : '';
        const reduceMotion = runtimeConfig?.cameraPerspective?.reduceMotion !== false;
        const gameplayConfig = this.runtime.getGameplayConfig?.() || null;
        for (let index = 0; index < THREE_PLAYER_SPLIT_HUMAN_COUNT; index += 1) {
            const player = players[index];
            this.hudView.updateRocketWarning?.(
                index,
                player,
                hunt ? (player?.rocketThreat || this.runtime.getRocketThreat?.(index)) : null,
                hunt,
                reduceMotion,
            );
            if (!player || !this.hudView.hasRow(index)) continue;
            this.hudView.updatePlayer?.(index, player, {
                huntActive: hunt,
                projection,
                huntProjection,
                globalFog,
                gameplayConfig,
                keyBindings: this.runtime.getPlayerKeyBindings?.(index) || null,
            });
            const availability = resolveInventoryActionAvailability({
                player,
                modeType: hunt ? 'HUNT' : 'CLASSIC',
            });
            const itemLabel = availability.hasItem ? availability.type : 'Kein Item';
            const fightRow = hunt ? fightRows.find((row) => row.playerIndex === index) : null;
            const rank = scoreRank(scoreRows, index, scoreKey);
            const values = {
                stat: hunt
                    ? `Abschüsse ${fightRow?.kills || 0} · HP ${Math.max(0, Math.ceil(Number(player.hp) || 0))}`
                    : String(Number(player.score) || 0),
                rank: rank ? `Rang ${rank}/${scoreRows.length}` : 'Rang –',
                item: fogLabel ? `${itemLabel} · ${fogLabel}` : itemLabel,
            };
            const previous = this._lastHudValues[index];
            for (const key of /** @type {Array<'stat'|'rank'|'item'>} */ (['stat', 'rank', 'item'])) {
                if (previous[key] === values[key]) continue;
                previous[key] = values[key];
                this.hudView.setRowText(index, key, values[key]);
            }
        }
    }

    dispose() {
        this.deactivateMatch();
        this.hudView.dispose();
        this.runtime = null;
    }
}
