// ============================================
// three-disposal.js - Helper fuer robustes Three.js Resource-Cleanup
// ============================================

function _disposeTexture(texture, seenTextures) {
    if (!texture || !texture.isTexture) return;
    if (seenTextures.has(texture)) return;
    seenTextures.add(texture);
    texture.dispose();
}

export function disposeMaterialResources(material, state = {}) {
    const seenMaterials = state.seenMaterials || new Set();
    const seenTextures = state.seenTextures || new Set();
    const skipMaterial = typeof state.skipMaterial === 'function'
        ? state.skipMaterial
        : (entry) => entry?.userData?.__sharedNoDispose === true;

    if (!material) return;
    if (Array.isArray(material)) {
        for (const entry of material) {
            disposeMaterialResources(entry, { seenMaterials, seenTextures, skipMaterial });
        }
        return;
    }

    if (skipMaterial(material) || seenMaterials.has(material)) {
        return;
    }
    seenMaterials.add(material);

    // Standard-Materialien halten Texturen als direkte Properties (map, normalMap, ...).
    for (const key of Object.keys(material)) {
        const value = material[key];
        if (!value) continue;
        if (value.isTexture) {
            _disposeTexture(value, seenTextures);
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                _disposeTexture(item, seenTextures);
            }
        }
    }

    // ShaderMaterial-Uniforms koennen ebenfalls Texturen enthalten.
    if (material.uniforms && typeof material.uniforms === 'object') {
        for (const uniform of Object.values(material.uniforms)) {
            const value = uniform?.value;
            if (!value) continue;
            if (value.isTexture) {
                _disposeTexture(value, seenTextures);
                continue;
            }
            if (Array.isArray(value)) {
                for (const item of value) {
                    _disposeTexture(item, seenTextures);
                }
            }
        }
    }

    material.dispose();
}

export function disposeObject3DResources(root, options = {}) {
    if (!root || typeof root.traverse !== 'function') return;

    const seenGeometries = new Set();
    const seenMaterials = new Set();
    const seenTextures = new Set();
    const skipGeometry = typeof options.skipGeometry === 'function'
        ? options.skipGeometry
        : (geometry) => geometry?.userData?.__sharedNoDispose === true;
    const skipMaterial = typeof options.skipMaterial === 'function'
        ? options.skipMaterial
        : (material) => material?.userData?.__sharedNoDispose === true;

    root.traverse((child) => {
        if (child?.isInstancedMesh && typeof child.dispose === 'function') {
            child.dispose();
        }

        const geometry = child?.geometry;
        if (
            geometry &&
            typeof geometry.dispose === 'function' &&
            !skipGeometry(geometry) &&
            !seenGeometries.has(geometry)
        ) {
            seenGeometries.add(geometry);
            geometry.dispose();
        }

        if (child?.material) {
            disposeMaterialResources(child.material, {
                seenMaterials,
                seenTextures,
                skipMaterial,
            });
        }
    });
}
