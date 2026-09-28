export const SHORT_BRIEF_VERSION = 'marketing-short-brief.v1';
export const SHORT_EVIDENCE_VERSION = 'marketing-short-evidence.v1';
export const SHORT_PACKAGE_VERSION = 'marketing-short-package.v1';
export const SHORT_REVIEW_VERSION = 'marketing-short-review.v1';
export const SHORT_DURATION = Object.freeze({ min: 10, max: 30 });
export const SHORT_FORMAT = Object.freeze({ width: 1080, height: 1920, fps: 60 });
export const MAX_CANDIDATES = 3;

const PLATFORMS = new Set(['youtube-shorts', 'tiktok', 'instagram-reels']);
const CTA_PHASES = new Set(['pre-demo', 'demo-live']);
const NON_GAMEPLAY_COPY = new Set(['brand', 'cta', 'development']);

function requireText(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
    return value.trim();
}

function finiteSeconds(value, label) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} needs a finite nonnegative time`);
    return value;
}

export function validateBrief(value) {
    if (!value || value.contractVersion !== SHORT_BRIEF_VERSION) throw new Error(`brief needs ${SHORT_BRIEF_VERSION}`);
    const id = requireText(value.id, 'brief.id');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('brief.id needs a lowercase file-safe token');
    const topic = requireText(value.topic, 'brief.topic');
    const scene = requireText(value.scene, 'brief.scene');
    const keyClaim = requireText(value.keyClaim, 'brief.keyClaim');
    const scenario = requireText(value.scenario, 'brief.scenario');
    const mode = requireText(value.mode, 'brief.mode');
    const mapKey = requireText(value.mapKey, 'brief.mapKey');
    if (!Number.isInteger(value.subjectPlayer) || value.subjectPlayer < 0) {
        throw new Error('brief.subjectPlayer needs a player index');
    }
    if (!Array.isArray(value.requiredEvents) || !value.requiredEvents.length
        || value.requiredEvents.some((event) => typeof event !== 'string' || !event.trim())) {
        throw new Error('brief.requiredEvents needs event types');
    }
    if (!Array.isArray(value.platforms) || !value.platforms.length
        || value.platforms.some((platform) => !PLATFORMS.has(platform))) {
        throw new Error('brief.platforms needs supported destinations');
    }
    const phase = value.callToAction?.phase;
    if (!CTA_PHASES.has(phase)) throw new Error('brief.callToAction.phase is invalid');
    const url = requireText(value.callToAction?.url, 'brief.callToAction.url');
    if (!/^https:\/\//i.test(url)) throw new Error('brief.callToAction.url must use HTTPS');
    if (phase === 'demo-live' && /^https:\/\/curviosclash\.itch\.io\/?$/.test(url)) {
        throw new Error('demo-live needs the approved game page, not the profile');
    }
    return Object.freeze({ ...value, id, topic, scene, keyClaim, scenario, mode, mapKey,
        requiredEvents: [...new Set(value.requiredEvents)], platforms: [...new Set(value.platforms)],
        callToAction: { phase, url } });
}

function pose(value, label) {
    if (!value || !Array.isArray(value.position) || value.position.length !== 3
        || !Array.isArray(value.quaternion) || value.quaternion.length !== 4
        || [...value.position, ...value.quaternion, value.fov].some((number) => !Number.isFinite(number))) {
        throw new Error(`${label} needs position, quaternion and fov`);
    }
    return value;
}

function positionStep(first, second) {
    return Math.hypot(...first.position.map((axis, index) => second.position[index] - axis));
}

function orientationStep(first, second) {
    const dot = Math.abs(first.quaternion.reduce((sum, axis, index) => sum + axis * second.quaternion[index], 0));
    return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
}

export function checkHandoffMotion(handoff) {
    finiteSeconds(handoff?.at, 'handoff.at');
    if (!Number.isInteger(handoff.playerIndex) || handoff.playerIndex < 0) throw new Error('handoff player is missing');
    if (!['to-gameplay', 'to-cinematic'].includes(handoff.direction)) throw new Error('handoff direction is invalid');
    const samples = handoff.samples;
    if (!samples || typeof samples !== 'object') throw new Error('handoff motion samples are missing');
    const source = handoff.direction === 'to-gameplay' ? 'cinematic' : 'gameplay';
    const target = handoff.direction === 'to-gameplay' ? 'gameplay' : 'cinematic';
    const before2 = pose(samples['-2']?.[source], 'handoff frame -2');
    const before1 = pose(samples['-1']?.[source], 'handoff frame -1');
    const after0 = pose(samples['0']?.[target], 'handoff frame 0');
    const after1 = pose(samples['1']?.[target], 'handoff frame 1');
    const seam = positionStep(before1, after0);
    const beforeSpeed = positionStep(before2, before1);
    const afterSpeed = positionStep(after0, after1);
    const rotation = orientationStep(before1, after0);
    const rotationBefore = orientationStep(before2, before1);
    const rotationAfter = orientationStep(after0, after1);
    const fov = Math.abs(before1.fov - after0.fov);
    const fovBefore = Math.abs(before2.fov - before1.fov);
    const fovAfter = Math.abs(after0.fov - after1.fov);
    const failures = [];
    if (seam > 1.7) failures.push('camera position jumps at handoff');
    if (Math.abs(seam - beforeSpeed) > 0.5 || Math.abs(seam - afterSpeed) > 0.5) {
        failures.push('camera movement jerks at handoff');
    }
    if (rotation > 0.08 || Math.abs(rotation - rotationBefore) > 0.04
        || Math.abs(rotation - rotationAfter) > 0.04) failures.push('camera rotation jerks at handoff');
    if (fov > 1.5 || Math.abs(fov - fovBefore) > 1 || Math.abs(fov - fovAfter) > 1) {
        failures.push('camera field of view jumps at handoff');
    }
    if (!Number.isFinite(handoff.hudFadeSeconds) || handoff.hudFadeSeconds < 0.4) {
        failures.push('HUD fade is missing or abrupt');
    }
    return { at: handoff.at, playerIndex: handoff.playerIndex, seam, beforeSpeed, afterSpeed,
        rotation, fov, failures };
}

export function validateEvidence(brief, value) {
    if (!value || value.contractVersion !== SHORT_EVIDENCE_VERSION) {
        throw new Error(`evidence needs ${SHORT_EVIDENCE_VERSION}`);
    }
    if (value.briefId !== brief.id || value.mode !== brief.mode || value.mapKey !== brief.mapKey) {
        throw new Error('evidence does not match the brief');
    }
    requireText(value.buildCommit, 'evidence.buildCommit');
    if (value.media && (typeof value.media !== 'object'
        || ['video', 'cover', 'subtitles'].some((kind) => !/^[A-Za-z0-9._-]+$/.test(value.media[kind] || '')))) {
        throw new Error('evidence.media needs safe video, cover and subtitles filenames');
    }
    if (!Array.isArray(value.assets) || !value.assets.length
        || value.assets.some((asset) => !asset?.id || !asset?.source)
        || new Set(value.assets.map((asset) => asset.id)).size !== value.assets.length) {
        throw new Error('evidence.assets must identify every visual and audio source');
    }
    if (!Array.isArray(value.events)) throw new Error('evidence.events is required');
    const ids = new Set();
    let previousTime = -1;
    for (const event of value.events) {
        const id = requireText(event?.id, 'event.id');
        if (ids.has(id)) throw new Error(`duplicate event ${id}`);
        ids.add(id);
        requireText(event.type, 'event.type');
        const at = finiteSeconds(event.at, `event ${id}`);
        if (at < previousTime) throw new Error('events must be chronological');
        previousTime = at;
    }
    const missingEvents = brief.requiredEvents.filter((type) => !value.events.some((event) => event.type === type));
    if (missingEvents.length) throw new Error(`required events missing: ${missingEvents.join(', ')}`);
    if (!Array.isArray(value.timeline) || value.timeline.length < 2) throw new Error('evidence.timeline is required');
    let outputEnd = 0;
    let sourceEnd = 0;
    const cameraCuts = [];
    for (const [index, shot] of value.timeline.entries()) {
        if (!['cinematic', 'gameplay', 'endcard'].includes(shot.kind)
            || !Number.isFinite(shot.duration) || shot.duration <= 0
            || Math.abs(shot.outputStart - outputEnd) > 0.001) {
            throw new Error('timeline has a gap, overlap or invalid shot');
        }
        if (shot.kind !== 'endcard') {
            finiteSeconds(shot.sourceTime, 'timeline.sourceTime');
            if (shot.sourceTime + 0.001 < sourceEnd) throw new Error('timeline runs gameplay backward');
            sourceEnd = shot.sourceTime + shot.duration;
        } else if (index !== value.timeline.length - 1) throw new Error('endcard must be last');
        if (index && shot.kind !== 'endcard' && value.timeline[index - 1].kind !== shot.kind) {
            cameraCuts.push(shot.outputStart);
        }
        outputEnd += shot.duration;
    }
    if (outputEnd < SHORT_DURATION.min || outputEnd > SHORT_DURATION.max) {
        throw new Error('timeline must last 10-30 seconds including endcard');
    }
    const gameplayEnd = Math.max(...value.timeline.filter((shot) => shot.kind !== 'endcard')
        .map((shot) => shot.outputStart + shot.duration));
    if (value.events.some((event) => event.at > gameplayEnd + 0.001)) {
        throw new Error('recorded event falls outside the gameplay timeline');
    }
    if (!Array.isArray(value.trailsAtStart) || new Set(value.trailsAtStart.filter((trail) =>
        Number.isInteger(trail?.playerId) && Number.isInteger(trail?.segmentCount)
        && trail.segmentCount >= 6).map((trail) => trail.playerId)).size < 2) {
        throw new Error('first gameplay frame needs recorded trails from two players');
    }
    if (!Array.isArray(value.handoffs) || !value.handoffs.length) {
        throw new Error('camera handoff evidence is missing');
    }
    const handoffs = value.handoffs.map((handoff) => {
        if (handoff.playerIndex !== brief.subjectPlayer) throw new Error('handoff switches to the wrong player');
        return checkHandoffMotion(handoff);
    });
    if (cameraCuts.some((at) => !handoffs.some((handoff) => Math.abs(handoff.at - at) < 0.01))) {
        throw new Error('camera cut has no matching handoff evidence');
    }
    const failures = handoffs.flatMap((handoff) => handoff.failures.map((failure) => `${handoff.at}s: ${failure}`));
    if (failures.length) throw new Error(failures.join('; '));
    return { events: value.events, handoffs, trailsAtStart: value.trailsAtStart,
        timeline: value.timeline, gameplayEnd };
}

export function validateCopy(brief, evidence, value) {
    if (!value || value.language !== 'en') throw new Error('public copy must be English');
    const eventIds = new Set(evidence.events.map((event) => event.id));
    const checkClaim = (claim, label) => {
        requireText(claim?.text, label);
        if (NON_GAMEPLAY_COPY.has(claim.kind)) return;
        if (claim.kind === 'approved-fact') {
            if (!brief.approvedFacts?.some((fact) => fact.id === claim.factId && fact.approvedBy)) {
                throw new Error(`${label} needs an approved product fact`);
            }
            return;
        }
        if (!['gameplay', 'aftermath'].includes(claim.kind)
            || !Array.isArray(claim.eventIds) || !claim.eventIds.length
            || claim.eventIds.some((id) => !eventIds.has(id))) {
            throw new Error(`${label} needs recorded event IDs`);
        }
    };
    checkClaim(value.title, 'copy.title');
    if (!Array.isArray(value.description) || !value.description.length) throw new Error('copy.description is required');
    value.description.forEach((claim, index) => checkClaim(claim, `copy.description[${index}]`));
    if (!Array.isArray(value.captions) || !value.captions.length) throw new Error('copy.captions is required');
    const outputEnd = evidence.timeline.at(-1).outputStart + evidence.timeline.at(-1).duration;
    let previousEnd = 0;
    for (const [index, caption] of value.captions.entries()) {
        checkClaim(caption, `copy.captions[${index}]`);
        const start = finiteSeconds(caption.start, 'caption.start');
        const end = finiteSeconds(caption.end, 'caption.end');
        if (start < previousEnd || end - start < 0.8 || end > outputEnd) {
            throw new Error('captions overlap, are too short or exceed the short');
        }
        previousEnd = end;
        if (['gameplay', 'aftermath'].includes(caption.kind) && !caption.eventIds.some((id) => {
            const at = evidence.events.find((event) => event.id === id)?.at;
            return caption.kind === 'aftermath'
                ? at <= start && start - at <= 2
                : at >= start - 0.5 && at <= end + 0.5;
        })) throw new Error('gameplay caption is not timed to its evidence');
    }
    if (value.callToAction?.url !== brief.callToAction.url) throw new Error('copy uses the wrong link');
    return value;
}

export function validateReview(review, brief, evidence) {
    if (review?.contractVersion !== SHORT_REVIEW_VERSION || review.briefId !== brief.id) {
        throw new Error(`review needs ${SHORT_REVIEW_VERSION} and matching brief`);
    }
    if (brief.mapKey === 'standard') throw new Error('the standard arena is not an approved distinctive marketing map');
    if (!review.fullWatch?.withSound || !review.fullWatch?.withoutSound
        || !review.fullWatch?.visualStory || !review.fullWatch?.mobileFraming
        || !review.fullWatch?.distinctiveMap || !review.fullWatch?.trailsReadable
        || !review.fullWatch?.playersReadable || !review.fullWatch?.transitionsSmooth
        || !review.fullWatch?.captionsReadable || !review.fullWatch?.noFlash
        || !review.fullWatch?.musicAndEffects || !review.fullWatch?.cover) {
        throw new Error('complete phone review with and without sound is required');
    }
    if (!Array.isArray(review.testers) || review.testers.length !== 5
        || review.testers.some((tester) => tester?.independent !== true || !tester?.testerId)
        || new Set(review.testers.map((tester) => tester.testerId)).size !== 5
        || review.testers.filter((tester) => tester?.understood === true).length < 4) {
        throw new Error('at least four of five independent viewers must understand the clip without sound');
    }
    if (!Array.isArray(review.rights) || !review.rights.length
        || !evidence?.assets?.every((asset) => review.rights.some((right) =>
            right.assetId === asset.id && right.source === asset.source))
        || review.rights.some((right) => !evidence.assets.some((asset) => asset.id === right.assetId)
            || !right?.approvedBy || !right?.evidence
            || !brief.platforms.every((platform) => right.platforms?.includes(platform)))) {
        throw new Error('commercial rights need evidence and approval for every destination');
    }
    if (!review.developmentStatusApproved || !review.claimsApproved || !review.linkApproved
        || !review.reviewer || !review.reviewedAt || !review.phoneDevice) {
        throw new Error('development status, claims, link and reviewer signoff are required');
    }
    return { understood: review.testers.filter((tester) => tester.understood).length,
        reviewer: review.reviewer, reviewedAt: review.reviewedAt, phoneDevice: review.phoneDevice };
}

export function validateModelUsage(usage) {
    if (!usage || !Number.isInteger(usage.calls) || usage.calls < 0
        || !Number.isInteger(usage.inputTokens) || usage.inputTokens < 0
        || !Number.isInteger(usage.outputTokens) || usage.outputTokens < 0
        || !Number.isInteger(usage.cachedTokens) || usage.cachedTokens < 0
        || usage.cachedTokens > usage.inputTokens
        || !Number.isInteger(usage.revisions) || usage.revisions < 0) {
        throw new Error('model usage needs nonnegative measured counts');
    }
    if (usage.calls === 0 && (usage.inputTokens || usage.outputTokens || usage.cachedTokens || usage.revisions)) {
        throw new Error('zero model calls cannot have token usage or model revisions');
    }
    if (usage.calls > 0 && !usage.source) throw new Error('model usage needs a measurement source');
    return usage;
}
