// DOM side of the arcade result panels: turns value blocks into the same cards the post-match board
// uses, and puts long lists into a scrollable container.
//
// Scrolling is plain CSS (max-height plus overflow-y in style.css). A scroll container is only
// reachable with the keyboard when it can take focus, so it carries tabindex="0" and a role with a
// label — without that a keyboard player could not read past the visible sectors.

import { createPostMatchCard, createStatsElement } from '../../postmatch/PostMatchCards.js';

/**
 * @param {HTMLElement} parent
 * @param {Array<import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock|null>} blocks
 * @returns {HTMLElement} the parent, for chaining
 */
export function appendArcadeCards(parent, blocks) {
    for (const block of blocks || []) {
        const card = block ? createPostMatchCard(block) : null;
        if (card) parent.appendChild(card);
    }
    return parent;
}

/**
 * @param {Array<import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock|null>} blocks
 * @param {string} ariaLabel
 * @param {string} emptyText shown when the run produced no entries at all
 * @returns {HTMLElement}
 */
export function createArcadeCardScroller(blocks, ariaLabel, emptyText) {
    const scroller = createStatsElement('div', 'arcade-overlay-scroll');
    scroller.setAttribute('data-arcade-scroll', ariaLabel);
    scroller.setAttribute('tabindex', '0');
    scroller.setAttribute('role', 'group');
    scroller.setAttribute('aria-label', ariaLabel);
    appendArcadeCards(scroller, blocks);
    if (scroller.children.length === 0) {
        scroller.appendChild(createStatsElement('p', 'arcade-overlay-empty', emptyText));
    }
    return scroller;
}
