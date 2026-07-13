import { normalizeString } from './ContractNormalizeUtils.js';

const DEFAULT_GHOST_COLOR = 0xffffff;
const DEFAULT_GHOST_MODEL_SCALE = 1;
const MIN_GHOST_MODEL_SCALE = 0.6;
const GHOST_POSITION_PRECISION = 10;
const GHOST_QUATERNION_PRECISION = 10000;
const GHOST_TIME_PRECISION = 1000;
const MIN_GHOST_FRAME_COUNT = 2;
const MIN_GHOST_DURATION_SECONDS = 0.0001;

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function roundTo(value, precision) {
    return Math.round(value * precision) / precision;
}

function normalizePlayerIndex(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function normalizePositiveSeconds(value, fallback = 0) {
    const numeric = toFiniteNumber(value);
    return numeric != null && numeric > 0
        ? Math.max(MIN_GHOST_DURATION_SECONDS, roundTo(numeric, GHOST_TIME_PRECISION))
        : fallback;
}

function normalizeGhostColor(value) {
    const numeric = toFiniteNumber(value);
    return numeric != null ? Math.max(0, Math.trunc(numeric)) : DEFAULT_GHOST_COLOR;
}

function normalizeMaxFrameBudget(value) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric)) return 0;
    return numeric >= MIN_GHOST_FRAME_COUNT ? numeric : 0;
}

function createGhostClipNormalizationStats(sourceFrameCount = 0) {
    return {
        sourceFrameCount: Math.max(0, Math.trunc(Number(sourceFrameCount) || 0)),
        normalizedFrameCount: 0,
        trimmedFrames: 0,
        normalizeDurationMs: 0,
    };
}

function normalizeGhostQuaternion(rawPose) {
    const qx = toFiniteNumber(rawPose?.qx ?? rawPose?.quaternion?.x);
    const qy = toFiniteNumber(rawPose?.qy ?? rawPose?.quaternion?.y);
    const qz = toFiniteNumber(rawPose?.qz ?? rawPose?.quaternion?.z);
    const qw = toFiniteNumber(rawPose?.qw ?? rawPose?.quaternion?.w);
    if (qx == null || qy == null || qz == null || qw == null) {
        return { qx: 0, qy: 0, qz: 0, qw: 1 };
    }

    const lengthSq = (qx * qx) + (qy * qy) + (qz * qz) + (qw * qw);
    if (!Number.isFinite(lengthSq) || lengthSq <= 1e-8) {
        return { qx: 0, qy: 0, qz: 0, qw: 1 };
    }

    const inverseLength = 1 / Math.sqrt(lengthSq);
    return {
        qx: roundTo(qx * inverseLength, GHOST_QUATERNION_PRECISION),
        qy: roundTo(qy * inverseLength, GHOST_QUATERNION_PRECISION),
        qz: roundTo(qz * inverseLength, GHOST_QUATERNION_PRECISION),
        qw: roundTo(qw * inverseLength, GHOST_QUATERNION_PRECISION),
    };
}

function normalizeGhostPose(rawPose) {
    const idx = normalizePlayerIndex(rawPose?.idx ?? rawPose?.index);
    if (idx == null) return null;

    const x = toFiniteNumber(rawPose?.x ?? rawPose?.position?.x);
    const y = toFiniteNumber(rawPose?.y ?? rawPose?.position?.y);
    const z = toFiniteNumber(rawPose?.z ?? rawPose?.position?.z);
    if (x == null || y == null || z == null) return null;

    return {
        idx,
        alive: rawPose?.alive !== false,
        x: roundTo(x, GHOST_POSITION_PRECISION),
        y: roundTo(y, GHOST_POSITION_PRECISION),
        z: roundTo(z, GHOST_POSITION_PRECISION),
        ...normalizeGhostQuaternion(rawPose),
        bot: rawPose?.bot === true || rawPose?.isBot === true,
    };
}

function normalizeGhostFrames(frames) {
    const safeFrames = Array.isArray(frames) ? frames : [];
    if (safeFrames.length < MIN_GHOST_FRAME_COUNT) {
        return {
            frames: [],
            poseStats: new Map(),
            hasDuplicatePlayerPose: false,
        };
    }

    const normalizedFrames = new Array(safeFrames.length);
    const poseStats = new Map();
    let previousTime = 0;

    for (let frameIndex = 0; frameIndex < safeFrames.length; frameIndex += 1) {
        const rawFrame = safeFrames[frameIndex];
        const rawPlayers = Array.isArray(rawFrame?.players) ? rawFrame.players : [];
        const framePlayers = [];
        const playerIds = new Set();
        let duplicatePlayerPose = false;

        for (let poseIndex = 0; poseIndex < rawPlayers.length; poseIndex += 1) {
            const normalizedPose = normalizeGhostPose(rawPlayers[poseIndex]);
            if (!normalizedPose) continue;
            if (playerIds.has(normalizedPose.idx)) {
                duplicatePlayerPose = true;
                break;
            }
            playerIds.add(normalizedPose.idx);
            framePlayers.push(normalizedPose);

            const existingStat = poseStats.get(normalizedPose.idx) || { count: 0, isBot: false };
            existingStat.count += 1;
            existingStat.isBot = existingStat.isBot || normalizedPose.bot === true;
            poseStats.set(normalizedPose.idx, existingStat);
        }

        if (duplicatePlayerPose) {
            return {
                frames: [],
                poseStats: new Map(),
                hasDuplicatePlayerPose: true,
            };
        }

        const rawTime = toFiniteNumber(rawFrame?.time);
        const normalizedTime = rawTime != null && rawTime >= 0
            ? Math.max(previousTime, rawTime)
            : previousTime;
        previousTime = normalizedTime;

        framePlayers.sort((left, right) => left.idx - right.idx);
        normalizedFrames[frameIndex] = {
            time: roundTo(normalizedTime, GHOST_TIME_PRECISION),
            players: framePlayers,
        };
    }

    return {
        frames: normalizedFrames,
        poseStats,
        hasDuplicatePlayerPose: false,
    };
}

function createPlayerMetaFromPoseStats(poseStats) {
    const normalizedPlayers = [];
    for (const [idx, stats] of poseStats.entries()) {
        normalizedPlayers.push({
            idx,
            color: DEFAULT_GHOST_COLOR,
            isBot: stats?.isBot === true,
            modelScale: DEFAULT_GHOST_MODEL_SCALE,
        });
    }
    normalizedPlayers.sort((left, right) => left.idx - right.idx);
    return normalizedPlayers;
}

function filterGhostFramesToPlayers(frames, players) {
    const allowedPlayerIds = new Set(players.map((player) => player.idx));
    const filteredFrames = new Array(frames.length);
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        const frame = frames[frameIndex];
        const sourcePlayers = Array.isArray(frame?.players) ? frame.players : [];
        const nextPlayers = [];
        for (let poseIndex = 0; poseIndex < sourcePlayers.length; poseIndex += 1) {
            const pose = sourcePlayers[poseIndex];
            if (!allowedPlayerIds.has(pose.idx)) continue;
            nextPlayers.push(pose);
        }
        filteredFrames[frameIndex] = {
            time: Number(frame?.time) || 0,
            players: nextPlayers,
        };
    }
    return filteredFrames;
}

function hasRenderablePose(frames) {
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        const framePlayers = Array.isArray(frames[frameIndex]?.players) ? frames[frameIndex].players : [];
        for (let poseIndex = 0; poseIndex < framePlayers.length; poseIndex += 1) {
            if (framePlayers[poseIndex]?.alive !== false) {
                return true;
            }
        }
    }
    return false;
}

function buildFrameIndexSelection(totalFrames, maxFrames) {
    if (totalFrames <= maxFrames) {
        const full = new Array(totalFrames);
        for (let idx = 0; idx < totalFrames; idx += 1) {
            full[idx] = idx;
        }
        return full;
    }

    const selected = new Array(maxFrames);
    selected[0] = 0;
    selected[maxFrames - 1] = totalFrames - 1;
    let previousIndex = 0;

    for (let slot = 1; slot < maxFrames - 1; slot += 1) {
        const remainingSlots = (maxFrames - 1) - slot;
        const idealIndex = Math.round((slot * (totalFrames - 1)) / (maxFrames - 1));
        const minAllowed = previousIndex + 1;
        const maxAllowed = (totalFrames - 1) - remainingSlots;
        const clamped = Math.max(minAllowed, Math.min(maxAllowed, idealIndex));
        selected[slot] = clamped;
        previousIndex = clamped;
    }

    return selected;
}

function applyFrameBudget(frames, maxFrames) {
    const safeMaxFrames = normalizeMaxFrameBudget(maxFrames);
    if (safeMaxFrames <= 0 || frames.length <= safeMaxFrames) {
        return {
            frames,
            trimmedFrames: 0,
        };
    }
    const selectedIndices = buildFrameIndexSelection(frames.length, safeMaxFrames);
    const cappedFrames = new Array(selectedIndices.length);
    for (let i = 0; i < selectedIndices.length; i += 1) {
        cappedFrames[i] = frames[selectedIndices[i]];
    }
    if (!hasRenderablePose(cappedFrames)) {
        return {
            frames,
            trimmedFrames: 0,
        };
    }
    return {
        frames: cappedFrames,
        trimmedFrames: Math.max(0, frames.length - cappedFrames.length),
    };
}

function normalizeGhostPlayers(players, poseStats, options = {}) {
    const explicitPlayers = Array.isArray(players) ? players : [];
    const normalizedPlayersByIdx = new Map();

    for (let index = 0; index < explicitPlayers.length; index += 1) {
        const normalizedPlayer = normalizeGhostPlayerMeta(explicitPlayers[index]);
        if (!normalizedPlayer) continue;
        normalizedPlayersByIdx.set(normalizedPlayer.idx, normalizedPlayer);
    }

    if (normalizedPlayersByIdx.size > 0) {
        return [...normalizedPlayersByIdx.values()].sort((left, right) => left.idx - right.idx);
    }

    if (options.allowPlayerReconstruction === false) return [];
    return createPlayerMetaFromPoseStats(poseStats);
}

function alignGhostFrameTimes(frames, sourceDuration) {
    if (!Array.isArray(frames) || frames.length < MIN_GHOST_FRAME_COUNT || !(sourceDuration > 0)) {
        return;
    }

    const lastFrameIndex = frames.length - 1;
    const lastFrameTime = Number(frames[lastFrameIndex]?.time) || 0;

    if (lastFrameTime > 0) {
        const scale = sourceDuration / lastFrameTime;
        for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
            frames[frameIndex].time = roundTo(
                Math.max(0, Number(frames[frameIndex]?.time) || 0) * scale,
                GHOST_TIME_PRECISION
            );
        }
    } else {
        for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
            frames[frameIndex].time = roundTo(
                (sourceDuration * frameIndex) / lastFrameIndex,
                GHOST_TIME_PRECISION
            );
        }
    }

    frames[0].time = 0;
    for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
        frames[frameIndex].time = Math.max(frames[frameIndex - 1].time, frames[frameIndex].time);
    }
    frames[lastFrameIndex].time = roundTo(sourceDuration, GHOST_TIME_PRECISION);
}

function normalizeGhostClipResult(ghostClip, options = {}) {
    const startedAtMs = Date.now();
    const sourceFrameCount = Array.isArray(ghostClip?.frames) ? ghostClip.frames.length : 0;
    const stats = createGhostClipNormalizationStats(sourceFrameCount);
    if (!isPlainObject(ghostClip)) {
        stats.normalizeDurationMs = Math.max(0, Date.now() - startedAtMs);
        return { clip: null, reason: 'invalid_clip', stats };
    }

    const frameNormalization = normalizeGhostFrames(ghostClip.frames);
    if (frameNormalization.hasDuplicatePlayerPose) {
        stats.normalizeDurationMs = Math.max(0, Date.now() - startedAtMs);
        return { clip: null, reason: 'invalid_frames', stats };
    }

    const frames = frameNormalization.frames;
    if (frames.length < MIN_GHOST_FRAME_COUNT) {
        stats.normalizeDurationMs = Math.max(0, Date.now() - startedAtMs);
        return { clip: null, reason: 'invalid_frames', stats };
    }

    const lastFrameTime = Number(frames[frames.length - 1]?.time) || 0;
    const displayDurationFallback = normalizePositiveSeconds(ghostClip?.displayDuration, 0);
    const sourceDuration = normalizePositiveSeconds(
        ghostClip?.sourceDuration,
        Math.max(lastFrameTime, displayDurationFallback)
    );
    if (!(sourceDuration > 0)) {
        stats.normalizeDurationMs = Math.max(0, Date.now() - startedAtMs);
        return { clip: null, reason: 'invalid_duration', stats };
    }

    alignGhostFrameTimes(frames, sourceDuration);

    const players = normalizeGhostPlayers(ghostClip.players, frameNormalization.poseStats, options);
    if (players.length === 0) {
        stats.normalizeDurationMs = Math.max(0, Date.now() - startedAtMs);
        return { clip: null, reason: 'invalid_players', stats };
    }

    const filteredFrames = filterGhostFramesToPlayers(frames, players);
    if (!hasRenderablePose(filteredFrames)) {
        stats.normalizeDurationMs = Math.max(0, Date.now() - startedAtMs);
        return { clip: null, reason: 'not_renderable', stats };
    }
    const budgeted = applyFrameBudget(filteredFrames, options.maxFrames);

    const normalizedClip = {
        frames: budgeted.frames,
        players,
        sourceDuration,
        displayDuration: normalizePositiveSeconds(ghostClip?.displayDuration, sourceDuration),
    };

    const routeId = normalizeString(ghostClip.routeId, '');
    if (routeId) {
        normalizedClip.routeId = routeId;
    }
    stats.normalizedFrameCount = normalizedClip.frames.length;
    stats.trimmedFrames = budgeted.trimmedFrames;
    stats.normalizeDurationMs = Math.max(0, Date.now() - startedAtMs);

    return {
        clip: normalizedClip,
        reason: 'ok',
        stats,
    };
}

export function normalizeGhostPlayerMeta(player) {
    const idx = normalizePlayerIndex(player?.idx ?? player?.index);
    if (idx == null) return null;

    return {
        idx,
        color: normalizeGhostColor(player?.color),
        isBot: player?.isBot === true || player?.bot === true,
        modelScale: Math.max(
            MIN_GHOST_MODEL_SCALE,
            toFiniteNumber(player?.modelScale) ?? DEFAULT_GHOST_MODEL_SCALE
        ),
    };
}

export function normalizeGhostClip(ghostClip, options = {}) {
    return normalizeGhostClipResult(ghostClip, options).clip;
}

export function validateGhostClip(ghostClip, options = {}) {
    const result = normalizeGhostClipResult(ghostClip, options);
    return {
        valid: !!result.clip,
        reason: result.reason,
        clip: result.clip,
        stats: result.stats,
    };
}

export function normalizeGhostClipWithStats(ghostClip, options = {}) {
    const result = normalizeGhostClipResult(ghostClip, options);
    return {
        clip: result.clip,
        reason: result.reason,
        stats: result.stats,
    };
}
