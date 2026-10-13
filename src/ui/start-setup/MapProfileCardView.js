// ============================================
// MapProfileCardView.js - Steckbrief of the chosen map in free play: size, bot limit,
// recommended pilots and special features. Every fact is written out; the symbol is decoration.
// The facts themselves come from MapProfileContract (codes only), the words live here.
// ============================================

import { MAP_PROFILE_FEATURES, MAP_PROFILE_SIZE_CLASSES } from '../../shared/contracts/MapProfileContract.js';

const SIZE_LABELS = Object.freeze({
    [MAP_PROFILE_SIZE_CLASSES.SMALL]: 'klein',
    [MAP_PROFILE_SIZE_CLASSES.MEDIUM]: 'mittel',
    [MAP_PROFILE_SIZE_CLASSES.LARGE]: 'groß',
});

/** @type {Readonly<Record<string, string>>} */
const SYMBOLS = Object.freeze({
    size: '⤢',
    bots: '⚙',
    pilots: '☻',
    none: '–',
    [MAP_PROFILE_FEATURES.PORTALS]: '◎',
    [MAP_PROFILE_FEATURES.PARCOURS]: '⚑',
    [MAP_PROFILE_FEATURES.LEVELS]: '☰',
    [MAP_PROFILE_FEATURES.DESTRUCTIBLE]: '✸',
    [MAP_PROFILE_FEATURES.SANDSTORM]: '≋',
    [MAP_PROFILE_FEATURES.FOG]: '☁',
});

const HEADING_ID = 'map-profile-heading';

function describeBots(bots) {
    if (bots.max === 0) return 'Bots: keine';
    if (bots.min > 0 && bots.min !== bots.max) return `Bots: ${bots.min} bis ${bots.max}`;
    if (bots.min > 0) return `Bots: genau ${bots.max}`;
    return `Bots: höchstens ${bots.max}`;
}

function describePilots(pilots) {
    if (pilots.max <= 1) return 'Empfohlen: 1 Pilot (nur du)';
    const range = pilots.min === pilots.max ? `${pilots.max}` : `${pilots.min}–${pilots.max}`;
    return `Empfohlen: ${range} Piloten (du und Bots)`;
}

function describeFeature(feature) {
    const count = feature.count;
    switch (feature.code) {
    case MAP_PROFILE_FEATURES.PORTALS: return `Portale: ${count} ${count === 1 ? 'Paar' : 'Paare'}`;
    case MAP_PROFILE_FEATURES.PARCOURS: return `Parcours: ${count} ${count === 1 ? 'Ring' : 'Ringe'}`;
    case MAP_PROFILE_FEATURES.LEVELS: return `Ebenen: ${count} Flughöhen`;
    case MAP_PROFILE_FEATURES.DESTRUCTIBLE: return `Zerstörbar: ${count} ${count === 1 ? 'Bauteil' : 'Bauteile'}`;
    case MAP_PROFILE_FEATURES.SANDSTORM: return 'Wetter: Sandsturm während der Runde';
    case MAP_PROFILE_FEATURES.FOG: return 'Wetter: Nebel, der sich verändert';
    default: return '';
    }
}

/**
 * The profile as plain list entries. Pure, so the wording can be tested without a DOM.
 * @param {import('../../shared/contracts/MapProfileContract.js').MapProfile} profile
 * @returns {{ symbol: string, text: string }[]}
 */
export function describeMapProfile(profile) {
    const sizeLabel = SIZE_LABELS[/** @type {keyof typeof SIZE_LABELS} */ (profile.size.code)] || profile.size.code;
    const items = [
        { symbol: SYMBOLS.size, text: `Größe: ${sizeLabel} (${profile.size.width} × ${profile.size.depth})` },
    ];
    if (profile.bots) items.push({ symbol: SYMBOLS.bots, text: describeBots(profile.bots) });
    items.push({ symbol: SYMBOLS.pilots, text: describePilots(profile.pilots) });
    const features = profile.features
        .map((feature) => ({ symbol: SYMBOLS[/** @type {keyof typeof SYMBOLS} */ (feature.code)] || '•', text: describeFeature(feature) }))
        .filter((item) => item.text !== '');
    if (features.length === 0) items.push({ symbol: SYMBOLS.none, text: 'Keine Besonderheiten' });
    else items.push(...features);
    return items;
}

/** What each host currently shows, so an unchanged map does not rebuild the list on every menu sync. */
const shownByHost = new WeakMap();

/**
 * Fills the card, or empties and hides it when `content` is null (arcade, quick action, no map).
 * @param {HTMLElement|null|undefined} host
 * @param {{ profile: import('../../shared/contracts/MapProfileContract.js').MapProfile, mapName?: string }|null} content
 */
export function renderMapProfileCard(host, content) {
    if (!host) return;
    const signature = content ? JSON.stringify([content.mapName || '', content.profile]) : '';
    host.classList.toggle('hidden', !content);
    host.setAttribute('aria-hidden', String(!content));
    if (shownByHost.get(host) === signature) return;
    shownByHost.set(host, signature);
    if (!content) {
        host.replaceChildren();
        return;
    }
    const heading = document.createElement('h4');
    heading.id = HEADING_ID;
    heading.className = 'start-map-profile-heading';
    heading.textContent = content.mapName ? `Steckbrief: ${content.mapName}` : 'Steckbrief';
    host.setAttribute('aria-labelledby', HEADING_ID);

    const list = document.createElement('ul');
    list.className = 'start-map-profile-list';
    list.setAttribute('role', 'list');
    for (const item of describeMapProfile(content.profile)) {
        const row = document.createElement('li');
        const symbol = document.createElement('span');
        symbol.className = 'start-map-profile-symbol';
        symbol.setAttribute('aria-hidden', 'true');
        symbol.textContent = item.symbol;
        const text = document.createElement('span');
        text.textContent = item.text;
        row.appendChild(symbol);
        row.appendChild(text);
        list.appendChild(row);
    }
    host.replaceChildren(heading, list);
}
