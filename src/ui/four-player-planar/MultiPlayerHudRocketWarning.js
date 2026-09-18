// ============================================
// MultiPlayerHudRocketWarning.js - inbound rocket banners on a shared screen
// ============================================
//
// The two-player Hunt HUD gets its warning banners from index.html. The three and
// four player HUDs build their surface at runtime, so they build their banners the
// same way - one per player area, reusing the class names and therefore the whole
// look, the urgency states and the screen-reader sentence of the Hunt version.
//
// Everything below is arithmetic-free: the writing, the diffing and the bearing all
// live in HuntHudRocketWarning.js, which this module only feeds. Nothing is
// allocated per frame; every banner owns one scratch view object and one cache.

import { createRocketWarningCache, hideRocketWarning, updateRocketWarning } from '../HuntHudRocketWarning.js';

function createBanner(documentRef, parent, idPrefix, playerIndex) {
    const root = documentRef.createElement('div');
    root.id = `${idPrefix}-rocket-warning-p${playerIndex + 1}`;
    root.className = 'hunt-rocket-warning hidden';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    const arrow = documentRef.createElement('span');
    arrow.className = 'hunt-rocket-warning-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '▲';
    const text = documentRef.createElement('span');
    text.className = 'hunt-rocket-warning-text';
    // The visible text changes ten times a second (distance), so assistive tech gets
    // the fixed sentence below instead of a stream of numbers.
    text.setAttribute('aria-hidden', 'true');
    const screenReaderText = documentRef.createElement('span');
    screenReaderText.className = 'hunt-rocket-warning-sr';
    screenReaderText.textContent = `Rakete im Anflug, Spieler ${playerIndex + 1}`;
    root.appendChild(arrow);
    root.appendChild(text);
    root.appendChild(screenReaderText);
    parent.appendChild(root);
    return { root, arrow, text };
}

/** One rocket warning per local player of a split screen HUD. */
export class MultiPlayerHudRocketWarnings {
    /** @param {string} idPrefix element id prefix, e.g. 'three-player-split' */
    constructor(idPrefix) {
        this._idPrefix = String(idPrefix);
        this._entries = [];
        // ponytail: the banner sits centred in its own player area, which is what the
        // shared CSS already does - so no leftPercent is passed here.
        this._options = { huntActive: false, reduceMotion: true };
    }

    /**
     * Adds the banner of one player into that player's own area.
     *
     * @param {any} documentRef
     * @param {any} parent the player's quadrant/column element
     * @param {number} playerIndex
     */
    mount(documentRef, parent, playerIndex) {
        if (!documentRef || !parent) return;
        this._entries[playerIndex] = {
            refs: createBanner(documentRef, parent, this._idPrefix, playerIndex),
            cache: createRocketWarningCache(),
            // Live players carry alive and quaternion; the threat comes from the
            // projectile system, so both meet in this reused object.
            view: { alive: true, quaternion: null, rocketThreat: null },
        };
    }

    /**
     * @param {number} playerIndex
     * @param {any} player live player of this viewport, or null
     * @param {any} rocketThreat threat of that player, or null
     * @param {boolean} huntActive rockets only exist in Hunt matches
     * @param {boolean} reduceMotion suppresses the pulse, never the message
     */
    update(playerIndex, player, rocketThreat, huntActive, reduceMotion) {
        const entry = this._entries[playerIndex];
        if (!entry) return;
        this._options.huntActive = huntActive !== false;
        this._options.reduceMotion = reduceMotion !== false;
        if (!player) {
            updateRocketWarning(entry.refs, entry.cache, null, this._options);
            return;
        }
        entry.view.alive = player.alive !== false;
        entry.view.quaternion = player.quaternion || null;
        entry.view.rocketThreat = rocketThreat || null;
        updateRocketWarning(entry.refs, entry.cache, entry.view, this._options);
    }

    /** Clears every banner, e.g. when the match ends. */
    hideAll() {
        for (const entry of this._entries) {
            if (entry) hideRocketWarning(entry.refs, entry.cache);
        }
    }

    dispose() {
        this._entries.length = 0;
    }
}
