import { normalizeString } from './ContractNormalizeUtils.js';
import { GAMEPLAY_CAMERA_MODE_ID } from './CameraModeContract.js';
import { resolveArtifactVersionState } from './ArtifactVersionMigrationContract.js';
import { createGlobalFogEffectState } from './GlobalFogEffectContract.js';
import { normalizeHuntWinCondition } from './HuntWinConditionContract.js';
import { normalizeHuntLivesByPlayer } from './HuntLivesContract.js';
import { normalizeTeamId } from './TeamCombatContract.js';

export const MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION = 'match-runtime-projection.v1';
export const MATCH_RUNTIME_PROJECTION_VERSION_FIELDS = Object.freeze(['contractVersion']);
export const MATCH_RUNTIME_PROJECTION_SUPPORTED_VERSIONS = Object.freeze([
    MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION,
]);
export const MATCH_RUNTIME_PROJECTION_VERSION_POLICY = Object.freeze({
    currentVersion: MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION,
    legacyMissingVersion: 'fallback-to-v1-defaults',
    unknownVersion: 'reject-to-empty-v1-projection',
});
export const MATCH_RUNTIME_PROJECTION_TRAVERSAL_COMPATIBILITY = Object.freeze({
    introducedIn: MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION,
    policy: 'additive-v1-fields',
    fields: Object.freeze([
        'portalsEnabled',
        'portalCooldownRemaining',
        'gateCooldownRemaining',
        'gateCount',
        'exitPortal',
        'exitPortalCooldownRemaining',
        'postPortalActive',
        'postPortalRemainingSeconds',
        'lastPortalTravelAtMs',
    ]),
});

function normalizeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeInt(value, fallback = 0) {
    return Math.trunc(normalizeNumber(value, fallback));
}

function normalizeNonNegativeInt(value, fallback = 0) {
    return Math.max(0, normalizeInt(value, fallback));
}

function cloneStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => normalizeString(entry, '')).filter(Boolean);
}

function cloneSerializableValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => cloneSerializableValue(entry));
    }
    if (typeof value === 'object') {
        const clone = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined || typeof entry === 'function') {
                continue;
            }
            clone[key] = cloneSerializableValue(entry);
        }
        return clone;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    return String(value);
}

function createVector3Projection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        x: normalizeNumber(source.x, 0),
        y: normalizeNumber(source.y, 0),
        z: normalizeNumber(source.z, 0),
    };
}

function createQuaternionProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        x: normalizeNumber(source.x, 0),
        y: normalizeNumber(source.y, 0),
        z: normalizeNumber(source.z, 0),
        w: normalizeNumber(source.w, 1),
    };
}

function createSessionPlayerProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        playerIndex: normalizeInt(source.playerIndex, -1),
        playerId: normalizeString(source.playerId, ''),
        pingMs: normalizeInt(source.pingMs, -1),
        isLocal: source.isLocal === true,
    };
}

function createLockTargetProjection(value = null) {
    if (!value || typeof value !== 'object') return null;
    return {
        playerIndex: normalizeInt(value.playerIndex, -1),
        targetPlayerIndex: normalizeInt(value.targetPlayerIndex, -1),
        alive: value.alive !== false,
        position: createVector3Projection(value.position),
    };
}

function createDamageIndicatorProjection(value = null, nowMs = 0) {
    if (!value || typeof value !== 'object') return null;
    const expiresAtMs = Math.max(0, normalizeNumber(value.expiresAtMs, 0));
    const fallbackRemainingMs = Math.max(0, normalizeNumber(value.remainingMs, normalizeNumber(value.ttl, 0) * 1000));
    const remainingMs = expiresAtMs > 0
        ? Math.max(0, expiresAtMs - nowMs)
        : fallbackRemainingMs;
    return {
        angleDeg: normalizeNumber(value.angleDeg, 0),
        intensity: normalizeNumber(value.intensity, 0),
        expiresAtMs,
        remainingMs,
        sequence: normalizeNonNegativeInt(value.sequence, 0),
    };
}

function createExitPortalTraversalProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    const totalCount = normalizeNonNegativeInt(source.totalCount, 0);
    const activeCount = Math.min(totalCount, normalizeNonNegativeInt(source.activeCount, 0));
    const inactiveCount = Math.max(0, totalCount - activeCount);
    return {
        totalCount,
        activeCount,
        inactiveCount,
    };
}

function createTraversalProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    // P28: traversal stayed additive inside v1; absent producer fields normalize to v1-safe defaults.
    return {
        portalsEnabled: source.portalsEnabled !== false,
        portalCooldownRemaining: Math.max(0, normalizeNumber(source.portalCooldownRemaining, 0)),
        gateCooldownRemaining: Math.max(0, normalizeNumber(source.gateCooldownRemaining, 0)),
        gateCount: normalizeNonNegativeInt(source.gateCount, 0),
        exitPortal: createExitPortalTraversalProjection(source.exitPortal),
        exitPortalCooldownRemaining: Math.max(0, normalizeNumber(source.exitPortalCooldownRemaining, 0)),
        postPortalActive: source.postPortalActive === true,
        postPortalRemainingSeconds: Math.max(0, normalizeNumber(source.postPortalRemainingSeconds, 0)),
        lastPortalTravelAtMs: Math.max(0, normalizeInt(source.lastPortalTravelAtMs, 0)),
    };
}

function createExclusionZoneProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    const phase = ['SAFE', 'GRACE', 'SALVO'].includes(source.phase) ? source.phase : 'SAFE';
    return {
        phase,
        elapsedSeconds: Math.max(0, normalizeNumber(source.elapsedSeconds, 0)),
        countdownSeconds: Math.max(0, Math.ceil(normalizeNumber(source.countdownSeconds, 0))),
        stage: normalizeString(source.stage, ''),
    };
}

// The map expansion is the same for every player; it rides on each player projection because
// every HUD instance draws its own copy of the announcement.
function createMapExpansionProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    const phase = ['TELEGRAPH', 'OPENING'].includes(source.phase) ? source.phase : 'IDLE';
    const active = source.active === true && phase !== 'IDLE';
    return {
        active,
        phase: active ? phase : 'IDLE',
        secondsUntilOpen: active ? Math.max(0, normalizeNumber(source.secondsUntilOpen, 0)) : 0,
        label: active ? normalizeString(source.label, '').slice(0, 40) : '',
    };
}

// The destructible map is the same for every player and rides along for the same reason as the
// expansion: each HUD instance draws its own copy of the tower's condition.
function createMapDestructibleProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    const active = source.active === true;
    const focus = source.focusSegment && typeof source.focusSegment === 'object'
        ? source.focusSegment
        : null;
    return {
        active,
        sealed: source.sealed === true,
        focusSegment: active && focus ? {
            id: normalizeString(focus.id, '').slice(0, 80),
            label: normalizeString(focus.label, '').slice(0, 40),
            ratio: Math.max(0, Math.min(1, normalizeNumber(focus.ratio, 0))),
        } : null,
        breakingSecondsRemaining: active
            ? Math.max(0, normalizeNumber(source.breakingSecondsRemaining, 0))
            : 0,
    };
}

const ROCKET_THREAT_PROJECTION_SOURCES = Object.freeze(['player', 'turret', 'zone']);

/**
 * How many homing rockets are chasing this player right now, and from where.
 *
 * Additive v1 field: a producer that does not know it yields the inactive default.
 * The tracker behind it reuses one object per player every frame, so this always
 * returns a fresh copy - a HUD may hold on to it for a frame without seeing it change
 * under its hands. `count` is the single source of truth: no rocket, no warning.
 */
export function createRocketThreatProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    const count = normalizeNonNegativeInt(source.count, 0);
    const active = count > 0;
    // The tracker names its nearest-rocket source `nearestSource`; both spellings are accepted.
    const threatSource = normalizeString(source.source, normalizeString(source.nearestSource, ''));
    return {
        active,
        count,
        nearestDistance: active ? Math.max(0, normalizeNumber(source.nearestDistance, 0)) : 0,
        // 0 seconds means unknown: the rocket is locked on but not closing in.
        timeToImpactSeconds: active ? Math.max(0, normalizeNumber(source.timeToImpactSeconds, 0)) : 0,
        direction: createVector3Projection(active ? source.direction : null),
        source: active && ROCKET_THREAT_PROJECTION_SOURCES.includes(threatSource) ? threatSource : '',
    };
}

/**
 * How long this player may still stay in the hidden room he is standing in.
 *
 * Additive v1 field: a producer that knows no secret rooms yields "outside", and so does anything
 * unreadable - a HUD must never count down for a player who is not in a room at all.
 */
function createSecretRoomProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    const inside = source.inside === true;
    return {
        inside,
        remainingSeconds: inside ? Math.max(0, normalizeNumber(source.remainingSeconds, 0)) : 0,
        roomId: inside ? normalizeString(source.roomId, '').slice(0, 80) : '',
    };
}

function createPlayerProjection(value = null) {
    if (!value || typeof value !== 'object') return null;
    return {
        playerIndex: normalizeNonNegativeInt(value.playerIndex, 0),
        name: normalizeString(value.name, '').trim(),
        isBot: value.isBot === true,
        alive: value.alive !== false,
        score: normalizeInt(value.score, 0),
        speed: normalizeNumber(value.speed, 0),
        boostCharge: Math.max(0, normalizeNumber(value.boostCharge, 0)),
        boostCapacity: Math.max(0.001, normalizeNumber(value.boostCapacity, 1)),
        boostRecharging: value.boostRecharging === true,
        slowMoCharge: Math.max(0, normalizeNumber(value.slowMoCharge, 0)),
        slowMoCapacity: Math.max(0.001, normalizeNumber(value.slowMoCapacity, 1)),
        slowMoRecharging: value.slowMoRecharging === true,
        slowMoActive: value.slowMoActive === true,
        // Seconds the railgun has been charged, 0 while the key is up.
        railCharge: Math.max(0, normalizeNumber(value.railCharge, 0)),
        hp: Math.max(0, normalizeNumber(value.hp, 0)),
        maxHp: Math.max(1, normalizeNumber(value.maxHp, 1)),
        shieldHP: Math.max(0, normalizeNumber(value.shieldHP, 0)),
        maxShieldHp: Math.max(1, normalizeNumber(value.maxShieldHp, 1)),
        position: createVector3Projection(value.position),
        quaternion: createQuaternionProjection(value.quaternion),
        aimDirection: createVector3Projection(value.aimDirection),
        inventory: cloneStringArray(value.inventory),
        rocketInventory: cloneStringArray(value.rocketInventory),
        activeEffects: Array.isArray(value.activeEffects) ? value.activeEffects
            .map((effect) => {
                const type = normalizeString(effect?.type, '').trim().toUpperCase();
                if (!type) return null;
                /** @type {{ type: string, remaining: number, sourcePlayerIndex: number | null, fuelSeconds?: number, shots?: number }} */
                const projected = {
                    type,
                    remaining: Math.max(0, normalizeNumber(effect?.remaining, 0)),
                    sourcePlayerIndex: Number.isInteger(effect?.sourcePlayerIndex)
                        ? effect.sourcePlayerIndex
                        : null,
                };
                // Additive: the flamethrower tank, which the item bar shows instead of the expiry.
                const fuelSeconds = Number(effect?.fuelSeconds);
                if (Number.isFinite(fuelSeconds) && fuelSeconds >= 0) projected.fuelSeconds = fuelSeconds;
                // Additive: the railgun's remaining shots, shown instead of the expiry.
                const shots = Number(effect?.shots);
                if (Number.isFinite(shots) && shots >= 0) projected.shots = Math.trunc(shots);
                return projected;
            })
            .filter(Boolean) : [],
        selectedItemIndex: normalizeInt(value.selectedItemIndex, 0),
        itemUseCooldownRemaining: Math.max(0, normalizeNumber(value.itemUseCooldownRemaining, 0)),
        shootCooldown: Math.max(0, normalizeNumber(value.shootCooldown, 0)),
        planarMode: value.planarMode === true,
        cameraModeId: normalizeString(value.cameraModeId, GAMEPLAY_CAMERA_MODE_ID),
        exclusionZoneState: createExclusionZoneProjection(value.exclusionZoneState),
        rocketThreat: createRocketThreatProjection(value.rocketThreat),
        mapExpansion: createMapExpansionProjection(value.mapExpansion),
        mapDestructible: createMapDestructibleProjection(value.mapDestructible),
        secretRoom: createSecretRoomProjection(value.secretRoom),
        // Match wide, like the expansion above: opened rooms that had to be unlocked first.
        secretRoomsOpen: normalizeNonNegativeInt(value.secretRoomsOpen, 0),
        traversal: createTraversalProjection(value.traversal),
        turrets: Array.isArray(value.turrets) ? value.turrets.filter((entry) => entry && (entry.weapon === 'mg' || entry.weapon === 'rocket')).map((entry) => ({
            weapon: entry.weapon,
            count: normalizeNonNegativeInt(entry.count, 0),
            remainingSeconds: Math.max(0, normalizeNumber(entry.remainingSeconds, 0)),
            hp: Math.max(0, normalizeNumber(entry.hp, 0)),
            maxHp: Math.max(1, normalizeNumber(entry.maxHp, 1)),
            range: Math.max(0, normalizeNumber(entry.range, 0)),
        })) : [],
        turret: value.turret && typeof value.turret === 'object' ? {
            count: normalizeNonNegativeInt(value.turret.count, 0),
            remainingSeconds: Math.max(0, normalizeNumber(value.turret.remainingSeconds, 0)),
            hp: Math.max(0, normalizeNumber(value.turret.hp, 0)),
            maxHp: Math.max(1, normalizeNumber(value.turret.maxHp, 1)),
            range: Math.max(0, normalizeNumber(value.turret.range, 0)),
        } : null,
    };
}

function createParcoursProjection(value = null) {
    if (!value || typeof value !== 'object' || value.enabled !== true) {
        return {
            enabled: false,
            routeId: '',
            totalCheckpoints: 0,
            currentCheckpoint: 0,
            passedCheckpointIds: [],
            expectedCheckpointLabels: [],
            completed: false,
            completionTimeMs: 0,
            segmentElapsedMs: 0,
            hasError: false,
            errorMessage: '',
        };
    }
    return {
        enabled: true,
        routeId: normalizeString(value.routeId, ''),
        totalCheckpoints: normalizeNonNegativeInt(value.totalCheckpoints, 0),
        currentCheckpoint: normalizeNonNegativeInt(value.currentCheckpoint, 0),
        passedCheckpointIds: cloneStringArray(value.passedCheckpointIds),
        expectedCheckpointLabels: cloneStringArray(value.expectedCheckpointLabels),
        completed: value.completed === true,
        completionTimeMs: Math.max(0, normalizeNumber(value.completionTimeMs, 0)),
        segmentElapsedMs: Math.max(0, normalizeNumber(value.segmentElapsedMs, 0)),
        hasError: value.hasError === true,
        errorMessage: normalizeString(value.errorMessage, ''),
    };
}

function createHuntProjection(value = null, nowMs = 0) {
    const source = value && typeof value === 'object' ? value : {};
    const overheatByPlayer = {};
    const overheatSource = source.overheatByPlayer && typeof source.overheatByPlayer === 'object'
        ? source.overheatByPlayer
        : {};
    for (const [key, entry] of Object.entries(overheatSource)) {
        overheatByPlayer[key] = Math.max(0, normalizeNumber(entry, 0));
    }

    const damageIndicatorsByPlayer = {};
    const indicatorSource = source.damageIndicatorsByPlayer && typeof source.damageIndicatorsByPlayer === 'object'
        ? source.damageIndicatorsByPlayer
        : {};
    for (const [key, entry] of Object.entries(indicatorSource)) {
        const normalized = createDamageIndicatorProjection(entry, nowMs);
        if (normalized) {
            damageIndicatorsByPlayer[key] = normalized;
        }
    }

    const legacyIndicator = createDamageIndicatorProjection(source.damageIndicator, nowMs);
    const scoreboardRows = Array.isArray(source.scoreboardRows)
        ? source.scoreboardRows.map((row) => ({
            playerIndex: normalizeNonNegativeInt(row?.playerIndex, 0),
            teamId: normalizeTeamId(row?.teamId),
            playerIndices: Array.isArray(row?.playerIndices)
                ? row.playerIndices.map((index) => normalizeNonNegativeInt(index, 0))
                : [],
            label: normalizeString(row?.label, ''),
            kills: normalizeNonNegativeInt(row?.kills, 0),
            deaths: normalizeNonNegativeInt(row?.deaths, 0),
            assists: normalizeNonNegativeInt(row?.assists, 0),
            damage: normalizeNonNegativeInt(row?.damage, 0),
            shieldDamage: normalizeNonNegativeInt(row?.shieldDamage, 0),
            spawnDeaths: normalizeNonNegativeInt(row?.spawnDeaths, 0),
            // Rockets shot down by this player (E38). Statistics only, never a kill (E75).
            intercepts: normalizeNonNegativeInt(row?.intercepts, 0),
            // Tanks destroyed by this player (E19). Statistics and arcade XP only, never a kill.
            unitsDestroyed: normalizeNonNegativeInt(row?.unitsDestroyed, 0),
            unitDestroyedXp: normalizeNonNegativeInt(row?.unitDestroyedXp, 0),
            burnedTrailMeters: Math.max(0, normalizeNumber(row?.burnedTrailMeters, 0)),
            flagCaptures: normalizeNonNegativeInt(row?.flagCaptures, 0),
            repairDroneHpRestored: Math.max(0, normalizeNumber(row?.repairDroneHpRestored, 0)),
            points: normalizeNonNegativeInt(row?.points, 0),
        }))
        : [];
    const respawnRemainingByPlayer = {};
    const respawnSource = source.respawnRemainingByPlayer && typeof source.respawnRemainingByPlayer === 'object'
        ? source.respawnRemainingByPlayer
        : {};
    for (const [key, entry] of Object.entries(respawnSource)) {
        respawnRemainingByPlayer[key] = Math.max(0, normalizeNumber(entry, 0));
    }
    return {
        active: source.active === true,
        killFeed: cloneStringArray(source.killFeed),
        overheatByPlayer,
        damageIndicatorsByPlayer,
        damageIndicator: legacyIndicator,
        respawnEnabled: source.respawnEnabled === true,
        deathmatchKillLimit: Math.max(1, normalizeNonNegativeInt(source.deathmatchKillLimit, 10)),
        winCondition: normalizeHuntWinCondition(source.winCondition),
        respawnRemainingByPlayer,
        livesRemainingByPlayer: normalizeHuntLivesByPlayer(source.livesRemainingByPlayer),
        scoreboardRows,
        scoreboardSummary: normalizeString(source.scoreboardSummary, ''),
        elapsedSeconds: Math.max(0, normalizeNumber(source.elapsedSeconds, 0)),
        timeLimitSeconds: Math.max(0, normalizeNumber(source.timeLimitSeconds, 0)),
        timeRemainingSeconds: Math.max(0, normalizeNumber(source.timeRemainingSeconds, 0)),
        overtime: source.overtime === true,
        authoritativeClient: source.authoritativeClient === true,
        teamMode: source.teamMode === true,
        escortMode: source.escortMode === true,
        teamObjective: ['FLAGS', 'ESCORT'].includes(String(source.teamObjective || '').toUpperCase())
            ? String(source.teamObjective).toUpperCase()
            : 'HUNT',
        flagCounts: source.flagCounts && typeof source.flagCounts === 'object'
            ? { ALPHA: normalizeNonNegativeInt(source.flagCounts.ALPHA, 0), BRAVO: normalizeNonNegativeInt(source.flagCounts.BRAVO, 0) }
            : null,
    };
}

export function createMatchRuntimePlayerProjection(value = null) {
    return createPlayerProjection(value);
}

export function createMatchRuntimeSessionPlayerProjection(value = null) {
    return createSessionPlayerProjection(value);
}

export function createMatchRuntimeLockTargetProjection(value = null) {
    return createLockTargetProjection(value);
}

function createArcadeProjection(value = null) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return /** @type {any} */ (cloneSerializableValue(value));
}

export function classifyMatchRuntimeProjectionVersion(payload = {}) {
    return resolveArtifactVersionState(payload, {
        artifactType: 'match-runtime-projection',
        versionFields: MATCH_RUNTIME_PROJECTION_VERSION_FIELDS,
        supportedVersions: MATCH_RUNTIME_PROJECTION_SUPPORTED_VERSIONS,
        currentVersion: MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION,
        allowMissingVersion: true,
    });
}

function resolveMatchRuntimeProjectionSource(payload = {}) {
    const source = /** @type {any} */ (payload && typeof payload === 'object' ? payload : {});
    const versionState = classifyMatchRuntimeProjectionVersion(source);
    return versionState.shouldReject ? {} : source;
}

function createProjectionFromSource(source, players, sessionPlayers, lockTargets) {
    const updatedAt = Math.max(0, normalizeNumber(source.updatedAt, Date.now()));
    return {
        contractVersion: MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION,
        updatedAt,
        gameStateId: normalizeString(source.gameStateId, ''),
        modeId: normalizeString(source.modeId, ''),
        combatModeId: normalizeString(source.combatModeId, source.modeId || ''),
        isNetworkSession: source.isNetworkSession === true,
        localPlayerIndex: Math.max(0, normalizeInt(source.localPlayerIndex, 0)),
        localHumanCount: Math.max(1, normalizeNonNegativeInt(source.localHumanCount, 1)),
        players,
        sessionPlayers,
        lockTargets,
        globalFog: createGlobalFogEffectState(source.globalFog),
        parcours: createParcoursProjection(source.parcours),
        hunt: createHuntProjection(source.hunt, updatedAt),
        arcade: createArcadeProjection(source.arcade),
    };
}

export function createMatchRuntimeProjection(payload = {}) {
    const source = resolveMatchRuntimeProjectionSource(payload);
    const players = Array.isArray(source.players)
        ? source.players.map((entry) => createPlayerProjection(entry)).filter(Boolean)
        : [];
    const sessionPlayers = Array.isArray(source.sessionPlayers)
        ? source.sessionPlayers.map((entry) => createSessionPlayerProjection(entry))
        : [];
    const lockTargets = Array.isArray(source.lockTargets)
        ? source.lockTargets.map((entry) => createLockTargetProjection(entry)).filter(Boolean)
        : [];
    return createProjectionFromSource(source, players, sessionPlayers, lockTargets);
}

export function assembleMatchRuntimeProjection(payload = {}) {
    const source = resolveMatchRuntimeProjectionSource(payload);
    const players = Array.isArray(source.players) ? source.players.filter(Boolean) : [];
    const sessionPlayers = Array.isArray(source.sessionPlayers) ? source.sessionPlayers.filter(Boolean) : [];
    const lockTargets = Array.isArray(source.lockTargets) ? source.lockTargets.filter(Boolean) : [];
    return createProjectionFromSource(source, players, sessionPlayers, lockTargets);
}

export const normalizeMatchRuntimeProjection = createMatchRuntimeProjection;
