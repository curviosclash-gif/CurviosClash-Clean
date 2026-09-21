import { resolveArcadeDailySettings } from '../../shared/contracts/ArcadeDailyRulesContract.js';
import { computeDailySeed } from '../../shared/utils/ArcadeUtils.js';
import { resolveMenuCatalogText } from '../menu/MenuTextCatalog.js';
import {
    ARCADE_VEHICLE_PROFILE_MAX_LEVEL,
    getArcadeVehicleProfileRecord,
    loadArcadeVehicleProfileRecord,
} from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { applyHangarWindowStorageEvent, createHangarWindowMenuPort } from '../hangar/HangarWindowMenuBridge.js';
import { readActiveHangarBuildFromStore } from '../hangar/HangarBuildPersistence.js';
import {
    ARCADE_LAST_RUN_STORAGE_KEY,
    ARCADE_SEED_STORAGE_KEY,
    createArcadeLastRunRecord,
    createArcadeSeedRecord,
    readArcadeLastRunRecord,
    readArcadeSeedRecord,
} from '../../shared/contracts/ArcadeMenuPersistenceContract.js';
import { renderArcadeDailyMenuState } from './ArcadeDailyMenuView.js';
import { buildArcadeSurface } from './ArcadeMenuSurfaceDom.js';
import {
    ENDLESS_PARCOURS_RECORDS_STORAGE_KEY,
    summarizeEndlessRecordsLine,
} from '../../shared/contracts/EndlessParcoursRecordsContract.js';
import { FIVE_PORTALS_RECORD_KEY } from '../../shared/contracts/FivePortalsContract.js';
import { releaseButtonOnlyArcadeRun } from './ArcadeRunTypeOps.js';
import { resolveMapPreview, resolveVehiclePreview } from '../menu/MenuPreviewCatalog.js';
import { observeMenuReturn } from './MenuReturnObserver.js';
import { bindArcadeNightmareToggle, syncArcadeNightmareToggle } from './ArcadeNightmareToggle.js';

const BOT_DIFFICULTY_LABELS = Object.freeze({ EASY: 'Leicht', NORMAL: 'Normal', HARD: 'Schwer' });
// Only phases worth showing; unknown or idle phases stay out of the line.
const ARCADE_PHASE_LABELS = Object.freeze({
    countdown: 'Countdown', running: 'läuft', combat: 'Kampf', intermission: 'Zwischenstopp',
    upgrade: 'Vorteil wählen', finished: 'beendet', ended: 'beendet',
});

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function t(textId, fallback) {
    return resolveMenuCatalogText(textId, fallback);
}

function toInt(value, fallback = 0) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function safeReadLocalStorage(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeWriteLocalStorage(key, value) {
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function loadSeed(store = null) {
    const raw = store?.loadJsonRecord?.(ARCADE_SEED_STORAGE_KEY, null)
        ?? safeReadLocalStorage(ARCADE_SEED_STORAGE_KEY);
    let parsed = raw;
    try {
        if (typeof raw !== 'string') throw new TypeError('already_parsed');
        parsed = JSON.parse(raw);
    } catch {
        // Legacy seed payloads were stored as plain integer strings.
    }
    const result = readArcadeSeedRecord(parsed);
    if (result.record) {
        if (result.shouldPersist) {
            if (store?.saveJsonRecord) store.saveJsonRecord(ARCADE_SEED_STORAGE_KEY, result.record);
            else safeWriteLocalStorage(ARCADE_SEED_STORAGE_KEY, JSON.stringify(result.record));
        }
        return result.record.seed;
    }
    return Math.floor(Math.random() * 1_000_000) + 1;
}

function saveSeed(seed, store = null) {
    const record = createArcadeSeedRecord(seed);
    if (store?.saveJsonRecord) store.saveJsonRecord(ARCADE_SEED_STORAGE_KEY, record);
    else safeWriteLocalStorage(ARCADE_SEED_STORAGE_KEY, JSON.stringify(record));
}

function loadLastRunSnapshot(store = null) {
    const raw = store?.loadJsonRecord?.(ARCADE_LAST_RUN_STORAGE_KEY, null)
        ?? safeReadLocalStorage(ARCADE_LAST_RUN_STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const result = readArcadeLastRunRecord(parsed);
        if (result.record && result.shouldPersist) {
            if (store?.saveJsonRecord) store.saveJsonRecord(ARCADE_LAST_RUN_STORAGE_KEY, result.record);
            else safeWriteLocalStorage(ARCADE_LAST_RUN_STORAGE_KEY, JSON.stringify(result.record));
        }
        return result.record;
    } catch {
        return null;
    }
}

function saveLastRunSnapshot(snapshot, store = null) {
    const record = createArcadeLastRunRecord(snapshot);
    if (store?.saveJsonRecord) store.saveJsonRecord(ARCADE_LAST_RUN_STORAGE_KEY, record);
    else safeWriteLocalStorage(ARCADE_LAST_RUN_STORAGE_KEY, JSON.stringify(record));
}

function formatRunTime(isoTime) {
    const date = new Date(isoTime);
    if (Number.isNaN(date.getTime())) return '-';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}.${month} ${hours}:${minutes}`;
}

function normalizeRuntimeAccess(runtimeAccess) {
    return runtimeAccess && typeof runtimeAccess === 'object'
        ? runtimeAccess
        : null;
}

function showToast(runtimeAccess, message, tone = 'info', duration = 1300) {
    runtimeAccess?.showStatusToast?.(message, duration, tone);
}

function copyReplayJsonToClipboard(result) {
    const replayJson = typeof result?.replayJson === 'string' ? result.replayJson : '';
    if (!replayJson || typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
        return Promise.resolve(false);
    }
    return Promise.resolve(navigator.clipboard.writeText(replayJson)).then(() => true).catch(() => false);
}

function resolveVehicleProfileReader(runtimeAccess) {
    return runtimeAccess?.getSettingsStore?.() || null;
}

function resolveVehicleMasteryProfile(runtimeAccess, vehicleId) {
    const fallbackProfile = { level: 1, xp: 0 };
    const store = resolveVehicleProfileReader(runtimeAccess);
    if (!store || typeof store.loadJsonRecord !== 'function') {
        return fallbackProfile;
    }
    try {
        const { profiles } = loadArcadeVehicleProfileRecord(store);
        return getArcadeVehicleProfileRecord(profiles, vehicleId);
    } catch {
        return fallbackProfile;
    }
}

function resolveVehicleMasteryMaxLevel() {
    return ARCADE_VEHICLE_PROFILE_MAX_LEVEL;
}

function shouldShowArcade(settings) {
    const modePath = String(settings?.localSettings?.modePath || '').trim().toLowerCase();
    return modePath === 'arcade';
}

function createArcadeRunSnapshot(settings, seed, hangarBuild = null) {
    settings = resolveArcadeDailySettings(settings);
    if (settings.arcade?.dailyChallenge) seed = settings.arcade.seed;
    return createArcadeLastRunRecord({
        at: new Date().toISOString(),
        mapKey: normalizeString(settings?.mapKey, 'standard'),
        vehicleId: normalizeString(settings?.vehicles?.PLAYER_1, 'ship5'),
        botCount: toInt(settings?.numBots, 0),
        botDifficulty: normalizeString(settings?.botDifficulty, 'NORMAL').toUpperCase(),
        seed: toInt(seed, 0),
        dailyChallenge: settings?.arcade?.dailyChallenge === true,
        buildId: normalizeString(hangarBuild?.buildId, ''),
        buildSchemaVersion: normalizeString(hangarBuild?.schemaVersion, ''),
    });
}

export function setupArcadeMenuSurface(ctx = {}) {
    const ui = ctx.ui || {};
    const settings = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : {};
    const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
    const eventTypes = ctx.eventTypes && typeof ctx.eventTypes === 'object' ? ctx.eventTypes : {};
    const bind = typeof ctx.bind === 'function' ? ctx.bind : null;
    const runtimeAccess = normalizeRuntimeAccess(ctx.runtimeAccess);
    const hangarWindow = createHangarWindowMenuPort(globalThis);

    if (!emit || !bind) return;

    const level3Body = document.querySelector('#submenu-game .level3-body');
    if (!level3Body) return;

    const existing = document.getElementById('arcade-inline-surface');
    if (existing?.parentElement) {
        existing.parentElement.removeChild(existing);
    }

    const refs = buildArcadeSurface(level3Body, ui);
    refs.hangarLaunchCard.classList.toggle('hidden', !hangarWindow.isAvailable());
    let activeProfileId = runtimeAccess?.getActivePlayerProfile?.()?.id || '';
    let activeSeed = loadSeed(runtimeAccess?.getSettingsStore?.());
    let lastRunSnapshot = loadLastRunSnapshot(runtimeAccess?.getSettingsStore?.());
    const applySeedToSettings = (seedValue, { dailyChallenge = false } = {}) => {
        if (!settings.arcade || typeof settings.arcade !== 'object') {
            settings.arcade = {};
        }
        settings.arcade.seed = toInt(seedValue, 0);
        settings.arcade.dailyChallenge = dailyChallenge === true;
    };

    const sync = () => {
        const nextProfileId = runtimeAccess?.getActivePlayerProfile?.()?.id || '';
        if (nextProfileId !== activeProfileId) {
            activeProfileId = nextProfileId;
            activeSeed = loadSeed(runtimeAccess?.getSettingsStore?.());
            lastRunSnapshot = loadLastRunSnapshot(runtimeAccess?.getSettingsStore?.());
        }
        const isArcade = shouldShowArcade(settings);
        refs.details.classList.toggle('hidden', !isArcade);
        if (!isArcade) {
            refs.details.open = false;
            return;
        }
        const hasOpenSetupSection = Array.from(
            level3Body.querySelectorAll('details[data-start-section][open]')
        ).some((section) => section !== refs.details
            && /** @type {HTMLElement} */ (section).dataset.startSection !== 'multiplayer');
        if (!hasOpenSetupSection) refs.details.open = true;

        const mapKey = normalizeString(settings?.mapKey, 'standard');
        const vehicleId = normalizeString(settings?.vehicles?.PLAYER_1, 'ship5');
        const difficulty = normalizeString(settings?.botDifficulty, 'NORMAL').toUpperCase();
        const botCount = toInt(settings?.numBots, 0);
        const dailySeed = computeDailySeed();
        const runtimeState = runtimeAccess?.getArcadeMenuSurfaceState?.() || null;
        const records = runtimeState?.records && typeof runtimeState.records === 'object' ? runtimeState.records : null;
        const daily = runtimeState?.daily && typeof runtimeState.daily === 'object' ? runtimeState.daily : null;
        const replayState = runtimeState?.replay && typeof runtimeState.replay === 'object' ? runtimeState.replay : null;
        const postRunSummary = runtimeState?.postRunSummary && typeof runtimeState.postRunSummary === 'object'
            ? runtimeState.postRunSummary
            : null;
        const intermission = runtimeState?.intermission && typeof runtimeState.intermission === 'object'
            ? runtimeState.intermission
            : null;

        const phaseText = ARCADE_PHASE_LABELS[String(runtimeState?.phase || '')] || '';
        const phaseLabel = phaseText ? ` · ${phaseText}` : '';
        const dailyLabel = runtimeState?.isDailyChallenge === true ? ' · Daily' : '';
        const difficultyLabel = BOT_DIFFICULTY_LABELS[difficulty] || difficulty;
        const tierLabel = settings.arcade?.nightmare === true && !settings.arcade?.dailyChallenge ? ' · Albtraum' : '';
        syncArcadeNightmareToggle(refs.nightmareInput, settings);
        const fivePortalsSelected = settings.arcade?.runType === 'five_portals';
        const fivePortalsRecord = runtimeAccess?.getSettingsStore?.()?.loadJsonRecord?.(FIVE_PORTALS_RECORD_KEY, null) || null;
        refs.runLine.textContent = fivePortalsSelected
            ? 'Fünf Portale: fünf Parcours, drei Checkpoint-Respawns je Map, dann Neustart der aktuellen Map. Solo ohne Bots.'
            : settings.arcade?.dailyChallenge
            ? `Daily: Solo · ${resolveVehiclePreview('ship5').label} ohne Leistungsboni · 5 Sektoren · Normal. Ergebnis bis zum Boss zählt.`
            : `${Number(settings.arcade?.sectorCount) || 5} Sektoren meistern, danach freiwillig Sudden Death. ${resolveMapPreview(mapKey).name} · ${botCount} Bots · ${difficultyLabel}${tierLabel}${dailyLabel}${phaseLabel}`;
        refs.recordsLine.textContent = fivePortalsSelected
            ? `Persönliche Bestzeit: ${fivePortalsRecord?.bestTotalMs > 0 ? `${(fivePortalsRecord.bestTotalMs / 1000).toFixed(2)} s` : '–'}`
            : `Neue Wertung: ${Math.round(runtimeState?.records?.bestScore || 0)} Punkte`
            + (runtimeState?.legacyRecords ? ` | Bisherige Wertung: ${Math.round(runtimeState.legacyRecords.bestScore)} Punkte` : '');
        refs.endlessRecordsLine.textContent = summarizeEndlessRecordsLine(
            runtimeAccess?.getSettingsStore?.()?.loadJsonRecord?.(ENDLESS_PARCOURS_RECORDS_STORAGE_KEY, null) || null
        );
        refs.seedLine.textContent = `${t('menu.arcade.seed.current.label', 'Run-Seed')}: ${activeSeed} | ${t('menu.arcade.seed.daily.label', 'Daily')}: ${dailySeed}`;
        renderArcadeDailyMenuState(refs.dailyLine, daily, dailySeed);

        refs.metricScore.textContent = records ? String(Math.max(0, Math.round(Number(records.lastScore) || 0))) : '0';
        refs.metricMultiplier.textContent = records
            ? `x${Math.max(1, Number(records.lastMultiplier) || 1).toFixed(1)}`
            : 'x1.0';
        refs.metricSector.textContent = records
            ? String(Math.max(0, Number(records.lastSector) || 0))
            : (intermission ? String(Math.max(0, Number(intermission.nextSectorIndex) || 0)) : '0');
        refs.metricChain.textContent = records
            ? String(Math.max(0, Number(records.lastCombo) || 0))
            : '0';

        if (fivePortalsSelected && postRunSummary?.totalMs >= 0) {
            refs.postRunLine.textContent = `Fünf Portale: ${(postRunSummary.totalMs / 1000).toFixed(2)} s gesamt`;
        } else if (postRunSummary) {
            refs.postRunLine.textContent = `Score ${Math.max(0, Math.round(Number(postRunSummary.score) || 0))} | Combo ${Math.max(0, Number(postRunSummary.bestCombo) || 0)} | Mission-Rate ${Math.round(Math.max(0, Math.min(1, Number(postRunSummary.missionCompletionRate) || 0)) * 100)}%`;
        } else if (lastRunSnapshot) {
            const timeLabel = formatRunTime(lastRunSnapshot.at);
            refs.postRunLine.textContent = `${t('menu.arcade.postrun.last.label', 'Letzter Start')}: ${timeLabel} | ${lastRunSnapshot.mapKey} | ${lastRunSnapshot.vehicleId} | Seed ${lastRunSnapshot.seed}`;
        } else {
            refs.postRunLine.textContent = t('menu.arcade.postrun.empty', 'Noch kein Arcade-Run gestartet.');
        }
        if (replayState) {
            refs.replayButton.disabled = replayState.payloadAvailable !== true;
            refs.replayButton.textContent = 'Replay exportieren';
            refs.replayButton.title = replayState.payloadAvailable === true
                ? 'Aufzeichnung des letzten Runs'
                : 'Noch kein Replay verfügbar';
        } else {
            refs.replayButton.disabled = true;
            refs.replayButton.title = 'Noch kein Replay verfügbar';
        }

        const profile = resolveVehicleMasteryProfile(runtimeAccess, vehicleId);
        const MAX_LEVEL = resolveVehicleMasteryMaxLevel();
        const lvl = Math.max(1, Math.min(MAX_LEVEL, Number(profile.level) || 1));
        const masteryLabel = lvl >= MAX_LEVEL
            ? `${t('menu.arcade.mastery.progress.label', 'Level')} ${t('menu.arcade.mastery.max', 'MAX')}`
            : `${t('menu.arcade.mastery.progress.label', 'Level')} ${lvl}/${MAX_LEVEL}`;
        refs.masteryLine.textContent = `${t('menu.arcade.mastery.current.label', 'Fahrzeug')}: ${vehicleId} | ${masteryLabel}`;
    };

    const prepareHangarRunStart = () => {
        if (settings.arcade?.dailyChallenge) return { ok: true, build: null };
        const vehicleId = normalizeString(settings?.vehicles?.PLAYER_1, 'ship5').toLowerCase();
        const build = readActiveHangarBuildFromStore({
            store: runtimeAccess?.getSettingsStore?.(),
            mode: 'arcade',
            vehicleId,
        });
        return { ok: true, build };
    };

    const recordRunStart = (hangarBuild = null) => {
        if (!shouldShowArcade(settings)) return;
        const snapshot = createArcadeRunSnapshot(settings, activeSeed, hangarBuild);
        lastRunSnapshot = snapshot;
        saveLastRunSnapshot(snapshot, runtimeAccess?.getSettingsStore?.());
        sync();
    };

    bind(refs.startRunButton, 'click', () => {
        applySeedToSettings(activeSeed, { dailyChallenge: false });
        settings.arcade.runType = 'gauntlet';
        settings.arcade.combatProfile = '';
        const prepared = prepareHangarRunStart();
        if (prepared?.ok === false) return;
        recordRunStart(prepared?.build);
        emit(eventTypes.START_MATCH);
    });

    // These runs play on their own map and bot count. Both only ride along with the start
    // (borrowedSettings), so the menu keeps the player's map and bots afterwards.
    const startRunWithOwnMap = (runType, borrowedSettings) => {
        applySeedToSettings(activeSeed, { dailyChallenge: false });
        settings.arcade.runType = runType;
        settings.arcade.combatProfile = 'hunt';
        settings.gameMode = 'ARCADE';
        if (!settings.localSettings || typeof settings.localSettings !== 'object') settings.localSettings = {};
        settings.localSettings.modePath = 'arcade';
        if (runType === 'weapon_race') {
            settings.mode = '1p';
            settings.localSettings.sessionType = 'single';
            settings.localSettings.multiplayerTransport = '';
        }
        const prepared = prepareHangarRunStart();
        if (prepared?.ok === false) return;
        const snapshot = createArcadeRunSnapshot({ ...settings, ...borrowedSettings }, activeSeed, prepared?.build);
        if (shouldShowArcade(settings)) {
            lastRunSnapshot = snapshot;
            saveLastRunSnapshot(snapshot, runtimeAccess?.getSettingsStore?.());
            sync();
        }
        emit(eventTypes.START_MATCH, { borrowedSettings });
    };

    bind(refs.startEndlessButton, 'click', () => startRunWithOwnMap('endless_parcours', { mapKey: 'standard', numBots: 0 }));
    bind(refs.startFiveFrontsButton, 'click', () => startRunWithOwnMap('arena_waves', { mapKey: 'notre_dame_arena', numBots: 12 }));
    bind(refs.startFivePortalsButton, 'click', () => startRunWithOwnMap('five_portals', { mapKey: 'micro_maw', numBots: 0 }));
    bind(refs.startWeaponRaceButton, 'click', () => startRunWithOwnMap('weapon_race', { mapKey: 'parcours_assault', numBots: 4 }));

    bind(refs.openHangarButton, 'click', async () => {
        const result = await hangarWindow.openWindow?.({ mode: 'arcade', focus: true });
        if (result?.ok !== true) showToast(runtimeAccess, 'Hangar-Fenster konnte nicht geöffnet werden.', 'warning', 1600);
    });

    bind(globalThis, 'storage', (event) => { if (applyHangarWindowStorageEvent(event, settings, ui)) sync(); });

    bind(refs.rerollSeedButton, 'click', () => {
        activeSeed = Math.floor(Math.random() * 1_000_000) + 1;
        saveSeed(activeSeed, runtimeAccess?.getSettingsStore?.());
        applySeedToSettings(activeSeed, { dailyChallenge: false });
        sync();
        emit(eventTypes.SHOW_STATUS_TOAST, {
            message: t('menu.arcade.seed.rerolled.toast', 'Arcade-Seed aktualisiert.'),
            tone: 'info',
            duration: 1100,
        });
    });

    bind(refs.copySeedButton, 'click', () => {
        applySeedToSettings(activeSeed, { dailyChallenge: false });
        emit(eventTypes.SHOW_STATUS_TOAST, {
            message: `${t('menu.arcade.seed.challenge.toast', 'Challenge-Seed bereit')}: ${activeSeed}`,
            tone: 'info',
            duration: 1400,
        });
    });

    bind(refs.applySeedButton, 'click', () => {
        const requested = Math.floor(Number(refs.seedInput?.value));
        if (!Number.isFinite(requested) || requested < 1 || requested > 2_147_483_647) {
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: t('menu.arcade.seed.invalid.toast', 'Seed muss zwischen 1 und 2147483647 liegen.'),
                tone: 'warning',
                duration: 1600,
            });
            return;
        }
        activeSeed = requested;
        saveSeed(activeSeed, runtimeAccess?.getSettingsStore?.());
        applySeedToSettings(activeSeed, { dailyChallenge: false });
        sync();
        emit(eventTypes.SHOW_STATUS_TOAST, {
            message: `${t('menu.arcade.seed.applied.toast', 'Seed übernommen')}: ${activeSeed}`,
            tone: 'info',
            duration: 1300,
        });
    });

    bind(refs.replayButton, 'click', () => {
        const result = runtimeAccess?.requestArcadeReplayPlayback?.();
        const code = String(result?.code || 'replay_unavailable');
        if (code === 'ghost_fallback_started') {
            showToast(runtimeAccess, t('menu.arcade.postrun.replay.toast.started', 'Ghost-Fallback wird abgespielt.'), 'info', 1300);
            return;
        }
        if (code === 'replay_export_ready') {
            copyReplayJsonToClipboard(result).then((copied) => {
                showToast(
                    runtimeAccess,
                    copied ? 'Replay-JSON wurde in die Zwischenablage kopiert.' : 'Replay-JSON konnte nicht kopiert werden.',
                    copied ? 'info' : 'warning',
                    1600
                );
            });
            return;
        }
        if (code === 'replay_player_unavailable') {
            showToast(runtimeAccess, t('menu.arcade.postrun.replay.toast.ready', 'Replay-Fallback bereit.'), 'warning', 1300);
            return;
        }
        if (code === 'replay_disabled') {
            showToast(runtimeAccess, t('menu.arcade.postrun.replay.toast.disabled', 'Replay ist deaktiviert.'), 'warning', 1300);
            return;
        }
        showToast(runtimeAccess, t('menu.arcade.postrun.replay.toast.empty', 'Kein Replay verfügbar.'), 'info', 1200);
    });

    bind(refs.dailyButton, 'click', () => {
        if (!settings.arcade) settings.arcade = {};
        settings.arcade.dailyChallenge = true;
        recordRunStart(null);
        emit(eventTypes.START_MATCH);
    });

    if (ui.startButton) {
        bind(ui.startButton, 'click', (event) => {
            if (!shouldShowArcade(settings)) return;
            releaseButtonOnlyArcadeRun(settings); applySeedToSettings(activeSeed, { dailyChallenge: false });
            const prepared = prepareHangarRunStart();
            if (prepared?.ok === false) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            recordRunStart(prepared?.build);
        }, true);
    }

    const syncOnInteraction = () => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(sync);
            return;
        }
        setTimeout(sync, 0);
    };

    const syncTriggers = [
        ...(Array.isArray(ui.modePathButtons) ? ui.modePathButtons : []),
        ...(Array.isArray(ui.sessionButtons) ? ui.sessionButtons : []),
        ui.mapSelect,
        ui.vehicleSelectP1,
        ui.botSlider,
        ui.botDifficultySelect,
        ui.level3ResetButton,
    ].filter(Boolean);

    syncTriggers.forEach((element) => {
        bind(element, 'change', syncOnInteraction);
        bind(element, 'input', syncOnInteraction);
        bind(element, 'click', syncOnInteraction);
    });

    bindArcadeNightmareToggle(refs.nightmareInput, settings, bind, sync);
    observeMenuReturn(level3Body.closest?.('#main-menu'), syncOnInteraction);
    sync();
}
