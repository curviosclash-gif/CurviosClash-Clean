export function createHangarWorkshopAudio() {
    let context = null;
    function play(kind = 'drop') {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        context ||= new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        const frequency = kind === 'reject' ? 120 : (kind === 'pickup' ? 260 : 520);
        oscillator.type = kind === 'reject' ? 'sawtooth' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * (kind === 'reject' ? 0.55 : 1.35)), now + 0.09);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.055, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.12);
    }
    return Object.freeze({
        play,
        dispose() { if (context && context.state !== 'closed') void context.close(); context = null; },
    });
}
