// Result panel replay buttons: "Replay ansehen" plays the last round visibly, "Exportieren" copies the
// replay JSON. While the playback runs the overlay only turns transparent, so the in-match HUD stays
// hidden behind the arcade result and the panel comes back unchanged afterwards.

export const ARCADE_REPLAY_VIEWING_CLASS = 'arcade-replay-viewing';
const DEFAULT_PLAYBACK_SECONDS = 8;

function createButton(doc, id, label, disabled) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'arcade-overlay-action-btn';
    button.id = id;
    button.textContent = label;
    button.disabled = disabled;
    return button;
}

export function createArcadeReplayActions({
    doc = document,
    payloadAvailable = false,
    overlay = null,
    requestPlayback,
    requestExport,
    copyText,
    showToast,
    setTimer = (fn, ms) => setTimeout(fn, ms),
} = {}) {
    const watch = createButton(doc, 'btn-arcade-overlay-replay', 'Replay ansehen', !payloadAvailable);
    const exportButton = createButton(doc, 'btn-arcade-overlay-replay-export', 'Exportieren', !payloadAvailable);

    watch.addEventListener('click', () => {
        const result = requestPlayback?.();
        if (!['replay_playback_started', 'ghost_fallback_started'].includes(String(result?.code || ''))) {
            showToast?.('Replay kann gerade nicht abgespielt werden.', 'warning');
            return;
        }
        overlay?.classList?.add?.(ARCADE_REPLAY_VIEWING_CLASS);
        const seconds = Number(result?.playback?.displayDuration) || DEFAULT_PLAYBACK_SECONDS;
        setTimer(() => overlay?.classList?.remove?.(ARCADE_REPLAY_VIEWING_CLASS), Math.round(seconds * 1000));
    });

    exportButton.addEventListener('click', () => {
        const result = requestExport?.();
        const json = typeof result?.replayJson === 'string' ? result.replayJson : '';
        if (!json) {
            showToast?.('Kein Replay zum Exportieren vorhanden.', 'warning');
            return Promise.resolve(false);
        }
        return Promise.resolve(copyText?.(json)).then((copied) => {
            showToast?.(
                copied ? 'Replay-JSON wurde in die Zwischenablage kopiert.' : 'Replay-JSON konnte nicht kopiert werden.',
                copied ? 'info' : 'warning'
            );
            return copied === true;
        });
    });

    return { buttons: [watch, exportButton] };
}
