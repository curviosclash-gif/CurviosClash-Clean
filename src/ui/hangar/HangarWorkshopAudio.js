const UI_KIND_TO_EVENT = Object.freeze({
    drop: 'UI_DROP',
    pickup: 'UI_PICKUP',
    reject: 'UI_REJECT',
});

function playLocalTone(context, kind = 'drop') {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const frequency = kind === 'reject' ? 140 : (kind === 'pickup' ? 260 : 520);
    const endFrequency = Math.max(60, frequency * (kind === 'reject' ? 0.5 : 1.35));
    oscillator.type = kind === 'reject' ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + 0.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'reject' ? 0.07 : 0.055, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.13);
}

export function createHangarWorkshopAudio(sharedAudio = null) {
    let context = null;

    function play(kind = 'drop') {
        const eventType = UI_KIND_TO_EVENT[kind] || UI_KIND_TO_EVENT.drop;
        if (sharedAudio && typeof sharedAudio.play === 'function') {
            sharedAudio.play(eventType);
            return;
        }
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        context ||= new AudioContext();
        if (context.state === 'suspended') void context.resume();
        playLocalTone(context, kind);
    }

    return Object.freeze({
        play,
        dispose() {
            if (context && context.state !== 'closed') void context.close();
            context = null;
        },
    });
}
