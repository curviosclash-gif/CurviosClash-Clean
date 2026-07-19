const concepts = {
    orbital: ['01 / 10', 'Orbital Glass', 'Kinoreif, räumlich und klar auf den Schnellstart fokussiert.'],
    hangar: ['02 / 10', 'Hangar Control', 'Technisch, robust und wie ein echtes Einsatzterminal aufgebaut.'],
    pilot: ['03 / 10', 'Pilot Lounge', 'Hochwertig, warm und mit ruhiger Premium-Cockpit-Atmosphäre.'],
    arcade: ['04 / 10', 'Neon Arcade', 'Schnell, laut und sofort als kompetitives Spiel erkennbar.'],
    tactical: ['05 / 10', 'Tactical Minimal', 'Reduziert, präzise und konsequent auf Lesbarkeit optimiert.'],
    matrix: ['06 / 10', 'Matrix Operator', 'Ein kompromissloses schwarzes Terminal mit grüner Datenebene.'],
    grid72: ['07 / 10', 'Grid 72', 'Ein sachliches Editorial-System mit Primärfarben und harter Typografie.'],
    avionics: ['08 / 10', 'Amber Avionics', 'Monochrom, instrumentell und direkt aus einem Flugcomputer.'],
    broadcast: ['09 / 10', 'Broadcast Control', 'Sportregie statt Sci-Fi-Dekor: laut, hierarchisch und live.'],
    holobay: ['10 / 10', 'Holo Bay 3D', 'Ein technischer Hangar mit nativer CSS-3D-Inspektionsanimation.'],
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
    const concept = conceptKeys['1234567890'.indexOf(event.key)];
    if (concept) selectConcept(concept);
});
