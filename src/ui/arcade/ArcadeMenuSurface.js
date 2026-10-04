import { resolveArcadeDailySettings } from '../../shared/contracts/ArcadeDailyRulesContract.js';
import { computeDailySeed } from '../../shared/utils/ArcadeUtils.js';
import { resolveMenuCatalogText } from '../menu/MenuTextCatalog.js';
import { getArcadeVehicleProfileRecord, loadArcadeVehicleProfileRecord } from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { resolveArcadeRunVehicleId } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import { applyArcadeLabWindowStorageEvent, applyHangarWindowStorageEvent, createHangarWindowMenuPort } from '../hangar/HangarWindowMenuBridge.js';
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
import { getRuntimeMapDefinition } from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { resolvePortalChain } from '../../shared/contracts/PortalChainContract.js';
import { releaseButtonOnlyArcadeRun } from './ArcadeRunTypeOps.js';
import { resolveMapPreview, resolveVehiclePreview } from '../menu/MenuPreviewCatalog.js';
import { renderArcadeLeaderboardMenu } from './ArcadeLeaderboardMenuView.js';
import { observeMenuReturn } from './MenuReturnObserver.js';
import { bindArcadeNightmareToggle, syncArcadeNightmareToggle } from './ArcadeNightmareToggle.js';
import { bindValidatedArcadeStartCapture, shouldShowArcadePlayerProfileControls, setupArcadePlayerProfileSelection, validateLocalArcadeProfileStart } from './ArcadeDemolitionProfileSelection.js';
import { bindArcadeSpecialStartButtons } from './ArcadeMenuSpecialStartOps.js';
import { loadArcadeDifficultyProgress, resolveArcadeRunTier, ARCADE_DIFFICULTY_TIERS } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { resolveArcadeParcoursRankKey, resolveArcadeRankKey, normalizeArcadeRankedLeaderboard, ARCADE_RANKED_STORAGE_KEY } from '../../shared/contracts/ArcadeRankedLeaderboardContract.js';
import { bindArcadeTestFlightMenu } from './ArcadeTestFlightMenuOps.js';

// Only phases worth showing; unknown or idle phases stay out of the line.
const ARCADE_PHASE_LABELS = Object.freeze({
    countdown: 'Countdown', running: 'läuft', combat: 'Kampf', intermission: 'Zwischenstopp',
    upgrade: 'Vorteil wählen', finished: 'beendet', ended: 'beendet',
});

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

// Arcade flies only the factory ships: a stored Vehicle Lab build shows and starts as the Star-Cruiser.
function resolveArcadeMenuVehicleId(settings) {
    return resolveArcadeRunVehicleId(settings?.vehicles?.PLAYER_1);
}

function t(textId, fallback) {
    return resolveMenuCatalogText(textId, fallback);
}

function toInt(value, fallback = 0) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function formatInteger(value) {
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })
        .format(Math.max(0, Math.round(Number(value) || 0)));
}

function formatCompletedRuns(value) {
    const count = Math.max(0, Math.trunc(Number(value) || 0));
    return count === 1 ? '1 abgeschlossener Lauf' : `${formatInteger(count)} abgeschlossene Läufe`;
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
        vehicleId: resolveArcadeMenuVehicleId(settings),
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
    const arcadeProfiles = setupArcadePlayerProfileSelection(refs, runtimeAccess, settings, bind);
    refs.hangarLaunchCard.classList.toggle('hidden', !hangarWindow.isAvailable());
    let activeProfileId = runtimeAccess?.getActivePlayerProfile?.()?.id || '';
    let activeSeed = loadSeed(runtimeAccess?.getSettingsStore?.());
    let lastRunSnapshot = loadLastRunSnapshot(runtimeAccess?.getSettingsStore?.());
    let leaderboardExpanded = false;

    const leaderboardRefs = {
        line: refs.leaderboardLine,
        list: refs.leaderboardList,
        result: refs.leaderboardResult,
        resultTitle: refs.leaderboardResultTitle,
        resultDetail: refs.leaderboardResultDetail,
        empty: refs.leaderboardEmpty,
        tableWrap: refs.leaderboardTableWrap,
        toggle: refs.leaderboardToggle,
    };
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
        const vehicleId = resolveArcadeMenuVehicleId(settings);
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
        const mapDefinition = getRuntimeMapDefinition(mapKey);
        const store = runtimeAccess?.getSettingsStore?.();
        const profile = resolveVehicleMasteryProfile(runtimeAccess, vehicleId);
        const tierId = resolveArcadeRunTier(settings.arcade?.difficultyTierId, loadArcadeDifficultyProgress(store).progress, { runType: settings.arcade?.runType || 'gauntlet', dailyChallenge: settings.arcade?.dailyChallenge });
        const rankContext = { runType: settings.arcade?.runType || 'gauntlet', tierId, vehicleLevel: profile.level, ranked: !settings.arcade?.dailyChallenge && !['weapon_race', 'demolition', 'hangar_test'].includes(settings.arcade?.runType) };
        const leaderboardRouteId = resolveArcadeParcoursRankKey(normalizeString(mapDefinition?.parcours?.routeId, mapKey), rankContext);
        const leaderboardEntries = runtimeState?.leaderboard?.[leaderboardRouteId];

        const phaseText = ARCADE_PHASE_LABELS[String(runtimeState?.phase || '')] || '';
        const phaseLabel = phaseText ? ` · ${phaseText}` : '';
        const dailyLabel = runtimeState?.isDailyChallenge === true ? ' · Daily' : '';
        const difficultyLabel = ARCADE_DIFFICULTY_TIERS.find((tier) => tier.id === tierId)?.label || 'ohne Run-Stufe';
        syncArcadeNightmareToggle(refs.nightmareInput, settings, store);
        const fivePortalsSelected = settings.arcade?.runType === 'five_portals';
        refs.arcadePlayerProfileControls.classList.toggle('hidden', !shouldShowArcadePlayerProfileControls(settings));
        const activePortalChain = fivePortalsSelected ? resolvePortalChain(settings.arcade?.portalChainId) : null;
        const fivePortalsRecord = fivePortalsSelected
            ? runtimeAccess?.getSettingsStore?.()?.loadJsonRecord?.(activePortalChain.recordKey, null) || null
            : null;
        refs.runLine.textContent = settings.arcade?.runType === 'demolition'
            ? 'Abrisskommando: drei Belagerungskarten. Zerstöre die Bauwerke vor Ablauf der Zeit; Punkte und verdiente Fahrzeug-XP bleiben erhalten.'
            : fivePortalsSelected
            ? (activePortalChain.id === 'five_portals'
                ? 'Fünf Portale: fünf Parcours, drei Checkpoint-Respawns je Map, dann Neustart der aktuellen Map. Solo ohne Bots.'
                : `${activePortalChain.label}: ${activePortalChain.maps.length} Parcours, drei Checkpoint-Respawns je Map, dann Neustart der aktuellen Map. Solo ohne Bots.`)
            : settings.arcade?.dailyChallenge
            ? `Daily: Solo · ${resolveVehiclePreview('ship5').label} ohne Leistungsboni · 5 Sektoren · Normal. Ergebnis bis zum Boss zählt.`
            : `${Number(settings.arcade?.sectorCount) || 5} Sektoren meistern, danach freiwillig Sudden Death. ${resolveMapPreview(mapKey).name} · ${botCount} Bots · ${difficultyLabel}${dailyLabel}${phaseLabel}`;
        refs.recordsLine.textContent = fivePortalsSelected
            ? `Persönliche Bestzeit: ${fivePortalsRecord?.bestTotalMs > 0 ? `${(fivePortalsRecord.bestTotalMs / 1000).toFixed(2)} s` : '–'}`
            : `Persönlicher Rekord: ${formatInteger(runtimeState?.records?.bestScore)} Punkte`
            + (records ? ` · ${formatCompletedRuns(records.runsPlayed)}` : '')
            + (runtimeState?.legacyRecords ? ` · Frühere Wertung: ${formatInteger(runtimeState.legacyRecords.bestScore)} Punkte` : '');
        refs.endlessRecordsLine.textContent = summarizeEndlessRecordsLine(
            runtimeAccess?.getSettingsStore?.()?.loadJsonRecord?.(ENDLESS_PARCOURS_RECORDS_STORAGE_KEY, null) || null
        );
        const rankedRows = normalizeArcadeRankedLeaderboard(store?.loadJsonRecord?.(ARCADE_RANKED_STORAGE_KEY, null)).boards[resolveArcadeRankKey(rankContext)] || [];
        refs.rankedLine.textContent = `Bestenliste · ${difficultyLabel} · Level ${Math.floor((profile.level - 1) / 5) * 5 + 1}–${Math.floor((profile.level - 1) / 5) * 5 + 5}: ` + (rankedRows.length ? rankedRows.map((row, index) => `${index + 1}. ${resolveVehiclePreview(row.vehicleId).label} (Lv. ${row.vehicleLevel}) ${rankContext.runType === 'five_portals' ? (row.score / 1000).toFixed(2) + ' s' : formatInteger(row.score) + ' Punkte'}`).join(' · ') : 'Noch kein gewerteter Lauf.');
        refs.seedLine.textContent = `${t('menu.arcade.seed.current.label', 'Run-Seed')}: ${activeSeed} | ${t('menu.arcade.seed.daily.label', 'Daily')}: ${dailySeed}`;
        renderArcadeDailyMenuState(refs.dailyLine, daily, dailySeed);
        renderArcadeLeaderboardMenu(leaderboardRefs, {
            entries: leaderboardEntries,
            routeId: leaderboardRouteId,
            routeLabel: resolveMapPreview(mapKey).name || mapKey,
            expanded: leaderboardExpanded,
            lastResult: runtimeState?.lastParcoursResult || null,
        });

        refs.metricScore.textContent = records ? formatInteger(records.lastScore) : '0';
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
            refs.postRunLine.textContent = `${activePortalChain.label}: ${(postRunSummary.totalMs / 1000).toFixed(2)} s gesamt`;
        } else if (postRunSummary) {
            refs.postRunLine.textContent = `Punkte ${Math.max(0, Math.round(Number(postRunSummary.score) || 0))} · Beste Kombo ${Math.max(0, Number(postRunSummary.bestCombo) || 0)} · Missionen ${Math.round(Math.max(0, Math.min(1, Number(postRunSummary.missionCompletionRate) || 0)) * 100)} %`;
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

        const lvl = Math.max(1, Math.floor(Number(profile.level) || 1));
        const masteryLabel = `${t('menu.arcade.mastery.progress.label', 'Level')} ${lvl}`;
        refs.masteryLine.textContent = `${t('menu.arcade.mastery.current.label', 'Fahrzeug')}: ${vehicleId} | ${masteryLabel}`;
    };

    const prepareHangarRunStart = () => {
        if (settings.arcade?.dailyChallenge) return { ok: true, build: null };
        const vehicleId = resolveArcadeMenuVehicleId(settings).toLowerCase();
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
        if (!validateLocalArcadeProfileStart(settings, arcadeProfiles, runtimeAccess)) return;
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
    const startRunWithOwnMap = (runType, borrowedSettings, portalChainId) => {
        const playerCount = runType === 'weapon_race' ? 1 : null;
        if (runType !== 'demolition' && !validateLocalArcadeProfileStart(settings, arcadeProfiles, runtimeAccess, { playerCount })) return;
        applySeedToSettings(activeSeed, { dailyChallenge: false });
        settings.arcade.runType = runType;
        settings.arcade.combatProfile = 'hunt';
        if (runType === 'five_portals') settings.arcade.portalChainId = portalChainId || 'five_portals';
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

    bindArcadeSpecialStartButtons(refs, bind, startRunWithOwnMap, activeSeed, arcadeProfiles, runtimeAccess);

    bind(refs.openHangarButton, 'click', async () => {
        const result = await hangarWindow.openWindow?.({ mode: 'arcade', focus: true });
        if (result?.ok !== true) showToast(runtimeAccess, 'Hangar-Fenster konnte nicht geöffnet werden.', 'warning', 1600);
    });

    bind(globalThis, 'storage', (event) => { if (applyArcadeLabWindowStorageEvent(event, runtimeAccess, ui) || applyHangarWindowStorageEvent(event, settings, ui)) sync(); });
    const testFlightMenu = bindArcadeTestFlightMenu({ bind, settings, runtimeAccess, emit, eventTypes, hangarWindow });

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
        const result = runtimeAccess?.requestArcadeReplayExport?.();
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

    bindValidatedArcadeStartCapture(bind, refs.dailyButton, () => true,
        () => validateLocalArcadeProfileStart(settings, arcadeProfiles, runtimeAccess, { playerCount: 1 }), () => {
            if (!settings.arcade) settings.arcade = {};
            settings.arcade.dailyChallenge = true;
            recordRunStart(null);
            emit(eventTypes.START_MATCH);
        });

    bind(refs.leaderboardToggle, 'click', () => {
        leaderboardExpanded = !leaderboardExpanded;
        sync();
    });

    bindValidatedArcadeStartCapture(bind, ui.startButton, () => shouldShowArcade(settings),
        () => validateLocalArcadeProfileStart(settings, arcadeProfiles, runtimeAccess), (event) => {
            releaseButtonOnlyArcadeRun(settings);
            applySeedToSettings(activeSeed, { dailyChallenge: false });
            const prepared = prepareHangarRunStart();
            if (prepared?.ok === false) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            recordRunStart(prepared?.build);
        });

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
    const syncOnMenuReturn = () => { testFlightMenu.onMenuReturn(); syncOnInteraction(); };
    observeMenuReturn(level3Body.closest?.('#main-menu'), syncOnMenuReturn);
    sync();
}
