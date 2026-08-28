import * as THREE from 'three';
import {
    HAZE_BAND,
    SKY_LOWER_EXPONENT,
    SKY_UPPER_EXPONENT,
} from './SceneEnvironmentFactory.js';

const SKY_DOME_VERTEX_SHADER = /* glsl */`
varying vec3 vSkyDirection;

void main() {

	vSkyDirection = normalize( position );
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

}
`;

const SKY_DOME_FRAGMENT_SHADER = /* glsl */`
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 nadirColor;
uniform vec3 hazeColor;
varying vec3 vSkyDirection;

void main() {

	vec3 direction = normalize( vSkyDirection );
	float elevation = clamp( direction.y, -1.0, 1.0 );
	vec3 skyColor = elevation >= 0.0
		? mix( horizonColor, zenithColor, pow( elevation, ${SKY_UPPER_EXPONENT.toFixed(2)} ) )
		: mix( horizonColor, nadirColor, pow( -elevation, ${SKY_LOWER_EXPONENT.toFixed(2)} ) );
	float hazeNearness = max( 0.0, 1.0 - abs( elevation ) / ${HAZE_BAND.toFixed(3)} );
	skyColor = mix( skyColor, hazeColor, smoothstep( 0.0, 1.0, hazeNearness ) );
	gl_FragColor = vec4( skyColor, 1.0 );
	#include <colorspace_fragment>

}
`;

// The visible dome's gradient is evaluated per fragment. Updating the Color values rather than
// replacing uniforms lets map changes reuse the compiled material and its uniform objects.
export function createSkyDomeMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            zenithColor: { value: new THREE.Color() },
            horizonColor: { value: new THREE.Color() },
            nadirColor: { value: new THREE.Color() },
            hazeColor: { value: new THREE.Color() },
        },
        vertexShader: SKY_DOME_VERTEX_SHADER,
        fragmentShader: SKY_DOME_FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
    });
}

export function updateSkyDomeMaterial(material, colors, hazeColor) {
    const { uniforms } = material;
    uniforms.zenithColor.value.setHex(colors.zenithColor);
    uniforms.horizonColor.value.setHex(colors.horizonColor);
    uniforms.nadirColor.value.setHex(colors.nadirColor);
    uniforms.hazeColor.value.setHex(hazeColor);
    return material;
}

export const SKY_DOME_SHADER_SOURCES = Object.freeze({
    vertex: SKY_DOME_VERTEX_SHADER,
    fragment: SKY_DOME_FRAGMENT_SHADER,
});
