import { buildCaptions } from './render-trail-short.mjs';

export function buildTrailTemplateCopy(brief, evidence, beats) {
    if (!['thick', 'ghost'].includes(brief.scenario)) throw new Error('No approved copy template for this scenario');
    const has = (id) => evidence.events.some((event) => event.id === id);
    const captionEvidence = {
        hook: { kind: 'gameplay', eventIds: ['trails-start'] },
        duel: { kind: 'gameplay', eventIds: ['trails-duel'] },
        classic: { kind: 'approved-fact', factId: 'classic-mode' },
        pickup: { kind: 'gameplay', eventIds: ['pickup'] },
        activation: { kind: 'gameplay', eventIds: ['use'] },
        effect: { kind: 'aftermath', eventIds: ['widened'] },
        crossing: { kind: 'gameplay', eventIds: ['crossing'] },
        endcard: { kind: 'cta' },
    };
    const captions = buildCaptions(brief.scenario, beats).map(({ start, end, key, copy }) => {
        const claim = captionEvidence[key];
        if (!claim) throw new Error(`No evidence mapping for caption ${key}`);
        if (claim.eventIds?.some((id) => !has(id))) throw new Error(`Caption ${key} has no recorded event`);
        return { start, end, text: copy, ...claim };
    });
    const title = brief.scenario === 'ghost'
        ? { text: 'GHOST crosses a light trail', kind: 'gameplay', eventIds: ['crossing'] }
        : { text: 'THICK makes the next trail wider', kind: 'gameplay', eventIds: ['widened'] };
    return {
        language: 'en', title,
        description: [
            { text: brief.scenario === 'ghost'
                ? 'A real GHOST pickup, activation and trail crossing in CurviosClash.'
                : 'A real THICK activation changes the next trail in CurviosClash.',
            kind: 'gameplay', eventIds: brief.scenario === 'ghost' ? ['pickup', 'use', 'crossing'] : ['use', 'widened'] },
            { text: 'Development footage.', kind: 'development' },
            { text: `Follow CurviosClash: ${brief.callToAction.url}`, kind: 'cta' },
        ],
        captions,
        callToAction: brief.callToAction,
        attribution: [
            'Music: Mozart, Eine kleine Nachtmusik, performed by Advent Chamber Orchestra; CC BY-SA 2.0.',
            'https://commons.wikimedia.org/wiki/File:Mozart_-_Eine_kleine_Nachtmusik_-_1._Allegro.ogg',
        ],
        provenance: 'approved-trail-template.v1',
    };
}
