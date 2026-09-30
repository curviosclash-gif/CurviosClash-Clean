import { parcoursRules } from '../parcours_pack_v130_shared.js';

// Rules shared by every stage of the Himmelsleiter portal chain.
export function skyLadderRules(overrides = {}) {
    return parcoursRules({ resetToLastValid: true, ...overrides });
}
