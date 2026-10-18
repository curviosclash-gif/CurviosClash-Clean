import { ENDLESS_TRAINING_SEED } from '../../shared/contracts/EndlessParcoursSeedContract.js';

export function createArcadeEndlessSeedOptions(createElement) {
    const element = createElement('div', 'journey-endless-seed-options');
    const label = createElement('label', 'journey-play-mode', 'Strecke');
    const mode = createElement('select', 'menu-select'); mode.setAttribute('aria-label', 'Endlosjagd: Strecke');
    for (const [value, text] of [['free', 'Frei · neue zufällige Strecke'], ['training', 'Training · feste Strecke']]) {
        const option = createElement('option', '', text); option.value = value; mode.appendChild(option);
    }
    const seedLabel = createElement('label', 'journey-play-mode hidden', 'Trainingsseed');
    const seed = createElement('input', 'menu-input'); seed.type = 'number'; seed.min = '1'; seed.max = '2147483647'; seed.step = '1';
    seed.setAttribute('aria-label', 'Endlosjagd: Trainingsseed'); seedLabel.appendChild(seed);
    const hint = createElement('p', 'menu-hint');
    label.appendChild(mode); element.append(label, seedLabel, hint);
    const refresh = () => {
        seedLabel.classList.toggle('hidden', mode.value !== 'training');
        seed.disabled = mode.value !== 'training';
        hint.textContent = mode.value === 'training'
            ? 'Derselbe Seed erzeugt dieselbe Strecke. Training hat eigene Modellrekorde.'
            : 'Neue zufällige Strecke bei jedem Start. Für dieselbe Strecke wähle Training.';
    };
    const reset = () => { mode.value = 'free'; seed.value = String(ENDLESS_TRAINING_SEED); refresh(); };
    reset();
    return { element, reset, read: () => ({ seedMode: mode.value, trainingSeed: Number(seed.value) }),
        bind(bind, onChange) {
            bind(mode, 'change', () => { refresh(); onChange?.(); });
            bind(seed, 'input', () => onChange?.());
            bind(seed, 'change', () => onChange?.());
        } };
}
