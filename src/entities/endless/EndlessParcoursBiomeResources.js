import * as THREE from 'three';
import { ENDLESS_BIOMES } from '../../shared/contracts/EndlessParcoursBiomeContract.js';
import { createEndlessBiomeTextures } from './EndlessParcoursBiomeTextures.js';

function shared(resource) { resource.userData.__sharedNoDispose = true; return resource; }

/** Local haze on this environment's materials; never replace scene/camera underwater fog. */
function installBiomeHaze(material, style, clock = null) {
    const haze = { value: new THREE.Color(style.fog).convertLinearToSRGB() };
    const range = { value: new THREE.Vector2(style.near, style.far) };
    const inheritedCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        inheritedCompile.call(material, shader, renderer);
        shader.uniforms.endlessBiomeHaze = haze;
        shader.uniforms.endlessBiomeRange = range;
        shader.fragmentShader = 'uniform vec3 endlessBiomeHaze;\nuniform vec2 endlessBiomeRange;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
            #include <fog_fragment>
            #ifdef USE_FOG
            gl_FragColor.rgb = mix(gl_FragColor.rgb, endlessBiomeHaze,
                0.55 * smoothstep(endlessBiomeRange.x, endlessBiomeRange.y, vFogDepth));
            #endif
        `);
        if (clock) {
            shader.uniforms.endlessBiomeTime = clock;
            shader.vertexShader = 'uniform float endlessBiomeTime;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
                #include <begin_vertex>
                transformed.y += sin(endlessBiomeTime * 0.7 + position.z) * 0.5;
                transformed.x += sin(endlessBiomeTime * 0.4 + position.y) * 0.3;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
                #include <color_fragment>
                diffuseColor.a *= 1.0 - smoothstep(0.15, 0.5, length(gl_PointCoord - vec2(0.5)));
            `);
        }
    };
    // Uniforms vary by biome; all surfaces can reuse the same compiled shader.
    material.customProgramCacheKey = () => `endless-biome-v1:${clock ? 'particles' : 'surface'}`;
    return shared(material);
}

export function createEndlessBiomeResources() {
    const styles = {}, clock = { value: 0 }, textures = [], materials = [], walls = [];
    for (const [id, style] of Object.entries(ENDLESS_BIOMES)) {
        const maps = createEndlessBiomeTextures(id); textures.push(maps.map, maps.emission);
        const wall = installBiomeHaze(new THREE.MeshStandardMaterial({ color: style.color,
            map: maps.map, bumpMap: maps.map, bumpScale: 0.12, roughness: 0.82,
            emissive: style.glow, emissiveMap: maps.emission, emissiveIntensity: 0.55 }), style);
        const detail = installBiomeHaze(new THREE.MeshStandardMaterial({ color: style.color,
            roughness: 0.75, metalness: id === 'industrial' ? 0.4 : 0.05,
            emissive: style.glow, emissiveIntensity: 0.22 }), style);
        const trim = installBiomeHaze(new THREE.MeshStandardMaterial({ color: 0x101519,
            emissive: style.trim, emissiveIntensity: 0.95, roughness: 0.45 }), style);
        const particles = installBiomeHaze(new THREE.PointsMaterial({ color: style.particle,
            size: id === 'deepsea' ? 0.28 : 0.17, transparent: true, opacity: 0.45,
            depthWrite: false, sizeAttenuation: true }), style, clock);
        styles[id] = { wall, detail, trim, particles }; walls.push(wall);
        materials.push(wall, detail, trim, particles);
    }
    let disposed = false;
    return { styles, clock,
        update(dt, pulse = 0) {
            clock.value += Math.max(0, Number(dt) || 0);
            const intensity = 0.55 + Math.max(0, Math.min(1, pulse)) * 1.2;
            for (const wall of walls) wall.emissiveIntensity = intensity;
        },
        dispose() {
            if (disposed) return; disposed = true;
            for (const material of materials) material.dispose();
            for (const texture of textures) texture.dispose();
        } };
}
