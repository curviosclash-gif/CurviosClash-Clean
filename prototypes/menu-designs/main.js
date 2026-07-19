const concepts = {
    orbital: ['01 / 05', 'Orbital Glass', 'Kinoreif, räumlich und klar auf den Schnellstart fokussiert.'],
    hangar: ['02 / 05', 'Hangar Control', 'Technisch, robust und wie ein echtes Einsatzterminal aufgebaut.'],
    pilot: ['03 / 05', 'Pilot Lounge', 'Hochwertig, warm und mit ruhiger Premium-Cockpit-Atmosphäre.'],
    arcade: ['04 / 05', 'Neon Arcade', 'Schnell, laut und sofort als kompetitives Spiel erkennbar.'],
    tactical: ['05 / 05', 'Tactical Minimal', 'Reduziert, präzise und konsequent auf Lesbarkeit optimiert.'],
};

const switches = [...document.querySelectorAll('[data-concept-target]')];
const conceptKeys = Object.keys(concepts);

function selectConcept(concept) {
    if (!concepts[concept]) return;

    document.body.dataset.concept = concept;
    document.querySelector('#concept-number').textContent = concepts[concept][0];
    document.querySelector('#concept-name').textContent = concepts[concept][1];
    document.querySelector('#concept-note').textContent = concepts[concept][2];

    switches.forEach((button) => {
        const active = button.dataset.conceptTarget === concept;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

switches.forEach((button) => {
    button.addEventListener('click', () => selectConcept(button.dataset.conceptTarget));
});

document.addEventListener('keydown', (event) => {
    const concept = conceptKeys[Number(event.key) - 1];
    if (concept) selectConcept(concept);
});
