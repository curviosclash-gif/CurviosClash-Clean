// Renders the post-match board (contract: post-match-stats.v2).
//
// The board has two parts. Everything the player cares about right away stays open: the standings as
// a real table plus the primary cards. Everything that only helps development (stuck rate, bot
// survival, bot win rate) moves into a single <details> that starts folded — decision E2. <details>
// is used on purpose instead of a hand built toggle, because the browser already gives it keyboard
// operation, an accessible state and a focusable summary.
//
// What must not change are `data-stats-block-id` and `data-stats-row-key`: the desktop tests hang on
// them, and a folded <details> still keeps its content in the DOM, so a text search finds it.

import { normalizePostMatchStats } from '../../shared/contracts/PostMatchStatsContract.js';
import { createPostMatchCard, createStatsElement } from '../postmatch/PostMatchCards.js';
import { createPostMatchStandingsTable } from '../postmatch/PostMatchStandingsTable.js';
import { createPostMatchComparisonTable } from '../postmatch/PostMatchComparisonTable.js';

const DETAILS_SUMMARY_LABEL = 'Details';

export function clearMessageStats(container) {
    if (!container) return;
    container.replaceChildren();
    container.classList.add('hidden');
}

/**
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock} block
 * @returns {HTMLElement|null}
 */
function createBlockElement(block) {
    if (block.id === 'participant-comparison') return createPostMatchComparisonTable(block);
    return block.kind === 'standings'
        ? createPostMatchStandingsTable(block)
        : createPostMatchCard(block);
}

/**
 * @param {HTMLElement[]} blockElements
 * @returns {HTMLElement}
 */
function createDetailsSection(blockElements) {
    const details = createStatsElement('details', 'message-stats-details');
    details.appendChild(createStatsElement('summary', 'message-stats-summary', DETAILS_SUMMARY_LABEL));
    for (const element of blockElements) details.appendChild(element);
    return details;
}

export function renderMessageStats(container, overlayStats) {
    if (!container) return;

    const stats = normalizePostMatchStats(overlayStats);
    if (!stats.visible) {
        clearMessageStats(container);
        return;
    }

    container.replaceChildren();
    /** @type {HTMLElement[]} */
    const detailElements = [];
    for (const block of stats.blocks) {
        const element = createBlockElement(block);
        if (!element) continue;
        if (block.tier === 'detail') detailElements.push(element);
        else container.appendChild(element);
    }
    if (detailElements.length > 0) {
        container.appendChild(createDetailsSection(detailElements));
    }

    container.classList.remove('hidden');
}
