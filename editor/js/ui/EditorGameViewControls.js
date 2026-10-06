import * as THREE from 'three';
import { SceneLightingRig } from '../../../src/core/renderer/SceneLightingRig.js';
import { SceneEnvironmentController } from '../../../src/core/renderer/SceneEnvironmentFactory.js';
import {
    installAtmosphericFog,
    isAtmosphericFogInstalled,
    setAtmosphericFogClipDistance,
    uninstallAtmosphericFog,
} from '../../../src/core/renderer/AtmosphericFogShaderPatch.js';
import {
    applyEditorGameLighting,
    createEditorGameViewConfig,
    resolveEditorArenaShadowBounds,
    resolveEditorGameFogRange,
} from '../EditorGameView.js';
import { resolveEditorUnitsPerWorldUnit } from '../EditorShipFlight.js';

function forEachMaterial(root, callback) {
    root.traverse((node) => {
        const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
        materials.forEach(callback);
    });
}

/**
 * "Spielansicht": swaps the editor's flat work light for the match lighting rig, sky dome,
 * atmospheric fog, reflections and tone mapping, and shows the parts solid. Switching back
 * restores the editor look exactly as it was.
 */
export function bindEditorGameViewControls(editor) {
    const core = editor?.core;
    if (!core) return;
    const dom = editor.dom || {};
    let rig = null;
    let environment = null;
    let fogInstalledHere = false;
    let editorLook = null;
    const gameFog = { near: 0, far: 1 };
    const arenaCenter = new THREE.Vector3();
    const solidMaterialStates = new Map();

    const followCameraWithFog = () => {
        const { width, height, depth } = editor.getArenaSizeForExport();
        arenaCenter.set(0, height / 2, 0);
        const fog = resolveEditorGameFogRange({
            gameFog,
            flying: core.shipFlightActive,
            cameraDistance: core.camera.position.distanceTo(arenaCenter),
            arenaRadius: 0.5 * Math.hypot(width, height, depth),
        });
        core.scene.fog.near = fog.near;
        core.scene.fog.far = fog.far;
    };

    // Fog chunks and tone mapping are compiled into the shader programs.
    const recompileMaterials = () => forEachMaterial(core.scene, (material) => { material.needsUpdate = true; });

    const applyLook = () => {
        if (!rig) return;
        const arenaSize = editor.getArenaSizeForExport();
        rig.setShadowCoverage(resolveEditorArenaShadowBounds(arenaSize));
        const lighting = applyEditorGameLighting(rig, core.scene, {
            mapLighting: editor.mapManager?.mapDocumentMeta?.lighting,
            unitsPerWorldUnit: resolveEditorUnitsPerWorldUnit(arenaSize),
        });
        gameFog.near = core.scene.fog.near;
        gameFog.far = core.scene.fog.far;
        environment.apply('modern', lighting);
        followCameraWithFog();
    };

    const setSolidParts = (solid) => {
        const materials = Object.values(editor.mapManager?.mats || {});
        for (const material of materials) {
            if (solid) {
                solidMaterialStates.set(material, { transparent: material.transparent, opacity: material.opacity });
                material.transparent = false;
                material.opacity = 1;
            } else if (solidMaterialStates.has(material)) {
                Object.assign(material, solidMaterialStates.get(material));
            }
        }
        if (!solid) solidMaterialStates.clear();
    };

    const enableGameView = () => {
        if (rig) return true;
        if (!isAtmosphericFogInstalled()) {
            installAtmosphericFog();
            fogInstalledHere = true;
        }
        setAtmosphericFogClipDistance(core.perspectiveCamera.far);
        editorLook = {
            background: core.scene.background,
            fogColor: core.scene.fog.color.getHex(),
            fogNear: core.scene.fog.near,
            fogFar: core.scene.fog.far,
            toneMapping: core.renderer.toneMapping,
            exposure: core.renderer.toneMappingExposure,
            gridVisible: core.gridHelper?.visible !== false,
        };
        rig = new SceneLightingRig({
            scene: core.scene,
            renderer: core.renderer,
            config: createEditorGameViewConfig(core.perspectiveCamera.far),
        });
        environment = new SceneEnvironmentController(core.renderer, core.scene);
        core.editorLights?.forEach((light) => { light.visible = false; });
        if (core.gridHelper) core.gridHelper.visible = false;
        core.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        setSolidParts(true);
        applyLook();
        core.beforeRenderCallbacks.add(followCameraWithFog);
        recompileMaterials();
        dom.btnGameView?.setAttribute('aria-pressed', 'true');
        document.body.dataset.editorGameView = '1';
        return true;
    };

    const disableGameView = () => {
        if (!rig) return false;
        core.beforeRenderCallbacks.delete(followCameraWithFog);
        rig.dispose();
        environment.dispose();
        rig = null;
        environment = null;
        core.scene.background = editorLook.background;
        core.scene.fog.color.setHex(editorLook.fogColor);
        core.scene.fog.near = editorLook.fogNear;
        core.scene.fog.far = editorLook.fogFar;
        core.renderer.toneMapping = editorLook.toneMapping;
        core.renderer.toneMappingExposure = editorLook.exposure;
        core.editorLights?.forEach((light) => { light.visible = true; });
        if (core.gridHelper) core.gridHelper.visible = editorLook.gridVisible;
        setSolidParts(false);
        if (fogInstalledHere) {
            uninstallAtmosphericFog();
            fogInstalledHere = false;
        }
        recompileMaterials();
        dom.btnGameView?.setAttribute('aria-pressed', 'false');
        document.body.dataset.editorGameView = '0';
        return true;
    };

    dom.btnGameView?.addEventListener('click', () => {
        if (rig) disableGameView();
        else enableGameView();
    });

    editor.enableGameView = enableGameView;
    editor.disableGameView = disableGameView;
    editor.isGameViewActive = () => !!rig;
    // Arena size or map lighting changed: the fog distances and the shadow box follow.
    editor.refreshGameView = applyLook;
}
