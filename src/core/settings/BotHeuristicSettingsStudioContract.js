import {
    BOT_HEURISTIC_PROFILE_NAMES,
    BOT_HEURISTIC_TUNING_LIMITS,
} from '../../shared/contracts/BotHeuristicTuningContract.js';

const PROFILE_LABELS = Object.freeze({
    defensive: Object.freeze({ de: 'Defensiv', en: 'Defensive' }),
    balanced: Object.freeze({ de: 'Ausgewogen', en: 'Balanced' }),
    aggressive: Object.freeze({ de: 'Aggressiv', en: 'Aggressive' }),
});

function createFieldMetadata(profileName, field) {
    const label = PROFILE_LABELS[profileName];
    const aggression = field === 'aggression';
    return Object.freeze({
        label: { de: `${label.de}: ${aggression ? 'Aggressivität' : 'Überlebensfokus'}`, en: `${label.en}: ${aggression ? 'Aggression' : 'Survival Focus'}` },
        riskLevel: 'medium',
        unit: '%',
        example: '50',
        help: aggression
            ? { de: `Steuert Angriffsfenster, offensiven Item-Einsatz, Boost und Kampfabstand des ${label.de.toLowerCase()}en Heuristik-Profils.`, en: `Controls attack windows, offensive item use, boost, and combat range for the ${label.en.toLowerCase()} heuristic profile.` }
            : { de: `Steuert Rückzug, defensive Items und Sicherheitsabstand des ${label.de.toLowerCase()}en Heuristik-Profils.`, en: `Controls retreat, defensive item use, and safety distance for the ${label.en.toLowerCase()} heuristic profile.` },
        impact: aggression
            ? { de: '50 bewahrt das bisherige Verhalten; höhere Werte greifen offensiver an.', en: '50 preserves existing behavior; higher values attack more aggressively.' }
            : { de: '50 bewahrt das bisherige Verhalten; höhere Werte priorisieren Überleben.', en: '50 preserves existing behavior; higher values prioritize survival.' },
    });
}

const TUNING_FIELDS = Object.freeze(['aggression', 'survivalFocus']);
const BASE_PATHS = BOT_HEURISTIC_PROFILE_NAMES.flatMap((profileName) => (
    TUNING_FIELDS.map((field) => `baseSettings.botHeuristicTuning.${profileName}.${field}`)
));

export const BOT_HEURISTIC_FIELD_HELP_METADATA = Object.freeze(Object.fromEntries(
    BOT_HEURISTIC_PROFILE_NAMES.flatMap((profileName) => TUNING_FIELDS.map((field) => [
        `baseSettings.botHeuristicTuning.${profileName}.${field}`,
        createFieldMetadata(profileName, field),
    ]))
));

export const BOT_HEURISTIC_FIELD_LIMITS = Object.freeze(Object.fromEntries([
    ...BASE_PATHS,
    ...BASE_PATHS.map((fieldPath) => fieldPath.replace(/^baseSettings\./, 'configShare.')),
].map((fieldPath) => [fieldPath, BOT_HEURISTIC_TUNING_LIMITS])));
