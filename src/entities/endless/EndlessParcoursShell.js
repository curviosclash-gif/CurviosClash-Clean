import { ENDLESS_COURSE_HALF_WIDTH, ENDLESS_COURSE_SEGMENTS } from './EndlessParcoursConnectors.js';

/** Shared dimensions for the existing stepped shell and its exclusion volume. */
export const ENDLESS_COURSE_SHELL = Object.freeze({
    halfWidth: ENDLESS_COURSE_HALF_WIDTH,
    segments: ENDLESS_COURSE_SEGMENTS,
    wallThickness: 8,
    wallHeight: 34,
    wallBottom: -10,
    floorY: -11,
    floorThickness: 1.2,
    segmentOverlap: 1.35,
});
