import * as THREE from 'three';
import { CinematicReplayExportController } from './CinematicReplayExportController.js';
import { updateReplayProjection } from './CinematicReplayProjection.js';
import { createCameraVisibilitySampler } from './MarketingCameraQuality.js';

const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Continuous orbit -> recorded human camera -> orbit. The same source time is
// used on both sides of every blend; no second simulation generates the action.
export function createMarketingCamera(template, subjects, startMs, durationMs) {
    const camera = template.clone();
    const orbit = template.clone();
    const focus = new THREE.Vector3();
    const target = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    return (projection, timeMs) => {
        const first = projection.players.find((p) => p.playerIndex === subjects[0]);
        const second = projection.players.find((p) => p.playerIndex === subjects[1]);
        const recorded = projection.recordedCamera;
        if (!first || !second || !recorded) throw new Error('camera_subject_or_pose_missing');
        focus.copy(first.position).add(second.position).multiplyScalar(0.5);
        const distance = new THREE.Vector3().copy(first.position).distanceTo(second.position);
        const angle = (timeMs - startMs) / 1000 * 0.035;
        // Portrait needs a wider distance than landscape to retain both pilots.
        const radius = Math.max(35, distance * 1.9);
        orbit.position.set(focus.x + Math.cos(angle) * radius, focus.y + radius * 0.3, focus.z + Math.sin(angle) * radius);
        orbit.lookAt(focus); orbit.fov = 58;
        const progress = Math.max(0, Math.min(1, (timeMs - startMs) / durationMs));
        const mix = progress < 0.2 ? 0 : progress < 0.35 ? smooth((progress - 0.2) / 0.15)
            : progress < 0.7 ? 1 : progress < 0.85 ? 1 - smooth((progress - 0.7) / 0.15) : 0;
        target.set(recorded.position.x, recorded.position.y, recorded.position.z);
        rotation.set(recorded.quaternion.x, recorded.quaternion.y, recorded.quaternion.z, recorded.quaternion.w);
        camera.position.copy(orbit.position).lerp(target, mix);
        camera.quaternion.copy(orbit.quaternion).slerp(rotation, mix);
        camera.fov = orbit.fov + (recorded.fov - orbit.fov) * mix;
        return { ...recorded, position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            quaternion: { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w },
            fov: camera.fov, aspect: 9 / 16 };
    };
}

export async function renderMarketingReplay(game, replay, bridge) {
    try {
        const base = game.mediaRecorderSystem?._cinematicReplayExporter?.renderFrame;
        if (!base) throw new Error('replay_renderer_unavailable');
        game.settings.recording = { ...game.settings.recording, profile: 'cinematic', orientation: 'portrait', hudMode: 'clean' };
        game.renderer.setRecordingCaptureSettings(game.settings.recording);
        const camera = createMarketingCamera(new THREE.PerspectiveCamera(58, 9 / 16, 0.1, 2000), replay.subjects,
            replay.exportStartMs, replay.durationMs - replay.exportStartMs);
        const cameraSamples = [];
        const visibilitySamples = [], visibility = createCameraVisibilitySampler();
        const warmProjection = { players: [], localPlayerIndex: replay.subjects[0] };
        let batch = [], batchIndex = 0, exhausted = false;
        const nextSnapshot = async () => {
            if (batchIndex >= batch.length && !exhausted) {
                batch = await bridge.replayBatch(); batchIndex = 0;
                if (!batch.length) exhausted = true;
            }
            return batch[batchIndex++] || null;
        };
        let left = await nextSnapshot();
        let right = await nextSnapshot();
        let warmIndex = 0;
        while (right && right.timeMs <= replay.exportStartMs) {
            updateReplayProjection(warmProjection, left, left, 0, replay.metadata);
            await base({ replay, projection: warmProjection, leftSnapshot: left, rightSnapshot: left,
                frameIndex: warmIndex++, timeMs: left.timeMs,
                dt: Math.max(0.001, (right.timeMs - left.timeMs) / 1000), warmup: true });
            left = right; right = await nextSnapshot();
            if (warmIndex % 120 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!left || !right) throw new Error('replay_stream_incomplete');
        replay.snapshots = [left, right];
        replay.nextSnapshot = nextSnapshot;
        const exporter = new CinematicReplayExportController({ resolveExportFormat: () => ({ width: 1080, height: 1920, fps: 60 }),
            renderFrame: async (frame) => {
                if (frame.reset) return base(frame);
                frame.projection.recordedCamera = camera(frame.projection, frame.timeMs);
                cameraSamples.push({ frame: frame.frameIndex, timeMs: frame.timeMs,
                    ...structuredClone(frame.projection.recordedCamera) });
                return base({ ...frame, frameIndex: frame.frameIndex + 1,
                    inspectScene: ({ arena }) => visibilitySamples.push({ timeMs: frame.timeMs,
                        subjects: visibility(frame.projection.recordedCamera, frame.projection.players, replay.subjects, arena) }) });
            } });
        const result = await exporter.export(replay);
        return { ...result, cameraSamples, visibilitySamples, visualReviewRequired: true };
    } catch (error) { return { saved: false, reason: error.message }; }
}
