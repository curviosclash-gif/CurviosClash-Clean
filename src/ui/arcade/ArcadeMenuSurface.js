import { resolveMenuCatalogText } from '../menu/MenuTextCatalog.js';
import {
    ARCADE_VEHICLE_PROFILE_MAX_LEVEL,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    getArcadeVehicleProfileRecord,
    readArcadeVehicleProfileRecord,
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

function t(textId, fallback) {
    return resolveMenuCatalogText(textId, fallback);
}

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
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

function computeDailySeed() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const day = now.getUTCDate();
    return (year * 10000) + (month * 100) + day;
}

function loadSeed() {
    const raw = safeReadLocalStorage(ARCADE_SEED_STORAGE_KEY);
    let parsed = raw;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Legacy seed payloads were stored as plain integer strings.
    }
    const result = readArcadeSeedRecord(parsed);
    if (result.record) {
        if (result.shouldPersist) {
            safeWriteLocalStorage(ARCADE_SEED_STORAGE_KEY, JSON.stringify(result.record));
        }
        return result.record.seed;
    }
    return Math.floor(Math.random() * 1_000_000) + 1;
}

function saveSeed(seed) {
    safeWriteLocalStorage(ARCADE_SEED_STORAGE_KEY, JSON.stringify(createArcadeSeedRecord(seed)));
}

function loadLastRunSnapshot() {
    const raw = safeReadLocalStorage(ARCADE_LAST_RUN_STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        const result = readArcadeLastRunRecord(parsed);
        if (result.record && result.shouldPersist) {
            safeWriteLocalStorage(ARCADE_LAST_RUN_STORAGE_KEY, JSON.stringify(result.record));
        }
        return result.record;
    } catch {
        return null;
    }
}

function saveLastRunSnapshot(snapshot) {
    safeWriteLocalStorage(
        ARCADE_LAST_RUN_STORAGE_KEY,
        JSON.stringify(createArcadeLastRunRecord(snapshot))
    );
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
        const rawProfiles = store.loadJsonRecord(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, {});
        const { profiles } = readArcadeVehicleProfileRecord(rawProfiles);
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
    let activeSeed = loadSeed();
    let lastRunSnapshot = loadLastRunSnapshot();
    const applySeedToSettings = (seedValue, { dailyChallenge = false } = {}) => {
        if (!settings.arcade || typeof settings.arcade !== 'object') {
            settings.arcade = {};
        }
        settings.arcade.seed = toInt(seedValue, 0);
        settings.arcade.dailyChallenge = dailyChallenge === true;
    };

    const sync = () => {
        const isArcade = shouldShowArcade(settings);
        refs.details.classList.toggle('hidden', !isArcade);
        if (!isArcade) {
            refs.details.open = false;
            return;
        }
        const hasOpenSetupSection = Array.from(
            level3Body.querySelectorAll('details[data-start-section][open]')
        ).some((section) => section !== refs.details && section.dataset.startSection !== 'multiplayer');
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

        const phaseLabel = runtimeState?.phase ? ` | ${String(runtimeState.phase).toUpperCase()}` : '';
        const dailyLabel = runtimeState?.isDailyChallenge === true ? ' | DAILY' : '';
        refs.runLine.textContent = `${t('menu.arcade.runline.label', 'Aktueller Arcade-Layer')}: ${mapKey} | Bots ${botCount} | ${difficulty}${dailyLabel}${phaseLabel}`;
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

        if (postRunSummary) {
            refs.postRunLine.textContent = `Score ${Math.max(0, Math.round(Number(postRunSummary.score) || 0))} | Combo ${Math.max(0, Number(postRunSummary.bestCombo) || 0)} | Mission-Rate ${Math.round(Math.max(0, Math.min(1, Number(postRunSummary.missionCompletionRate) || 0)) * 100)}%`;
        } else if (lastRunSnapshot) {
            const timeLabel = formatRunTime(lastRunSnapshot.at);
            refs.postRunLine.textContent = `${t('menu.arcade.postrun.last.label', 'Letzter Start')}: ${timeLabel} | ${lastRunSnapshot.mapKey} | ${lastRunSnapshot.vehicleId} | Seed ${lastRunSnapshot.seed}`;
        } else {
            refs.postRunLine.textContent = t('menu.arcade.postrun.empty', 'Noch kein Arcade-Run gestartet.');
        }
        if (replayState) {
            refs.replayButton.disabled = replayState.payloadAvailable !== true;
            refs.replayButton.title = replayState.payloadAvailable === true
                ? 'Replay/Fallback aus letztem Run'
                : 'Noch kein Replay verfuegbar';
        } else {
            refs.replayButton.disabled = true;
            refs.replayButton.title = 'Noch kein Replay verfuegbar';
        }

        const profile = resolveVehicleMasteryProfile(runtimeAccess, vehicleId);
        const MAX_LEVEL = resolveVehicleMasteryMaxLevel();
        const lvl = Math.max(1, Math.min(MAX_LEVEL, Number(profile.level) || 1));
        const masteryLabel = lvl >= MAX_LEVEL
            ? `${t('menu.arcade.mastery.progress.label', 'Mastery')} ${t('menu.arcade.mastery.max', 'MAX')}`
            : `${t('menu.arcade.mastery.progress.label', 'Mastery')} Lv.${lvl}/${MAX_LEVEL}`;
        refs.masteryLine.textContent = `${t('menu.arcade.mastery.current.label', 'Aktives Airframe')}: ${vehicleId} | ${masteryLabel}`;
    };

    const prepareHangarRunStart = () => {
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
        saveLastRunSnapshot(snapshot);
        sync();
    };

    bind(refs.startRunButton, 'click', () => {
        applySeedToSettings(activeSeed, { dailyChallenge: false });
        const prepared = prepareHangarRunStart();
        if (prepared?.ok === false) return;
        recordRunStart(prepared?.build);
        emit(eventTypes.START_MATCH);
    });

    bind(refs.openHangarButton, 'click', async () => {
        const result = await hangarWindow.openWindow?.({ mode: 'arcade', focus: true });
        if (result?.ok !== true) showToast(runtimeAccess, 'Hangar-Fenster konnte nicht geöffnet werden.', 'warning', 1600);
    });

    bind(globalThis, 'storage', (event) => { if (applyHangarWindowStorageEvent(event, settings, ui)) sync(); });

    bind(refs.rerollSeedButton, 'click', () => {
        activeSeed = Math.floor(Math.random() * 1_000_000) + 1;
        saveSeed(activeSeed);
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
        showToast(runtimeAccess, t('menu.arcade.postrun.replay.toast.empty', 'Kein Replay verfuegbar.'), 'info', 1200);
    });

    bind(refs.dailyButton, 'click', () => {
        activeSeed = computeDailySeed();
        saveSeed(activeSeed);
        applySeedToSettings(activeSeed, { dailyChallenge: true });
        sync();
        const prepared = prepareHangarRunStart();
        if (prepared?.ok === false) return;
        recordRunStart(prepared?.build);
        emit(eventTypes.SHOW_STATUS_TOAST, {
            message: `${t('menu.arcade.postrun.daily.toast', 'Daily-Challenge startet mit Seed')}: ${activeSeed}`,
            tone: 'info',
            duration: 1400,
        });
        emit(eventTypes.START_MATCH);
    });

    if (ui.startButton) {
        bind(ui.startButton, 'click', (event) => {
            if (!shouldShowArcade(settings)) return;
            applySeedToSettings(activeSeed, { dailyChallenge: false });
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

    sync();
}
