import { GROUND } from '../notre_dame/NotreDameStructure.js';

// A deterministic, all-particle fire layer. Sparks are the fire's visible language: they rise
// from several roof breaches instead of forming opaque, static-looking flame cones.
export const NOTRE_DAME_FIRE_FX = Object.freeze({
    emitters: Object.freeze([
        Object.freeze({
            position: Object.freeze([-46, GROUND + 39, -10]),
            radius: 11,
            smokeHeight: 58,
            emberHeight: 34,
            phase: 0.08,
        }),
        Object.freeze({
            position: Object.freeze([-26, GROUND + 48, 8]),
            radius: 12,
            smokeHeight: 66,
            emberHeight: 40,
            phase: 0.21,
        }),
        Object.freeze({
            position: Object.freeze([-4, GROUND + 51, -6]),
            radius: 13,
            smokeHeight: 74,
            emberHeight: 43,
            phase: 0.36,
        }),
        Object.freeze({
            position: Object.freeze([13, GROUND + 42, 9]),
            radius: 15,
            smokeHeight: 80,
            emberHeight: 46,
            phase: 0.49,
        }),
        Object.freeze({
            position: Object.freeze([28, GROUND + 47, -11]),
            radius: 12,
            smokeHeight: 70,
            emberHeight: 39,
            phase: 0.61,
        }),
        Object.freeze({
            position: Object.freeze([47, GROUND + 43, 7]),
            radius: 11,
            smokeHeight: 62,
            emberHeight: 35,
            phase: 0.73,
        }),
        Object.freeze({
            position: Object.freeze([63, GROUND + 38, -5]),
            radius: 10,
            smokeHeight: 54,
            emberHeight: 31,
            phase: 0.86,
        }),
        Object.freeze({
            position: Object.freeze([79, GROUND + 34, 6]),
            radius: 9,
            smokeHeight: 48,
            emberHeight: 28,
            phase: 0.97,
        }),
    ]),
    smoke: Object.freeze({
        count: 54,
        color: 0x2b1512,
        size: 11,
        lifetime: 12,
        opacity: 0.28,
    }),
    embers: Object.freeze({
        count: 128,
        color: 0xff7b24,
        size: 0.82,
        lifetime: 5.6,
        opacity: 0.96,
    }),
    ash: Object.freeze({
        count: 72,
        color: 0xc4aea0,
        size: 0.42,
        lifetime: 14,
        opacity: 0.5,
    }),
    // The prevailing wind carries the column west, into the route's first long sightline.
    wind: Object.freeze([-3.4, 0.8, 1.15]),
    ashVolumeMin: Object.freeze([-205, GROUND + 3, -82]),
    ashVolumeMax: Object.freeze([118, GROUND + 112, 82]),
    // The two endpoint fill lights stay constant; only sources physically attached to flames pulse.
    flicker: Object.freeze([
        Object.freeze({ lightId: 'ndf_crossing_breach', amplitude: 0.14, frequency: 1.37, phase: 0.1 }),
        Object.freeze({ lightId: 'ndf_transept_breach', amplitude: 0.12, frequency: 1.83, phase: 1.4 }),
        Object.freeze({ lightId: 'ndf_aisle_breach', amplitude: 0.1, frequency: 2.17, phase: 2.2 }),
        Object.freeze({ lightId: 'ndf_attic_west', amplitude: 0.11, frequency: 1.11, phase: 3.3 }),
        Object.freeze({ lightId: 'ndf_attic_east', amplitude: 0.1, frequency: 1.61, phase: 4.7 }),
        Object.freeze({ lightId: 'ndf_debris_glow', amplitude: 0.08, frequency: 0.79, phase: 5.4 }),
    ]),
});
