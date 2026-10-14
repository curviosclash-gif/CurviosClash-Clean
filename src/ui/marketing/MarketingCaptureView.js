function add(parent, tag, text = '', attributes = {}) {
    const element = document.createElement(tag);
    element.textContent = text;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent.append(element);
    return element;
}

export function createMarketingCaptureView() {
    let panel = null;
    let reopen = null;
    let status = null;

    function setStatus(message) {
        if (status) status.textContent = message;
    }

    function showRecording() {
        panel?.remove();
        reopen?.remove();
        panel = null;
        reopen = null;
        status = document.createElement('div');
        status.setAttribute('role', 'status');
        Object.assign(status.style, { position: 'fixed', bottom: '8px', left: '8px', zIndex: '100000',
            color: '#fff', background: '#111c', padding: '5px', font: '12px system-ui', pointerEvents: 'none' });
        document.body.append(status);
    }

    function showSetup(config, onStart) {
        panel = document.createElement('section');
        panel.setAttribute('aria-label', 'Marketingaufnahme');
        Object.assign(panel.style, { position: 'fixed', inset: '10% auto auto 50%', transform: 'translateX(-50%)',
            zIndex: '100000', background: '#111827', color: '#fff', padding: '28px', border: '2px solid #22d3ee',
            borderRadius: '12px', maxWidth: '560px', font: '18px system-ui' });
        add(panel, 'h2', 'Partie aufnehmen');
        add(panel, 'p', 'Spiele selbst. Bild, Spielton und Replay werden lokal gespeichert. Nach dem Schließen werden belegte Videokandidaten gesucht.');
        const humansLabel = add(panel, 'label', 'Menschen ');
        const humans = add(humansLabel, 'select', '', { 'data-humans': '' });
        add(humans, 'option', 'Ich allein', { value: '1' });
        add(humans, 'option', 'Zwei am selben Rechner', { value: '2' });
        const botsLabel = add(panel, 'label', ' Bots ');
        const bots = add(botsLabel, 'input', '', { 'data-bots': '', type: 'number', min: '1', max: '8', style: 'width:65px' });
        const confirmLabel = add(add(panel, 'p'), 'label');
        const confirmation = add(confirmLabel, 'input', '', { 'data-confirm': '', type: 'checkbox' });
        add(confirmLabel, 'span', ' Die gewählte Zahl Menschen spielt selbst; keine Makros oder Skriptsteuerung.');
        add(panel, 'p', 'Verwendet die im Spiel eingestellte Karte, Schwierigkeit und Steuerung.');
        const configure = add(panel, 'button', 'Spieleinstellungen anzeigen');
        reopen = document.createElement('button');
        reopen.textContent = 'Marketingaufnahme einrichten';
        Object.assign(reopen.style, { position: 'fixed', top: '8px', right: '8px', zIndex: '100000' });
        reopen.hidden = true;
        configure.addEventListener('click', () => { panel.hidden = true; reopen.hidden = false; });
        reopen.addEventListener('click', () => { panel.hidden = false; reopen.hidden = true; });
        document.body.append(reopen);
        const start = add(panel, 'button', 'Aufnahme und Partie starten', { 'data-start': '' });
        status = add(panel, 'p', '', { 'data-status': '', role: 'status' });
        humans.value = String(config.humans || 1);
        bots.value = String(config.bots || 3);
        start.addEventListener('click', async () => {
            start.disabled = true;
            try {
                await onStart({ humans: Number(humans.value), bots: Number(bots.value),
                    confirmedHumans: confirmation.checked ? Number(humans.value) : 0 });
                showRecording();
            } catch (error) {
                setStatus(error?.message || String(error));
                start.disabled = false;
            }
        });
        document.body.append(panel);
    }

    return Object.freeze({
        hasSetup: () => Boolean(panel),
        setStatus,
        showRecording,
        showSetup,
    });
}
