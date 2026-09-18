// Card rendering for the post-match board (contract: post-match-stats.v2, `kind: 'values'`).
//
// A card is a titled definition list: one row per value, label on the left, formatted value on the
// right. The hooks `data-stats-block-id`, `data-stats-block-tier`, `data-stats-row-key` and the
// class `message-stats-value` are queried by the desktop tests, so they are part of the contract of
// this module and must not be renamed silently.

import { formatPostMatchValue } from './PostMatchFormat.js';

/**
 * @param {string} tagName
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function createStatsElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/**
 * The shared frame of every block: a section carrying the test hooks plus an optional title.
 * @param {{ id: string, tier: string }} block
 * @param {string} extraClassName
 * @returns {HTMLElement}
 */
export function createBlockSection(block, extraClassName = '') {
    const section = createStatsElement('section', `message-stats-card${extraClassName ? ` ${extraClassName}` : ''}`);
    section.setAttribute('data-stats-block-id', block.id);
    section.setAttribute('data-stats-block-tier', block.tier);
    return section;
}

/**
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchValueRow} row
 * @returns {HTMLElement}
 */
function createValueRow(row) {
    const rowElement = createStatsElement('div', 'message-stats-row');
    rowElement.setAttribute('data-stats-row-key', row.key);
    rowElement.appendChild(createStatsElement('dt', 'message-stats-label', row.label));
    rowElement.appendChild(createStatsElement('dd', 'message-stats-value', formatPostMatchValue(row)));
    return rowElement;
}

/**
 * Renders a `values` block as a card. Returns null for an empty block so the board never shows an
 * empty frame.
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock} block
 * @returns {HTMLElement|null}
 */
export function createPostMatchCard(block) {
    if (!block || block.rows.length === 0) return null;
    const section = createBlockSection(block);
    section.appendChild(createStatsElement('h3', 'message-stats-title', block.title || 'Stats'));

    const list = createStatsElement('dl', 'message-stats-list');
    for (const row of block.rows) list.appendChild(createValueRow(row));
    section.appendChild(list);
    return section;
}
