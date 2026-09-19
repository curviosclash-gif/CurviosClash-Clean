import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from '@playwright/test';
import { acquirePlaywrightRunLock } from '../../../scripts/playwright-run-lock.mjs';

const requireElectron = createRequire(new URL('../../../electron/package.json', import.meta.url));

function csv(name, fallback) {
    return String(process.env[name] || fallback)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

function positiveNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

const maps = csv('BOT_TRAIL_MAPS', 'eiffel_tower_arena,core_fusion');
const skipValues = csv('BOT_TRAIL_SKIP_VALUES', '20,12,8,4').map(Number).filter(Number.isFinite);
const variants = process.env.BOT_TRAIL_VARIANTS
    ? JSON.parse(process.env.BOT_TRAIL_VARIANTS)
    : skipValues.map((skipRecent) => ({ label: `skip-${skipRecent}`, skipRecent }));
const durationSeconds = positiveNumber('BOT_TRAIL_SECONDS', 45);
const port = Math.trunc(positiveNumber('CURVIOS_DESKTOP_STATIC_PORT', 39100 + process.pid % 500));
const outputPath = path.resolve(
    process.env.BOT_TRAIL_OUTPUT
    || path.join(os.tmpdir(), `curviosclash-bot-self-trail-${process.pid}.json`)
);

async function closeApp(app) {
    if (!app) return;
    const closed = await Promise.race([
        app.close().then(() => true, () => false),
        new Promise((resolve) => setTimeout(() => resolve(false), 15_000)),
    ]);
    if (!closed && app.process()?.exitCode == null) app.process().kill();
}

async function writeReport(report) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function runCase(page, spec) {
    return page.evaluate(async ({ mapKey, variant, runMs }) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const median = (values) => {
            if (values.length === 0) return 0;
            const sorted = [...values].sort((left, right) => left - right);
            const middle = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        };
        const waitUntil = async (predicate, timeoutMs = 20_000) => {
            const deadline = performance.now() + timeoutMs;
            while (performance.now() < deadline) {
                if (predicate()) return true;
                await sleep(50);
            }
            return false;
        };
        const resolveBotAI = (policy) => policy?._fallbackPolicy?._botAI || policy?._botAI || policy || null;
        const skipRecent = Number.isFinite(Number(variant.skipRecent))
            ? Number(variant.skipRecent)
            : 20;
        const game = window.GAME_INSTANCE;
        if (!game?.settings) throw new Error('GAME_INSTANCE settings unavailable');

        if (game.state !== 'MENU') {
            await Promise.resolve(game._returnToMenu?.());
            await waitUntil(() => game.state === 'MENU', 5_000);
        }

        Object.assign(game.settings, {
            mode: '1p',
            numHumans: 1,
            numBots: 4,
            winsNeeded: 99,
            botDifficulty: 'HARD',
            botPolicyStrategy: variant.policyStrategy || 'auto',
            gameMode: 'CLASSIC',
            mapKey,
        });
        game.settings.localSettings = game.settings.localSettings || {};
        game.settings.localSettings.sessionType = 'single';
        game.settings.localSettings.modePath = 'normal';
        await Promise.resolve(game._onSettingsChanged?.());
        await Promise.resolve(game.runtimeFacade?.startMatch?.() || game.matchFlowUiController?.startMatch?.());
        const started = await waitUntil(
            () => game.state === 'PLAYING' && game.entityManager?.bots?.length === 4,
            30_000
        );
        if (!started) throw new Error(`Match did not start for ${mapKey}`);

        const manager = game.entityManager;
        const originalKillPlayer = manager._killPlayer.bind(manager);
        const deaths = [];
        const aliveSince = new Map();
        const aliveState = new Map();
        const lastSelfHitByPlayer = new Map();
        const fallbackLastUpdateAt = new Map();
        const fallbackUpdateCounts = new Map();
        const startedAt = performance.now();

        const collisionTelemetry = (
            manager.getTrailSpatialIndex?.() || manager._trailSpatialIndex
        )?._collisionQuery?.debugTelemetry;
        if (collisionTelemetry) {
            collisionTelemetry.enabled = true;
            collisionTelemetry.maxLogs = Number.MAX_SAFE_INTEGER;
            collisionTelemetry.log = (tag, payload) => {
                if (tag !== 'self-hit' || !Number.isInteger(payload?.playerIndex)) return;
                const owner = manager.players[payload.playerIndex];
                const trail = owner?.trail;
                const segmentAge = trail
                    ? (trail.writeIndex - 1 - payload.segmentIdx + trail.maxSegments) % trail.maxSegments
                    : null;
                lastSelfHitByPlayer.set(payload.playerIndex, {
                    ...payload,
                    segmentAge,
                    recordedAt: performance.now(),
                });
            };
        }

        const collectSelfTrailAges = (player) => {
            const index = manager.getTrailSpatialIndex?.() || manager._trailSpatialIndex;
            const grid = index?.spatialGrid;
            const trail = player?.trail;
            if (!grid || !trail) return [];
            const seen = new Set();
            const ages = [];
            for (const cell of grid.values()) {
                for (const segment of cell || []) {
                    if (!segment || seen.has(segment) || segment.destroyed) continue;
                    seen.add(segment);
                    if (segment.playerIndex !== player.index || segment.ownerTrail !== trail) continue;
                    const vx = segment.toX - segment.fromX;
                    const vy = segment.toY - segment.fromY;
                    const vz = segment.toZ - segment.fromZ;
                    const wx = player.position.x - segment.fromX;
                    const wy = player.position.y - segment.fromY;
                    const wz = player.position.z - segment.fromZ;
                    const lengthSq = vx * vx + vy * vy + vz * vz;
                    const t = lengthSq > 0.000001
                        ? Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / lengthSq))
                        : 0;
                    const dx = player.position.x - (segment.fromX + t * vx);
                    const dy = player.position.y - (segment.fromY + t * vy);
                    const dz = player.position.z - (segment.fromZ + t * vz);
                    const radius = (Number(player.hitboxRadius) || 0) + (Number(segment.radius) || 0);
                    if (dx * dx + dy * dy + dz * dz > radius * radius * 1.25) continue;
                    const age = (trail.writeIndex - 1 - segment.segmentIdx + trail.maxSegments) % trail.maxSegments;
                    ages.push(age);
                }
            }
            return ages.sort((left, right) => left - right).slice(0, 32);
        };

        for (const entry of manager.bots) {
            if (variant.classicLegacyMovement === true && typeof entry.ai?._resolveAction === 'function') {
                const productResolveAction = entry.ai._resolveAction.bind(entry.ai);
                entry.ai._resolveAction = (runtimeContext, player, dt) => {
                    const action = productResolveAction(runtimeContext, player, dt);
                    if (!action || typeof action !== 'object') return action;
                    const observation = runtimeContext?.observation || [];
                    const wallFront = Number(observation[3]);
                    const wallLeft = Number(observation[4]);
                    const wallRight = Number(observation[5]);
                    const wallUp = Number(observation[6]);
                    const wallDown = Number(observation[7]);
                    const targetDistance = Number(observation[8]);
                    const pressure = Number(observation[11]);
                    const projectileThreat = Number(observation[12]) >= 0.5;
                    const openness = Number(observation[13]);
                    const planarMode = Number(observation[17]) >= 0.5;
                    if (wallFront < 0.24 || pressure > 0.78) {
                        action.yawRight = wallRight >= wallLeft;
                        action.yawLeft = !action.yawRight;
                    } else if (Math.abs(wallRight - wallLeft) > 0.12) {
                        action.yawRight = wallRight > wallLeft;
                        action.yawLeft = !action.yawRight;
                    }
                    if (!planarMode && Math.abs(wallUp - wallDown) > 0.12) {
                        action.pitchUp = wallUp > wallDown;
                        action.pitchDown = !action.pitchUp;
                    }
                    if (
                        projectileThreat
                        || (targetDistance > 0.55 && openness > 0.62 && pressure < 0.55)
                    ) action.boost = true;
                    if (wallFront < 0.16 && !projectileThreat) action.boost = false;
                    return action;
                };
            }
            if (variant.fallbackMovement === true && entry.ai?._fallbackPolicy) {
                entry.ai._injectFallbackSteeringIfNeeded = function injectMeasuredFallbackMovement(
                    action,
                    dt,
                    player,
                    runtimeContext
                ) {
                    const fallbackRawAction = this._delegateFallbackUpdate(dt, player, runtimeContext);
                    const fallbackAction = this._sanitizeAction(fallbackRawAction, player, {});
                    action.yawLeft = fallbackAction.yawLeft === true;
                    action.yawRight = fallbackAction.yawRight === true;
                    action.pitchUp = fallbackAction.pitchUp === true;
                    action.pitchDown = fallbackAction.pitchDown === true;
                    action.rollLeft = fallbackAction.rollLeft === true;
                    action.rollRight = fallbackAction.rollRight === true;
                    action.boost = fallbackAction.boost === true;
                    return action;
                };
            }
            if (
                (variant.bridgeFallbackNavigation === true || variant.bridgeFallbackAllSteering === true)
                && typeof entry.ai?._resolveAction === 'function'
            ) {
                const originalResolveAction = entry.ai._resolveAction.bind(entry.ai);
                entry.ai._resolveAction = (runtimeContext, player, dt) => {
                    const action = originalResolveAction(runtimeContext, player, dt);
                    if (!action || typeof action !== 'object') return action;
                    const observation = runtimeContext?.observation;
                    const wallFront = Number(observation?.[3]);
                    const pressure = Number(observation?.[11]);
                    if (
                        variant.bridgeFallbackAllSteering !== true
                        && (wallFront < 0.24 || pressure > 0.78)
                    ) return action;
                    delete action.yawLeft;
                    delete action.yawRight;
                    delete action.pitchUp;
                    delete action.pitchDown;
                    delete action.rollLeft;
                    delete action.rollRight;
                    return action;
                };
            }
            if (variant.fallbackSafetySteering === true && entry.ai?._fallbackPolicy) {
                entry.ai._injectFallbackSteeringIfNeeded = function injectMeasuredSafetySteering(
                    action,
                    dt,
                    player,
                    runtimeContext
                ) {
                    const fallbackRawAction = this._delegateFallbackUpdate(dt, player, runtimeContext);
                    const fallbackAction = this._sanitizeAction(fallbackRawAction, player, {});
                    const fallbackSense = this._fallbackPolicy?._botAI?.sense;
                    const shouldPreferFallback = fallbackSense?.immediateDanger === true
                        || (Number(fallbackSense?.forwardRisk) || 0) >= 0.25;
                    const hasLocalSteering = action.yawLeft === true
                        || action.yawRight === true
                        || action.pitchUp === true
                        || action.pitchDown === true
                        || action.rollLeft === true
                        || action.rollRight === true;
                    if (!shouldPreferFallback && hasLocalSteering) return action;

                    action.yawLeft = fallbackAction.yawLeft === true;
                    action.yawRight = fallbackAction.yawRight === true;
                    action.pitchUp = fallbackAction.pitchUp === true;
                    action.pitchDown = fallbackAction.pitchDown === true;
                    action.rollLeft = fallbackAction.rollLeft === true;
                    action.rollRight = fallbackAction.rollRight === true;
                    if (!action.boost && fallbackAction.boost === true) action.boost = true;
                    return action;
                };
            }
            const fallbackPolicy = entry.ai?._fallbackPolicy;
            if (fallbackPolicy && typeof fallbackPolicy.update === 'function') {
                const originalFallbackUpdate = fallbackPolicy.update.bind(fallbackPolicy);
                fallbackPolicy.update = function measuredFallbackUpdate(
                    dt,
                    player,
                    arena,
                    allPlayers,
                    projectiles
                ) {
                    fallbackLastUpdateAt.set(entry.player.index, performance.now());
                    fallbackUpdateCounts.set(
                        entry.player.index,
                        (fallbackUpdateCounts.get(entry.player.index) || 0) + 1
                    );
                    return originalFallbackUpdate(dt, player, arena, allPlayers, projectiles);
                };
            }
            const ai = resolveBotAI(entry.ai);
            if (ai?.profile && variant.profile && typeof variant.profile === 'object') {
                Object.assign(ai.profile, variant.profile);
            }
            if (variant.fullScan === true && ai?.sensors?.facade) {
                ai.sensors.facade.incrementSensePhaseCounter = () => {
                    ai.sensors._sensePhaseCounter = ai.sensors._sensePhase;
                };
            }
            if (variant.adaptiveFullScan === true && ai?.sensors?.facade) {
                ai.sensors.facade.incrementSensePhaseCounter = () => {
                    const sensors = ai.sensors;
                    const riskThreshold = Number.isFinite(Number(variant.adaptiveRiskThreshold))
                        ? Number(variant.adaptiveRiskThreshold)
                        : 0.25;
                    const opennessThreshold = Number.isFinite(Number(variant.adaptiveOpennessThreshold))
                        ? Number(variant.adaptiveOpennessThreshold)
                        : 0.7;
                    const opennessRatio = sensors.sense.lookAhead > 0
                        ? sensors.sense.localOpenness / sensors.sense.lookAhead
                        : 0;
                    const tightOrDangerous = sensors.sense.immediateDanger
                        || sensors.sense.forwardRisk >= riskThreshold
                        || opennessRatio <= opennessThreshold
                        || (variant.scanDuringRecovery === true && ai.state?.recoveryActive === true);
                    sensors._sensePhaseCounter = tightOrDangerous
                        ? sensors._sensePhase
                        : (sensors._sensePhaseCounter + 1) % 4;
                };
            }
            const sensors = ai?.sensors;
            if (sensors && typeof sensors._checkTrailHit === 'function') {
                const originalCheck = sensors._checkTrailHit.bind(sensors);
                sensors._checkTrailHit = (position, player, allPlayers, radius) => (
                    originalCheck(position, player, allPlayers, radius, skipRecent)
                );
            }
            aliveSince.set(entry.player.index, startedAt);
            aliveState.set(entry.player.index, entry.player.alive !== false);
        }

        const human = manager.players.find((player) => !player.isBot);
        if (human && manager.botPolicyRegistry && manager.botByPlayer) {
            const pilot = manager.botPolicyRegistry.create(manager.botPolicyType, {
                difficulty: manager.botDifficulty,
                recorder: manager.recorder,
                runtimeConfig: manager.runtimeConfig,
                runtimeProfiler: manager.runtimeProfiler,
                entityRuntimeConfig: manager.entityRuntimeConfig,
                bridgeEnabled: manager.botBridgeEnabled,
                activeGameMode: manager.combatModeType,
                isDesktopRuntime: manager.botIsDesktopRuntime,
                runtimeRng: manager.runtimeRng,
            });
            manager.botByPlayer.set(human, pilot);
            human.autopilotActive = true;
        }

        manager._killPlayer = function measuredKillPlayer(player, cause, options) {
            if (player === human) return false;
            if (player?.isBot) {
                const now = performance.now();
                const ai = resolveBotAI(manager.botByPlayer?.get?.(player));
                const bestProbe = ai?.sense?.bestProbe;
                const collisionSkipRecent = Number(
                    manager.constructor?.deriveSelfTrailSkipRecentSegments?.(player)
                ) || 0;
                const nearbySelfTrailAges = collectSelfTrailAges(player);
                const lastSelfHit = lastSelfHitByPlayer.get(player.index) || null;
                const collisionSelfHit = lastSelfHit && now - lastSelfHit.recordedAt < 100
                    ? lastSelfHit
                    : null;
                deaths.push({
                    playerIndex: player.index,
                    cause: String(cause || 'UNKNOWN'),
                    lifeSeconds: (now - (aliveSince.get(player.index) || startedAt)) / 1000,
                    collisionSkipRecent,
                    collisionSelfHit,
                    selfTrailAges: nearbySelfTrailAges,
                    collisionEligibleSelfTrailAges: nearbySelfTrailAges.filter(
                        (age) => age >= collisionSkipRecent
                    ),
                    sensorBlindSelfTrailAges: nearbySelfTrailAges.filter(
                        (age) => age >= collisionSkipRecent && age < skipRecent
                    ),
                    selectedProbe: bestProbe?.name || null,
                    selectedProbeTrailDistance: Number(bestProbe?.trailDist) || 0,
                    selectedProbeWallDistance: Number(bestProbe?.wallDist) || 0,
                    forwardRisk: Number(ai?.sense?.forwardRisk) || 0,
                    immediateDanger: ai?.sense?.immediateDanger === true,
                    turnCommitTimer: Number(ai?.state?.turnCommitTimer) || 0,
                    committedYaw: Number(ai?.state?.committedYaw) || 0,
                    recoveryActive: ai?.state?.recoveryActive === true,
                    fallbackUpdateAgeMs: now - (fallbackLastUpdateAt.get(player.index) || startedAt),
                });
                aliveState.set(player.index, false);
            }
            return originalKillPlayer(player, cause, options);
        };

        const deadline = startedAt + runMs;
        while (performance.now() < deadline) {
            for (const entry of manager.bots) {
                const player = entry.player;
                const wasAlive = aliveState.get(player.index) === true;
                const isAlive = player.alive !== false;
                if (isAlive && !wasAlive) aliveSince.set(player.index, performance.now());
                aliveState.set(player.index, isAlive);
            }
            await sleep(50);
        }

        manager._killPlayer = originalKillPlayer;
        if (human) {
            human.autopilotActive = false;
            manager.botByPlayer?.delete?.(human);
        }

        const causes = {};
        for (const death of deaths) causes[death.cause] = (causes[death.cause] || 0) + 1;
        const lifeSeconds = deaths.map((death) => death.lifeSeconds);
        const trailDeaths = deaths.filter((death) => death.cause === 'TRAIL_SELF');
        const trailAges = trailDeaths
            .map((death) => death.collisionSelfHit?.segmentAge)
            .filter(Number.isFinite);
        const blindTrailDeaths = trailDeaths.filter(
            (death) => Number.isFinite(death.collisionSelfHit?.segmentAge)
                && death.collisionSelfHit.segmentAge < skipRecent
        );
        const actualSeconds = (performance.now() - startedAt) / 1000;
        return {
            mapKey,
            variant: variant.label || `skip-${skipRecent}`,
            policyType: manager.botPolicyType,
            skipRecent,
            durationSeconds: actualSeconds,
            deaths: deaths.length,
            deathsPerMinute: deaths.length / (actualSeconds / 60),
            causes,
            trailSelfShare: deaths.length > 0 ? trailDeaths.length / deaths.length : 0,
            sensorBlindTrailDeathShare: trailDeaths.length > 0
                ? blindTrailDeaths.length / trailDeaths.length
                : 0,
            medianLifeSeconds: median(lifeSeconds),
            medianSelfTrailSegmentAge: median(trailAges),
            fallbackUpdatesPerSecond: [...fallbackUpdateCounts.values()].reduce(
                (sum, count) => sum + count,
                0
            ) / actualSeconds,
            samples: deaths.slice(0, 12),
        };
    }, spec);
}

const report = {
    contractVersion: 'bot-self-trail-measure.v1',
    generatedAt: new Date().toISOString(),
    durationSeconds,
    maps,
    skipValues,
    variants,
    results: [],
};

const lock = await acquirePlaywrightRunLock({ label: 'bot self-trail measurement' });
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'curvios-bot-self-trail-profile-'));
const bootPath = path.join(profilePath, 'boot.cjs');
const mainPath = path.resolve('electron/main.cjs');
await fs.writeFile(
    bootPath,
    `const { app } = require('electron'); app.setPath('appData', ${JSON.stringify(profilePath)}); require(${JSON.stringify(mainPath)});\n`,
    'utf8'
);

let app = null;
try {
    const env = {
        ...process.env,
        PW_RUN_TAG: `bot-self-trail-${process.pid}`,
        CURVIOS_ELECTRON_SHOW_WINDOW: '1',
        CURVIOS_DESKTOP_STATIC_PORT: String(port),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
        executablePath: requireElectron('electron'),
        cwd: path.resolve('electron'),
        args: [bootPath],
        env,
        timeout: 60_000,
    });
    const page = await app.firstWindow({ timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.GAME_INSTANCE?.settings), null, { timeout: 60_000 });

    for (const mapKey of maps) {
        for (const variant of variants) {
            if (report.results.length > 0) {
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
                await page.waitForFunction(() => Boolean(window.GAME_INSTANCE?.settings), null, { timeout: 60_000 });
            }
            const result = await runCase(page, { mapKey, variant, runMs: durationSeconds * 1000 });
            report.results.push(result);
            await writeReport(report);
            console.log(JSON.stringify({
                mapKey,
                variant: result.variant,
                skipRecent: result.skipRecent,
                deathsPerMinute: Number(result.deathsPerMinute.toFixed(2)),
                causes: result.causes,
                medianLifeSeconds: Number(result.medianLifeSeconds.toFixed(2)),
                medianSelfTrailSegmentAge: result.medianSelfTrailSegmentAge,
            }));
        }
    }
    console.log(`report=${outputPath}`);
} finally {
    await closeApp(app);
    lock.release();
}
