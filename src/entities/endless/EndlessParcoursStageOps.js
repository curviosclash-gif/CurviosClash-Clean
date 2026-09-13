import * as THREE from 'three';
import {
    ENDLESS_PARCOURS_CHECKPOINT,
    resolveEndlessStagePalette,
} from '../../shared/contracts/EndlessParcoursStageContract.js';

/** Der Puls beim Stufenwechsel bleibt bewusst unter 2 - darueber reisst das Tone Mapping die Farbe weg. */
const PULSE_PEAK_INTENSITY = 1.8;
const PULSE_SECONDS = 1.4;

function markShared(resource) {
    if (!resource) return resource;
    resource.userData = resource.userData || {};
    resource.userData.__sharedNoDispose = true;
    return resource;
}

/**
 * Alle Materialien der Endlosjagd an einem Ort. Sie werden geteilt und beim
 * Stufenwechsel umgefaerbt, statt pro Baustein neu angelegt zu werden.
 */
export function createEndlessMaterials() {
    const palette = resolveEndlessStagePalette(0);
    return {
        floor: markShared(new THREE.MeshStandardMaterial({
            color: palette.floor, emissive: 0x07131f, roughness: 0.8,
        })),
        wall: markShared(new THREE.MeshStandardMaterial({
            color: palette.wall,
            emissive: palette.wallEmissive,
            emissiveIntensity: palette.wallEmissiveIntensity,
        })),
        obstacle: markShared(new THREE.MeshStandardMaterial({
            color: palette.obstacle, emissive: 0x4a0b18, emissiveIntensity: 0.5,
        })),
        gate: markShared(new THREE.MeshStandardMaterial({
            color: palette.gate, emissive: palette.gateEmissive, emissiveIntensity: 0.9,
        })),
        hazard: markShared(new THREE.MeshStandardMaterial({
            color: 0xff5a3c, emissive: 0x7a1a06, emissiveIntensity: 0.85,
        })),
        hazardOpen: markShared(new THREE.MeshStandardMaterial({
            color: 0x2b4a52, emissive: 0x0a1f24, emissiveIntensity: 0.25,
        })),
        record: markShared(new THREE.MeshStandardMaterial({
            color: 0xf6d365, emissive: 0x8a6512, emissiveIntensity: 0.7,
            transparent: true, opacity: 0.32, depthWrite: false,
        })),
        industrial: markShared(new THREE.MeshStandardMaterial({ color: 0xc9823a, emissive: 0x512407, emissiveIntensity: 0.55 })),
        canyon: markShared(new THREE.MeshStandardMaterial({ color: 0x7fc6a4, emissive: 0x174a38, emissiveIntensity: 0.45 })),
        energy: markShared(new THREE.MeshStandardMaterial({ color: 0x5ee7ff, emissive: 0x126b86, emissiveIntensity: 0.85 })),
        routeRisk: markShared(new THREE.MeshStandardMaterial({ color: 0xffcf55, emissive: 0x8b5500, emissiveIntensity: 0.9 })),
    };
}

/**
 * Faerbt die Strecke auf die Bedrohungsstufe um. Der Stufenwechsel ist damit
 * sichtbar und nicht nur eine Textzeile.
 *
 * @param {Record<string, THREE.MeshStandardMaterial>} materials
 * @param {unknown} tier
 */
export function applyEndlessStagePalette(materials, tier) {
    if (!materials) return null;
    const palette = resolveEndlessStagePalette(tier);
    materials.floor?.color?.setHex?.(palette.floor);
    materials.wall?.color?.setHex?.(palette.wall);
    materials.wall?.emissive?.setHex?.(palette.wallEmissive);
    if (materials.wall) materials.wall.emissiveIntensity = palette.wallEmissiveIntensity;
    materials.obstacle?.color?.setHex?.(palette.obstacle);
    materials.gate?.color?.setHex?.(palette.gate);
    materials.gate?.emissive?.setHex?.(palette.gateEmissive);
    return palette;
}

/**
 * Startet den Wandpuls, mit dem ein Stufenwechsel quittiert wird.
 *
 * @param {any} runtime
 */
export function startEndlessStagePulse(runtime) {
    if (!runtime) return;
    runtime.stagePulseRemaining = PULSE_SECONDS;
}

/**
 * Laesst Wandpuls und Torblitz abklingen. Beides schreibt nur
 * Materialintensitaeten, damit kein Objekt pro Bild neu entsteht.
 *
 * @param {any} runtime
 * @param {number} dt
 */
export function updateEndlessStageEffects(runtime, dt) {
    if (!runtime?._materials) return;
    const safeDt = Math.max(0, Number(dt) || 0);
    const palette = resolveEndlessStagePalette(runtime._activePaletteTier);
    if (runtime.stagePulseRemaining > 0) {
        runtime.stagePulseRemaining = Math.max(0, runtime.stagePulseRemaining - safeDt);
        const progress = runtime.stagePulseRemaining / PULSE_SECONDS;
        const wave = Math.sin(progress * Math.PI * 3) * 0.5 + 0.5;
        if (runtime._materials.wall) {
            runtime._materials.wall.emissiveIntensity = palette.wallEmissiveIntensity
                + (PULSE_PEAK_INTENSITY - palette.wallEmissiveIntensity) * wave * progress;
        }
    } else if (runtime._materials.wall) {
        runtime._materials.wall.emissiveIntensity = palette.wallEmissiveIntensity;
    }
    if (runtime.gateFlashRemaining > 0) {
        runtime.gateFlashRemaining = Math.max(0, runtime.gateFlashRemaining - safeDt);
        const progress = runtime.gateFlashRemaining / ENDLESS_PARCOURS_CHECKPOINT.flashSeconds;
        if (runtime._materials.gate) {
            runtime._materials.gate.emissiveIntensity = 0.9 + progress * 0.9;
        }
    } else if (runtime._materials.gate) {
        runtime._materials.gate.emissiveIntensity = 0.9;
    }
}

/**
 * Setzt die Palette auf eine neue Stufe und quittiert den Wechsel mit Puls und
 * Alarmklang.
 *
 * @param {any} runtime
 * @param {number} tier
 */
export function switchEndlessStage(runtime, tier) {
    if (!runtime) return;
    if (runtime._activePaletteTier === tier) return;
    runtime._activePaletteTier = tier;
    applyEndlessStagePalette(runtime._materials, tier);
    startEndlessStagePulse(runtime);
    runtime.audio?.play?.('PARCOURS_TIMEOUT');
}
