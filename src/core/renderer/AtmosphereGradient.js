import { HAZE_BAND, SKY_LOWER_EXPONENT, SKY_UPPER_EXPONENT } from './SceneEnvironmentFactory.js';

// Shared linear-light gradient; output conversion happens only after interpolation.
export const ATMOSPHERE_GRADIENT_GLSL = /* glsl */`
vec3 atmosphereGradient( float elevation, vec3 zenith, vec3 horizon, vec3 nadir, vec3 haze ) {
    elevation = clamp( elevation, -1.0, 1.0 );
    vec3 color = elevation >= 0.0
        ? mix( horizon, zenith, pow( elevation, ${SKY_UPPER_EXPONENT.toFixed(2)} ) )
        : mix( horizon, nadir, pow( -elevation, ${SKY_LOWER_EXPONENT.toFixed(2)} ) );
    float hazeNearness = max( 0.0, 1.0 - abs( elevation ) / ${HAZE_BAND.toFixed(3)} );
    return mix( color, haze, smoothstep( 0.0, 1.0, hazeNearness ) );
}
`;
