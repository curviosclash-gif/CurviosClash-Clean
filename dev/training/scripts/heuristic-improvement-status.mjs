// Human-readable summary of a heuristic search state (npm run bot:improve:status).

import { HEURISTIC_PROFILES } from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import {
    HEURISTIC_PLATEAU_ROUND_LIMIT, HEURISTIC_SEARCH_PROFILES, HEURISTIC_SEARCH_STATE_VERSION, HEURISTIC_SEARCH_STEPS,
} from './heuristic-improvement-acceptance.mjs';
import { TUNABLE_FIELDS } from './heuristic-improvement-match.mjs';

// The status shows the most recent decisions; the state keeps a few more for context.
export const STATUS_HISTORY_LINES = 12;

function formatNumber(value, digits = 3) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(digits) : 'n/a';
}

// Plain JavaScript number text, so 0.58 prints as 0.58 and not as 0.5800.
function formatField(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(Math.round(numeric * 10_000) / 10_000) : 'n/a';
}

function describeVersion(state) {
    if (state.version === HEURISTIC_SEARCH_STATE_VERSION) return `version ${state.version}, current`;
    return `version ${state.version}, current is ${HEURISTIC_SEARCH_STATE_VERSION}: the next iteration starts from scratch`;
}

function describeNextStep(state) {
    const profile = HEURISTIC_SEARCH_PROFILES[(Number(state.profileCursor) || 0) % HEURISTIC_SEARCH_PROFILES.length];
    const fieldIndex = (Number(state.fieldCursorByProfile?.[profile]) || 0) % TUNABLE_FIELDS.length;
    const step = HEURISTIC_SEARCH_STEPS[Number(state.stepIndex) || 0] ?? HEURISTIC_SEARCH_STEPS.at(-1);
    return `next: ${profile} ${TUNABLE_FIELDS[fieldIndex]} (field ${fieldIndex + 1}/${TUNABLE_FIELDS.length}),`
        + ` step ${Math.round(step * 100)} %`;
}

function describeProfileDifferences(profile, fields) {
    const product = HEURISTIC_PROFILES[profile];
    const changes = TUNABLE_FIELDS
        .filter((field) => fields && Number(fields[field]) !== Number(product[field]))
        .map((field) => `${field} ${formatField(product[field])} -> ${formatField(fields[field])}`);
    return `  ${profile}: ${changes.length > 0 ? changes.join(', ') : 'same as product'}`;
}

function describeRatios(label, ratios) {
    if (!ratios) return `  ${label}: not verified yet`;
    return `  ${label}: survival ${formatNumber(ratios.survival)} kills ${formatNumber(ratios.kills)}`
        + ` damage ${formatNumber(ratios.damage)}`;
}

export function formatHeuristicSearchStatus(state, { statePath }) {
    const lines = [
        `state: ${statePath} (${describeVersion(state)})`,
        describeNextStep(state),
        `plateau rounds: ${Number(state.plateauRounds) || 0}/${HEURISTIC_PLATEAU_ROUND_LIMIT}`,
        'last decisions:',
    ];
    const history = Array.isArray(state.history) ? state.history.slice(-STATUS_HISTORY_LINES) : [];
    if (history.length === 0) lines.push('  none yet');
    for (const entry of history) {
        lines.push(`  ${entry.at} ${entry.profile} ${entry.field}=${formatNumber(entry.value, 4)} ${entry.decision}`
            + (entry.failed ? ` failed=${entry.failed}` : ''));
    }
    lines.push('profiles (shipped -> search):');
    for (const profile of HEURISTIC_SEARCH_PROFILES) {
        lines.push(describeProfileDifferences(profile, state.profiles?.[profile]));
    }
    lines.push('last verified against the frozen comparison profiles (ratio candidate/opponents):');
    for (const profile of HEURISTIC_SEARCH_PROFILES) {
        lines.push(describeRatios(profile, state.verifiedRatios?.[profile]));
    }
    for (const [profile, check] of Object.entries(state.opponentChecks || {})) {
        lines.push(`opponent check ${profile} (${check.at}):`);
        for (const [opponent, ratios] of Object.entries(check.results || {})) {
            lines.push(describeRatios(opponent, ratios));
        }
    }
    return lines.join('\n');
}
