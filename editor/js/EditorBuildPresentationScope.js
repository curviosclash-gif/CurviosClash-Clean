import * as THREE from 'three';
import { getAtmosphericFogUniforms, isAtmosphericFogInstalled, installAtmosphericFog,
    uninstallAtmosphericFog } from '../../src/core/renderer/AtmosphericFogShaderPatch.js';

/** The game renderer shares Three's loader and shader hooks within this editor document. */
export function createEditorBuildPresentationScope(assetBaseUrl, manager = THREE.DefaultLoadingManager) {
    const previousResolve = manager.resolveURL;
    const resolve = (url) => previousResolve.call(manager,
        assetBaseUrl && /^(?:\.\/)?assets\//.test(url) ? new URL(url, assetBaseUrl).href : url);
    manager.resolveURL = resolve;
    const installed = isAtmosphericFogInstalled();
    const uniforms = getAtmosphericFogUniforms();
    const saved = Object.fromEntries(Object.entries(uniforms).map(([key, uniform]) =>
        [key, uniform.value?.clone ? uniform.value.clone() : uniform.value]));
    const restoreFog = () => {
        if (installed) installAtmosphericFog(); else uninstallAtmosphericFog();
        for (const [key, value] of Object.entries(saved)) {
            if (uniforms[key].value?.copy) uniforms[key].value.copy(value);
            else uniforms[key].value = value;
        }
    };
    let disposed = false;
    return {
        restoreFog,
        dispose() {
            if (disposed) return;
            disposed = true;
            if (manager.resolveURL === resolve) manager.resolveURL = previousResolve;
            restoreFog();
        },
    };
}
