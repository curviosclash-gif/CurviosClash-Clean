import { parcoursRules } from '../parcours_pack_v130_shared.js';

// Rules shared by every stage of the Himmelsleiter portal chain. A death falls back to the last
// checkpoint like a missed segment time does; resetOnDeath would win over it and wipe the run.
export function skyLadderRules(overrides = {}) {
    return parcoursRules({ resetToLastValid: true, resetOnDeath: false, ...overrides });
}
