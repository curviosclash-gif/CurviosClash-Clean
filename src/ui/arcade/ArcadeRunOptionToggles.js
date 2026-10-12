// The run options next to the arcade starts: run tier ("Albtraum") and companions.
import { bindArcadeCompanionToggle, createArcadeCompanionToggle, syncArcadeCompanionToggle } from './ArcadeCompanionToggle.js';
import { bindArcadeNightmareToggle, createArcadeNightmareToggle, syncArcadeNightmareToggle } from './ArcadeNightmareToggle.js';

export function createArcadeRunOptionToggles(doc = document) {
    const nightmare = createArcadeNightmareToggle(doc);
    const companion = createArcadeCompanionToggle(doc);
    return { labels: [nightmare.label, companion.label], nightmareInput: nightmare.input, companionInput: companion.input };
}

export function bindArcadeRunOptionToggles(refs, settings, bind, onChange) {
    bindArcadeNightmareToggle(refs?.nightmareInput, settings, bind, onChange);
    bindArcadeCompanionToggle(refs?.companionInput, settings, bind, onChange);
}

export function syncArcadeRunOptionToggles(refs, settings, store = null) {
    syncArcadeNightmareToggle(refs?.nightmareInput, settings, store);
    syncArcadeCompanionToggle(refs?.companionInput, settings);
}
