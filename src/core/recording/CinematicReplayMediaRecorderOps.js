// @ts-nocheck

export function startCinematicReplay(system, trigger = null) {
    let audioSource = null;
    try {
        audioSource = system.replayAudioSourceResolver?.() || null;
    } catch (error) {
        system.logger?.warn?.('[MediaRecorderSystem] replay audio source failed', error);
    }
    const context = trigger?.context && typeof trigger.context === 'object' ? trigger.context : {};
    const result = system._cinematicReplayRecorder.start({
        matchId: context.sessionId || null,
        metadata: {
            ...context,
            captureProfile: system.recordingCaptureSettings?.profile || null,
            hudMode: system.recordingCaptureSettings?.hudMode || null,
            exportPreset: system.recordingCaptureSettings?.exportPreset || null,
            output: {
                width: 1920,
                height: 1080,
                fps: 60,
                container: 'mp4',
                codec: 'h264',
                pixelFormat: 'yuv420p',
            },
        },
        audioStream: audioSource?.stream || null,
        releaseAudioStream: audioSource?.release || null,
    });
    if (!result.started) {
        audioSource?.release?.();
        return system._buildStartResult(false, result.reason || 'replay_start_failed');
    }
    system._activeRecording = {
        startedAt: system.now(),
        trigger: trigger || null,
        captureProfile: system.recordingCaptureSettings?.profile || null,
        hudMode: system.recordingCaptureSettings?.hudMode || null,
        captureExportPreset: system.recordingCaptureSettings?.exportPreset || null,
        recorderEngine: 'cinematic-replay',
    };
    system._notifyRecordingStateChange(true, { mode: 'cinematic_replay' });
    return system._buildStartResult(true, 'started', {
        mode: 'cinematic_replay',
        matchId: result.matchId,
        recorderEngine: 'cinematic-replay',
        captureFps: system._cinematicReplayRecorder.sampleFps,
        deliveryContainer: 'mp4',
        captureProfile: system._activeRecording.captureProfile,
        hudMode: system._activeRecording.hudMode,
        captureExportPreset: system._activeRecording.captureExportPreset,
    });
}

export function captureCinematicReplayState(system, options = null) {
    if (!system._cinematicReplayRecorder.isRecording) return false;
    return system._cinematicReplayRecorder.capture(options || {});
}

export async function stopAndExportCinematicReplay(system, trigger = null) {
    if (system._pendingStop) return system._pendingStop;
    const operation = (async () => {
        const replay = await system._cinematicReplayRecorder.stop();
        if (!replay) return system._buildStopResult(false, 'replay_not_recording');
        system._activeRecording = {
            ...(system._activeRecording || {}),
            stopTrigger: trigger || null,
        };
        const exportResult = await system._cinematicReplayExporter.export(replay);
        const saved = exportResult?.saved === true;
        const result = system._buildStopResult(
            saved,
            saved ? 'stopped' : (exportResult?.reason || 'export_failed'),
            {
                ...exportResult,
                mode: 'cinematic_replay',
                recorderEngine: 'cinematic-replay',
                captureProfile: system._activeRecording?.captureProfile || system.recordingCaptureSettings?.profile || null,
                hudMode: system._activeRecording?.hudMode || system.recordingCaptureSettings?.hudMode || null,
                captureExportPreset: system._activeRecording?.captureExportPreset || system.recordingCaptureSettings?.exportPreset || null,
                partial: replay.partial === true,
                partialReason: replay.partialReason || null,
                replayRetained: !saved,
            }
        );
        if (saved) {
            system._lastExport = {
                ...result,
                fileName: exportResult.fileName || null,
                filePath: exportResult.filePath || null,
                deliveryPath: exportResult.filePath || null,
                masterContainer: 'replay',
                deliveryContainer: 'mp4',
                container: 'mp4',
                mimeType: 'video/mp4',
                warnings: Array.isArray(exportResult.warnings) ? exportResult.warnings.slice() : [],
            };
        }
        system._activeRecording = null;
        system._notifyRecordingStateChange(false, { mode: 'cinematic_replay', saved });
        return result;
    })();
    system._pendingStop = operation;
    try {
        return await operation;
    } finally {
        if (system._pendingStop === operation) system._pendingStop = null;
    }
}
