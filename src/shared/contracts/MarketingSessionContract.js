export const MARKETING_SESSION_VERSION = 'marketing-session.v1';
export const MARKETING_PREROLL_MS = 120_000;
export const MARKETING_MAX_BATCH_BYTES = 4 * 1024 * 1024;

export function normalizeMarketingSetup(value = {}) {
    const humans = Number(value.humans ?? 1);
    const bots = Number(value.bots ?? 3);
    if (![1, 2].includes(humans)) throw new Error('Bitte einen oder zwei lokale Spieler wählen.');
    if (!Number.isInteger(bots) || bots < 1 || bots > 8) throw new Error('Bitte 1–8 Bots wählen.');
    if (value.confirmedHumans !== humans) throw new Error('Bitte bestätigen, wie viele Menschen selbst mitspielen.');
    return { humans, bots, confirmedHumans: humans, control: 'local-input', mode: 'HUNT' };
}

// Identity is deliberately not inferred from isBot=false or from input entropy.
export function validateMarketingParticipants(setup, participants, inputEvidence = []) {
    const failures = [];
    const humans = participants.filter((p) => p.isBot === false);
    if (humans.length !== setup.humans || participants.filter((p) => p.isBot === true).length !== setup.bots) {
        failures.push('participant_count_mismatch');
    }
    for (const player of humans) {
        const entries = inputEvidence.filter((entry) => entry.player === player.index);
        if (!entries.some((entry) => entry.type === 'physical-input' && entry.trusted === true)) {
            failures.push(`physical_input_unverified:${player.index}`);
        }
        if (!entries.some((entry) => entry.type === 'applied-input' && entry.active === true)) {
            failures.push(`no_applied_input:${player.index}`);
        }
        if (entries.some((entry) => entry.trusted === false
            || (entry.type === 'applied-input' && !['keyboard', 'mouse', 'gamepad'].includes(entry.source)))) {
            failures.push(`unverified_input_source:${player.index}`);
        }
    }
    return failures;
}
