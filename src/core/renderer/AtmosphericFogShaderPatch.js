import * as THREE from 'three';
import { HAZE_BAND } from './SceneEnvironmentFactory.js';

// Three's own fog is a pure distance ramp: smoothstep(fogNear, fogFar, depth). It saturates
// completely at fogFar, so every surface beyond that distance lands on one identical colour, at
// every height, without any structure. A large area of a single flat colour is exactly what a
// painted surface looks like - which is why the darkness read as a wall rather than as air.
//
// This module replaces the three fog chunks once, globally, before the first material compiles. It
// is the only place in src/ that touches three's shader sources; see
// docs/adr/0008-atmospheric-fog-shader-patch.md for why it is a global patch and not a per-material
// one.
//
// Three shortcomings are addressed together because they are three terms of the same formula:
//   - the distance ramp becomes exponential, so it never reaches a flat plateau,
//   - the density falls off with world height, so fog behaves like a layer and not like a sphere,
//   - a slow world-space field modulates the density, so the fog has visible structure.

// The distance curve is 1 - exp(-rate * t^2), with t counted from fogNear. Squaring t is what makes
// the *onset* gentle: the slope at t = 0 is zero, so the fog does not switch on along a line at
// fogNear the way a plain exponential does. At t = 1, that is at fogFar, the rate below reaches
// 0.982 - opaque enough that the remaining 2% cannot pop when the camera's far plane clips it, while
// the curve still approaches 1 asymptotically instead of flattening into a plate beyond it.
const FOG_FALLOFF_RATE = 4.0;

// Softness of the knee at the fog layer's base height, in world units. exp(-max(0, y - base) * k)
// has a continuous value but a jump in slope exactly at the base, which shows up as a horizontal
// crease running through the scene. Six metres of rounding hides the crease without visibly lifting
// the layer.
const FOG_HEIGHT_SOFTNESS = 6.0;

// Wavelength of the density field in world units. Long enough to read as drifting banks rather than
// as noise, short enough that a 260 metre map shows more than one of them.
const FOG_NOISE_SCALE = 0.06;

// Where the closure towards the camera's far plane begins, as a fraction of the clip distance. This
// is a per-map value rather than one constant, because maps pull it in opposite directions: a thin
// fog capped low by its height term needs a long blend, or it has to travel the whole remaining
// density inside a few dozen metres, which the eye resolves as a boundary. A dense fog wants the
// opposite - a late start, so the mid range keeps its structure instead of being washed flat.
// The default is the late one; a map states an earlier start when its fog is thin.
const DEFAULT_FOG_CLIP_CLOSURE_START = 0.8;

const FOG_PARS_VERTEX = /* glsl */`
#ifdef USE_FOG

	varying float vFogDepth;
	varying vec3 vFogWorldPosition;
	varying vec3 vFogViewOffset;

#endif
`;

// mvPosition is in scope wherever three includes fog_vertex, and cameraPosition plus viewMatrix are
// part of the default vertex prefix. Rebuilding the world position from those three avoids relying
// on worldpos_vertex, which three only emits for envmap, shadow and transmission materials, and
// avoids inverse(), which is not available under GLSL ES 1.00. In GLSL v * M evaluates M^T * v, so
// the multiply below is the inverse rotation of the view matrix.
const FOG_VERTEX = /* glsl */`
#ifdef USE_FOG

	vFogDepth = - mvPosition.z;
	// The offset from the camera in world space. Its normalized y is the elevation the fragment is
	// seen at - the same variable the sky dome's gradient runs on, which is what lets the two agree.
	vFogViewOffset = mvPosition.xyz * mat3( viewMatrix );
	vFogWorldPosition = vFogViewOffset + cameraPosition;

#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */`
#ifdef USE_FOG

	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorldPosition;

	uniform float fogHeightBase;
	uniform float fogHeightFalloff;
	uniform float fogTurbulence;
	uniform float fogClipDistance;
	uniform float fogClipClosureStart;
	uniform vec3 fogHighColor;
	uniform vec3 fogLowColor;
	varying vec3 vFogViewOffset;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else

		uniform float fogNear;
		uniform float fogFar;

	#endif

	// A product of sines rather than a hash: no texture, no derivatives, and band limited by
	// construction, which matters because this runs on every fogged fragment.
	float atmosphericFogField( vec3 point ) {
		return sin( point.x ) * sin( point.y * 1.7 + 1.3 ) * sin( point.z * 1.3 + 2.1 );
	}

	// A max( 0.0, x ) with the corner rounded off over the given softness. It matches max() once x is
	// well past the knee and goes to zero well before it, but its slope is continuous throughout -
	// which is the whole point, because a jump in slope is exactly what the eye reads as an edge.
	float fogSoftKnee( float x, float softness ) {
		return 0.5 * ( x + sqrt( x * x + softness * softness ) );
	}

#endif
`;

const FOG_FRAGMENT = /* glsl */`
#ifdef USE_FOG

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

	#else

		float fogTravel = max( 0.0, vFogDepth - fogNear ) / max( 0.001, fogFar - fogNear );
		float fogFactor = 1.0 - exp( - ${FOG_FALLOFF_RATE.toFixed(2)} * fogTravel * fogTravel );

	#endif

	if ( fogHeightFalloff > 0.0 ) {

		float fogHeightAbove = fogSoftKnee(
			vFogWorldPosition.y - fogHeightBase,
			${FOG_HEIGHT_SOFTNESS.toFixed(1)}
		);
		fogFactor *= exp( - fogHeightAbove * fogHeightFalloff );

	}

	if ( fogTurbulence > 0.0 ) {

		vec3 fogFieldPoint = vFogWorldPosition * ${FOG_NOISE_SCALE.toFixed(3)};
		float fogField = atmosphericFogField( fogFieldPoint ) * 0.65
			+ atmosphericFogField( fogFieldPoint * 2.3 + 4.7 ) * 0.35;
		fogFactor *= 1.0 + fogTurbulence * fogField;

	}

	// The camera clips everything past its far plane. If the fog has not fully closed by then, a
	// surface is still faintly visible in the frame it crosses that plane and simply vanishes in the
	// next one - a hard ring at a fixed distance, exactly the kind of edge every other term here is
	// shaped to avoid.
	//
	// This used to take the larger of the fog and the closure. A max() of two curves has a kink wherever
	// they cross - the same jump in slope that fogSoftKnee exists to round off - and this one sat at a
	// fixed distance from the camera, so it drew a shell around the viewer. Where that shell cut a
	// long wall or the ground it left a crisp line with one flat colour behind it, which is exactly
	// what a painted surface looks like. mix() has no crossing to kink at: the closure enters and
	// leaves with zero slope, so the blend is smooth wherever fogFactor already is, and it still
	// arrives at exactly 1.0 at the clip distance.
	fogFactor = mix(
		fogFactor,
		1.0,
		smoothstep( fogClipDistance * fogClipClosureStart, fogClipDistance, vFogDepth )
	);

	// The fog's colour runs on the elevation a fragment is *seen* at, not on its height in the world.
	// That distinction is the whole point: the sky's haze band runs on elevation too, so a fully
	// fogged surface lands on the same colour as the sky right behind it and simply stops having a
	// silhouette. Driving this from world height instead put a tall, distant building at the black
	// end of the run while the low sky behind it was still red - a hard edge that no amount of
	// density shaping could remove.
	//
	// The curve below is the sky's haze band: full fogColor at the horizon, releasing to separate
	// colours above and below it. Reusing fogHighColor on both sides turned a deliberately black sky
	// into a black distant floor too, which is exactly the flat plate this shader is meant to avoid.
	float fogElevation = normalize( vFogViewOffset ).y;
	float fogHaze = max( 0.0, 1.0 - abs( fogElevation ) / ${HAZE_BAND.toFixed(3)} );
	vec3 fogEdgeColor = fogElevation >= 0.0 ? fogHighColor : fogLowColor;
	vec3 fogTint = mix( fogEdgeColor, fogColor, fogHaze * fogHaze * ( 3.0 - 2.0 * fogHaze ) );

	float clampedFogFactor = clamp( fogFactor, 0.0, 1.0 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, clampedFogFactor );

	// A boundary wall seen almost parallel to its surface ends in a real geometric silhouette:
	// one ray misses it and the next one still hits it close to the clip distance. Matching the
	// fragment's RGB to the sky removes most of that step, but a transparent wall still composites
	// its authored opacity at the last visible pixel. Opted-in boundary materials therefore release
	// their alpha with the same continuous fog curve. Nearby walls are unchanged, and other fogged
	// transparent materials keep their authored opacity.
	#ifdef ATMOSPHERIC_FOG_ALPHA_FADE

		gl_FragColor.a *= 1.0 - clampedFogFactor;

	#endif

#endif
`;

// One uniform object per parameter, shared by every material in the scene. three clones
// UniformsLib entries per material, so a value handed out there could never be updated again; a
// shared object injected through onBeforeCompile survives, because the renderer keeps exactly the
// object it was given (WebGLRenderer.getProgram: materialProperties.uniforms = parameters.uniforms).
const sharedFogUniforms = {
    fogHeightBase: { value: 0 },
    fogHeightFalloff: { value: 0 },
    fogTurbulence: { value: 0 },
    // Set from the camera's far plane, not from the map - a very large default keeps the term
    // inactive until someone states the real one.
    fogClipDistance: { value: 1e6 },
    // three uploads fogColor in the *output* colour space, so the colour the height gradient runs
    // towards has to be handed over the same way or the two ends would not sit on one curve.
    fogHighColor: { value: new THREE.Vector3(0, 0, 0) },
    fogLowColor: { value: new THREE.Vector3(0, 0, 0) },
    fogClipClosureStart: { value: DEFAULT_FOG_CLIP_CLOSURE_START },
};

const HIGH_COLOR = new THREE.Color();
const HIGH_COLOR_RGB = { r: 0, g: 0, b: 0 };
const LOW_COLOR = new THREE.Color();
const LOW_COLOR_RGB = { r: 0, g: 0, b: 0 };

const PATCHED_CHUNKS = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment'];

let installed = false;
let originalOnBeforeCompile = null;
let originalChunks = null;

function injectAtmosphericFogUniforms(shader) {
    shader.uniforms.fogHeightBase = sharedFogUniforms.fogHeightBase;
    shader.uniforms.fogHeightFalloff = sharedFogUniforms.fogHeightFalloff;
    shader.uniforms.fogTurbulence = sharedFogUniforms.fogTurbulence;
    shader.uniforms.fogClipDistance = sharedFogUniforms.fogClipDistance;
    shader.uniforms.fogHighColor = sharedFogUniforms.fogHighColor;
    shader.uniforms.fogLowColor = sharedFogUniforms.fogLowColor;
    shader.uniforms.fogClipClosureStart = sharedFogUniforms.fogClipClosureStart;
}

// The distance at which the camera stops drawing. The fog has to be fully closed by then, otherwise
// geometry disappears while still faintly visible.
export function setAtmosphericFogClipDistance(distance) {
    const numeric = Number(distance);
    sharedFogUniforms.fogClipDistance.value = Number.isFinite(numeric) && numeric > 0 ? numeric : 1e6;
    return sharedFogUniforms.fogClipDistance.value;
}

// Must run before the first material compiles, otherwise a cached program keeps three's chunks.
export function installAtmosphericFog() {
    if (installed) return false;
    originalChunks = Object.fromEntries(
        PATCHED_CHUNKS.map((name) => [name, THREE.ShaderChunk[name]])
    );
    THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
    THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
    THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
    THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;

    // Patched on the prototype rather than per material: every mesh in the scene is fogged, and the
    // alternative would mean reaching into every material built anywhere in entities/ and in the GLB
    // loader. The default customProgramCacheKey returns onBeforeCompile.toString(), and one shared
    // function means one shared key - so this does not fragment the program cache.
    originalOnBeforeCompile = THREE.Material.prototype.onBeforeCompile;
    THREE.Material.prototype.onBeforeCompile = function atmosphericFogOnBeforeCompile(shader, renderer) {
        injectAtmosphericFogUniforms(shader);
        originalOnBeforeCompile.call(this, shader, renderer);
    };
    installed = true;
    return true;
}

export function isAtmosphericFogInstalled() {
    return installed;
}

/**
 * @param {{height?: unknown, heightFalloff?: unknown, turbulence?: unknown, colorHigh?: unknown, colorLow?: unknown}} settings
 */
export function applyAtmosphericFogSettings(settings) {
    const height = Number(settings?.height);
    const heightFalloff = Number(settings?.heightFalloff);
    const turbulence = Number(settings?.turbulence);
    sharedFogUniforms.fogHeightBase.value = Number.isFinite(height) ? height : 0;
    sharedFogUniforms.fogHeightFalloff.value = Number.isFinite(heightFalloff)
        ? Math.max(0, heightFalloff)
        : 0;
    sharedFogUniforms.fogTurbulence.value = Number.isFinite(turbulence)
        ? Math.min(1, Math.max(0, turbulence))
        : 0;

    const clipClosureStart = Number(settings?.clipClosureStart);
    sharedFogUniforms.fogClipClosureStart.value = Number.isFinite(clipClosureStart)
        ? Math.min(0.95, Math.max(0.1, clipClosureStart))
        : DEFAULT_FOG_CLIP_CLOSURE_START;

    const colorHigh = Number(settings?.colorHigh);
    HIGH_COLOR.setHex(Number.isFinite(colorHigh) ? colorHigh : 0);
    HIGH_COLOR.getRGB(HIGH_COLOR_RGB, THREE.SRGBColorSpace);
    sharedFogUniforms.fogHighColor.value.set(HIGH_COLOR_RGB.r, HIGH_COLOR_RGB.g, HIGH_COLOR_RGB.b);

    // Before colorLow existed the high colour was mirrored below the horizon. Preserve that direct
    // API fallback for callers that bypass MapLightingContract while allowing map profiles to keep
    // a black zenith without painting their distant floor black as well.
    const colorLow = Number(settings?.colorLow);
    LOW_COLOR.setHex(Number.isFinite(colorLow) ? colorLow : (Number.isFinite(colorHigh) ? colorHigh : 0));
    LOW_COLOR.getRGB(LOW_COLOR_RGB, THREE.SRGBColorSpace);
    sharedFogUniforms.fogLowColor.value.set(LOW_COLOR_RGB.r, LOW_COLOR_RGB.g, LOW_COLOR_RGB.b);

    return getAtmosphericFogSettings();
}

export function getAtmosphericFogSettings() {
    return {
        height: sharedFogUniforms.fogHeightBase.value,
        heightFalloff: sharedFogUniforms.fogHeightFalloff.value,
        turbulence: sharedFogUniforms.fogTurbulence.value,
        clipClosureStart: sharedFogUniforms.fogClipClosureStart.value,
        colorHigh: sharedFogUniforms.fogHighColor.value.toArray(),
        colorLow: sharedFogUniforms.fogLowColor.value.toArray(),
    };
}

// Exposed so a test can prove the injected uniform object is shared rather than cloned per material.
export function getAtmosphericFogUniforms() {
    return sharedFogUniforms;
}

export function uninstallAtmosphericFog() {
    if (!installed) return false;
    for (const name of PATCHED_CHUNKS) THREE.ShaderChunk[name] = originalChunks[name];
    THREE.Material.prototype.onBeforeCompile = originalOnBeforeCompile;
    originalChunks = null;
    installed = false;
    return true;
}
