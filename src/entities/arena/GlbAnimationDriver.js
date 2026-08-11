import {
    normalizeMapAnimationClock,
    resolveMapAnimationClipPhase,
} from '../../shared/contracts/MapAnimationClockContract.js';

/**
 * One animated GLB setpiece: the mixer that owns its pose, the action that plays its clip
 * and the clock that decides where in the clip it stands at a given point in the match.
 * @param {{ mixer: any, action: any, clip: any, clock?: unknown }} source
 */
export function createGlbAnimationTrack(source) {
    const duration = Number(source?.clip?.duration);
    return {
        mixer: source.mixer,
        action: source.action,
        clipName: String(source?.clip?.name || ''),
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
        clock: normalizeMapAnimationClock(source?.clock),
    };
}

/**
 * Drives every animated setpiece of a map from one elapsed match time.
 *
 * The pose is computed from that time instead of being advanced frame by frame. Two
 * consequences follow, and both are the point of this class: a setpiece can sit on an
 * offset phase of the map beat without a staggered start, and a client whose frame deltas
 * differ still shows the same pose at the same match time. setElapsedSeconds is the seam
 * through which an authoritative time — a round restart, a host update — takes over.
 */
export class GlbAnimationDriver {
    constructor() {
        this._tracks = [];
        this._elapsedSeconds = 0;
    }

    get elapsedSeconds() {
        return this._elapsedSeconds;
    }

    get trackCount() {
        return this._tracks.length;
    }

    setTracks(tracks) {
        this._tracks = Array.isArray(tracks) ? tracks.filter((track) => track?.action && track?.mixer) : [];
        this._elapsedSeconds = 0;
        this._applyPhase();
    }

    setElapsedSeconds(seconds) {
        const parsed = Number(seconds);
        this._elapsedSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    advance(dt) {
        const step = Number(dt);
        if (Number.isFinite(step) && step > 0) this._elapsedSeconds += step;
        this._applyPhase();
    }

    clear() {
        const roots = new Set();
        for (const track of this._tracks) {
            if (roots.has(track.mixer)) continue;
            roots.add(track.mixer);
            track.mixer.stopAllAction();
            track.mixer.uncacheRoot(track.mixer.getRoot());
        }
        this._tracks.length = 0;
        this._elapsedSeconds = 0;
    }

    _applyPhase() {
        for (const track of this._tracks) {
            track.action.time = resolveMapAnimationClipPhase(
                this._elapsedSeconds,
                track.clock,
                track.durationSeconds,
            );
            // A zero step writes the pose for the time just assigned without advancing it.
            track.mixer.update(0);
        }
    }
}
