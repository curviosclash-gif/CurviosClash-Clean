import * as THREE from 'three';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import {
    PORTAL_PAIR_MARK_COUNT,
    createPortalArrowGeometry,
    createPortalChevronGeometry,
    createPortalCrownGeometry,
    createPortalFrameGeometry,
    createPortalPairMarkGeometry,
    normalizePortalVisualType,
    samplePortalInnerEdge,
} from './portal/PortalVisualGeometry.js';
import {
    createInstancedVisualHandle,
    createPortalGateVisualRegistry,
} from './portal/PortalVisualRegistry.js';

export { createPortalGateVisualRegistry };

const PORTAL_GEOMETRY_CACHE = new Map();
const PORTAL_MATERIAL_CACHE = new Map();

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const PORTAL_BODY_COLOR = 0x111820;
const PORTAL_INACTIVE_COLOR = 0x18352f;
const PORTAL_DIRECTION_COLOR = 0xf4fbff;
const PORTAL_FLOW_SEGMENTS = 12;

function markSharedResource(resource) {
    if (!resource?.userData) resource.userData = {};
    resource.userData.__sharedNoDispose = true;
    return resource;
}

function toColorHex(value, fallback = 0xffffff) {
    const num = Number(value);
    return Number.isFinite(num) ? num >>> 0 : fallback;
}

function toColorKey(value, fallback = 0xffffff) {
    return toColorHex(value, fallback).toString(16).padStart(6, '0');
}

function clamp01(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
}

function mixColorHex(fromHex, toHex, amount) {
    const alpha = clamp01(amount);
    const from = toColorHex(fromHex, 0xffffff);
    const to = toColorHex(toHex, 0xffffff);
    const fromR = (from >> 16) & 0xff;
    const fromG = (from >> 8) & 0xff;
    const fromB = from & 0xff;
    const toR = (to >> 16) & 0xff;
    const toG = (to >> 8) & 0xff;
    const toB = to & 0xff;
    const r = Math.round(fromR + (toR - fromR) * alpha);
    const g = Math.round(fromG + (toG - fromG) * alpha);
    const b = Math.round(fromB + (toB - fromB) * alpha);
    return (r << 16) | (g << 8) | b;
}

function scaleColorHex(colorHex, scale) {
    const color = toColorHex(colorHex, 0xffffff);
    const safeScale = Math.max(0, Number(scale) || 0);
    const r = Math.min(255, Math.round(((color >> 16) & 0xff) * safeScale));
    const g = Math.min(255, Math.round(((color >> 8) & 0xff) * safeScale));
    const b = Math.min(255, Math.round((color & 0xff) * safeScale));
    return (r << 16) | (g << 8) | b;
}

function getSharedGeometry(key, createGeometry) {
    if (PORTAL_GEOMETRY_CACHE.has(key)) return PORTAL_GEOMETRY_CACHE.get(key);
    const geometry = markSharedResource(createGeometry());
    PORTAL_GEOMETRY_CACHE.set(key, geometry);
    return geometry;
}

function getSharedMaterial(key, createMaterial) {
    if (PORTAL_MATERIAL_CACHE.has(key)) return PORTAL_MATERIAL_CACHE.get(key);
    const material = markSharedResource(createMaterial());
    PORTAL_MATERIAL_CACHE.set(key, material);
    return material;
}

function createColoredBasicMaterial(key, options = {}) {
    return getSharedMaterial(key, () => new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: false,
        toneMapped: false,
        ...options,
    }));
}

function portalDarkBodyMaterial() {
    return getSharedMaterial('portal:frame-body-material', () => new THREE.MeshStandardMaterial({
        color: PORTAL_BODY_COLOR,
        emissive: 0x040a10,
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.88,
        side: THREE.DoubleSide,
    }));
}

function portalGlowMaterial(key, opacity = 0.9) {
    return createColoredBasicMaterial(key, {
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
        side: THREE.DoubleSide,
    });
}

function installPortalFlow(handle, visualType, innerRadius, ringSizeKey, compactMode, displayColor) {
    const flowPoints = samplePortalInnerEdge(visualType, innerRadius, compactMode ? 8 : PORTAL_FLOW_SEGMENTS);
    const flowGeometry = getSharedGeometry(
        `portal:energy-streak-geometry:${compactMode ? 'compact' : 'full'}`,
        () => new THREE.BoxGeometry(compactMode ? 0.07 : 0.09, compactMode ? 0.34 : 0.46, 0.055)
    );
    const flowMaterial = portalGlowMaterial(`portal:energy-flow-material:${compactMode ? 'compact' : 'full'}`, 0.78);
    const flowComponents = [];
    const flowBase = [];
    for (let i = 0; i < flowPoints.length; i++) {
        const point = flowPoints[i];
        const angle = Math.atan2(point.y, point.x);
        const component = handle.addComponent('energyFlow', {
            batchKey: `portal:energy-flow:${ringSizeKey}:${compactMode ? 'compact' : 'full'}`,
            geometry: flowGeometry,
            material: flowMaterial,
            colorHex: scaleColorHex(displayColor, 0.55),
            localPosition: new THREE.Vector3(point.x, point.y, i % 2 === 0 ? 0.2 : -0.2),
            localQuaternion: new THREE.Quaternion().setFromAxisAngle(AXIS_Z, angle - Math.PI / 2),
        });
        flowComponents.push(component);
        flowBase.push({ x: point.x, y: point.y, z: component.localPosition.z });
    }
    handle.userData.energyFlow = flowComponents;
    return { flowComponents, flowBase };
}

function installPortalVisualUpdater(handle, displayColor, rim, pairMark, crown, flow) {
    handle._portalVisualUpdater = (timeSeconds, pulseStrength, destinationImpulse, active) => {
        const pulse = active ? clamp01(pulseStrength) : 0;
        const destinationBoost = destinationImpulse ? pulse * 0.42 : pulse * 0.14;
        const activeColor = active ? displayColor : PORTAL_INACTIVE_COLOR;
        rim.setColor(mixColorHex(activeColor, 0xffffff, pulse * 0.55 + destinationBoost));
        if (crown) crown.setColor(mixColorHex(activeColor, 0xffffff, pulse * 0.72));
        if (pairMark) pairMark.setColor(displayColor);

        const count = flow.flowComponents.length;
        for (let i = 0; i < count; i++) {
            const phase = ((timeSeconds * 0.72 + i / count) % 1 + 1) % 1;
            const pulseHead = (1 - pulse) * count;
            const pulseDistance = Math.abs(i - pulseHead);
            const wrappedPulseDistance = Math.min(pulseDistance, count - pulseDistance);
            const traversalWave = pulse * Math.max(0, 1 - wrappedPulseDistance * 0.52);
            const contraction = 1
                - phase * 0.105
                - traversalWave * (destinationImpulse ? 0.11 : 0.065);
            const base = flow.flowBase[i];
            const component = flow.flowComponents[i];
            component.setLocalPosition(base.x * contraction, base.y * contraction, base.z);
            component.setLocalScale(1, 1 - phase * 0.48 + destinationBoost * 0.4 + traversalWave * 0.3, 1);
            const brightness = active ? 0.28 + (1 - phase) * 0.72 : 0.12 + (1 - phase) * 0.15;
            component.setColor(mixColorHex(
                scaleColorHex(activeColor, brightness),
                0xffffff,
                pulse * (destinationImpulse ? 0.55 : 0.25) + traversalWave * 0.55
            ));
        }
    };
}

export function createBoostPortalMesh(position, rotation, color, visualRegistry) {
    const handle = createInstancedVisualHandle(visualRegistry, position);
    handle.setRotationFromEuler(rotation);
    const displayColor = toColorHex(color, 0xffb34d);
    const displayColorKey = toColorKey(displayColor);

    const body = handle.addComponent('frameBody', {
        batchKey: 'portal-gate:boost:frame-body',
        geometry: getSharedGeometry('boost:frameBody', () => createPortalFrameGeometry('portal_ring', 3.48, 0.48, 0.58)),
        material: portalDarkBodyMaterial(),
        colorHex: 0xffffff,
    });
    const outerRing = handle.addComponent('outerRing', {
        batchKey: 'portal-gate:boost:inset-rim',
        geometry: getSharedGeometry('boost:insetRim', () => createPortalFrameGeometry('portal_ring', 3.22, 0.14, 0.64)),
        material: portalGlowMaterial('portal-gate:boost:rim-material'),
        colorHex: displayColor,
    });

    const chevrons = [];
    const chevronGeometry = getSharedGeometry('boost:chevron-geometry', () => createPortalChevronGeometry(0.78, 0.12));
    const chevronMaterial = portalGlowMaterial('boost:chevron-material', 0.82);
    const forwardChevronQuaternion = new THREE.Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2);
    for (let i = 0; i < 3; i++) {
        chevrons.push(handle.addComponent('spines', {
            batchKey: 'portal-gate:boost:forward-chevrons',
            geometry: chevronGeometry,
            material: chevronMaterial,
            colorHex: displayColor,
            localPosition: new THREE.Vector3(0, -2.25, -0.5 + i * 0.5),
            localQuaternion: forwardChevronQuaternion,
            localScale: new THREE.Vector3(0.72 + i * 0.12, 0.72 + i * 0.12, 1),
        }));
    }

    handle.userData.body = body;
    handle.userData.outerRing = outerRing;
    handle.userData.innerDisk = null;
    handle.userData.spines = chevrons;
    handle.userData.functionalType = 'boost';
    handle._gateVisualUpdater = (timeSeconds, pulseStrength) => {
        const pulse = clamp01(pulseStrength);
        outerRing.setColor(mixColorHex(displayColor, 0xffffff, pulse * 0.7));
        for (let i = 0; i < chevrons.length; i++) {
            const phase = ((timeSeconds * 0.85 + i / chevrons.length) % 1 + 1) % 1;
            chevrons[i].setLocalPosition(0, -2.25, -0.62 + phase * 1.24);
            chevrons[i].setColor(mixColorHex(
                scaleColorHex(displayColor, 0.42 + (1 - phase) * 0.58),
                0xffffff,
                pulse * 0.65
            ));
        }
    };
    handle.userData.displayColor = displayColor;
    handle.userData.displayColorKey = displayColorKey;
    return handle;
}

export function createSlingshotGateMesh(position, rotation, color, visualRegistry) {
    const handle = createInstancedVisualHandle(visualRegistry, position);
    handle.setRotationFromEuler(rotation);
    const displayColor = toColorHex(color, 0x7dfbff);

    const frontBody = handle.addComponent('frameBody', {
        batchKey: 'portal-gate:slingshot:front-body',
        geometry: getSharedGeometry('slingshot:frontBody', () => createPortalFrameGeometry('portal_ring', 3.08, 0.34, 0.36)),
        material: portalDarkBodyMaterial(),
        colorHex: 0xffffff,
        localPosition: new THREE.Vector3(0, 0, 0.62),
    });
    const backBody = handle.addComponent('frameBody', {
        batchKey: 'portal-gate:slingshot:back-body',
        geometry: getSharedGeometry('slingshot:backBody', () => createPortalFrameGeometry('portal_ring', 2.45, 0.3, 0.32)),
        material: portalDarkBodyMaterial(),
        colorHex: 0xffffff,
        localPosition: new THREE.Vector3(0, 0, -0.62),
    });
    const frontRing = handle.addComponent('frontRing', {
        batchKey: 'portal-gate:slingshot:front-rim',
        geometry: getSharedGeometry('slingshot:frontRim', () => createPortalFrameGeometry('portal_ring', 2.84, 0.12, 0.16)),
        material: portalGlowMaterial('portal-gate:slingshot:rim-material'),
        colorHex: displayColor,
        localPosition: new THREE.Vector3(0, 0, 0.83),
    });
    const backRing = handle.addComponent('backRing', {
        batchKey: 'portal-gate:slingshot:back-rim',
        geometry: getSharedGeometry('slingshot:backRim', () => createPortalFrameGeometry('portal_ring', 2.23, 0.1, 0.14)),
        material: portalGlowMaterial('portal-gate:slingshot:rim-material'),
        colorHex: displayColor,
        localPosition: new THREE.Vector3(0, 0, -0.81),
    });
    const upCue = handle.addComponent('upCue', {
        batchKey: 'portal-gate:slingshot:up-cue',
        geometry: getSharedGeometry('portal:arrow-geometry:gate', () => createPortalArrowGeometry(0.68, 0.15)),
        material: portalGlowMaterial('portal:direction-cue-material'),
        colorHex: PORTAL_DIRECTION_COLOR,
        localPosition: new THREE.Vector3(0, 3.62, 0),
    });

    handle.userData.frameBody = [frontBody, backBody];
    handle.userData.frontRing = frontRing;
    handle.userData.backRing = backRing;
    handle.userData.axisBeam = null;
    handle.userData.upCue = upCue;
    handle.userData.functionalType = 'slingshot';
    handle._gateVisualUpdater = (timeSeconds, pulseStrength) => {
        const pulse = clamp01(pulseStrength);
        const wave = 0.18 + (Math.sin(timeSeconds * 4.5) + 1) * 0.12;
        frontRing.setColor(mixColorHex(displayColor, 0xffffff, pulse * 0.7 + wave));
        backRing.setColor(mixColorHex(scaleColorHex(displayColor, 0.7), 0xffffff, pulse * 0.55 + wave * 0.5));
        upCue.setColor(mixColorHex(PORTAL_DIRECTION_COLOR, displayColor, pulse * 0.45));
    };
    handle.userData.displayColor = displayColor;
    return handle;
}

export function createPortalMesh(position, color, direction, visualRegistry, options = {}) {
    const visualKind = options?.kind === 'exit' ? 'exit' : 'teleporter';
    const configuredRingSize = Math.max(0.01, Number(resolveGameplayConfig(options.configSource).PORTAL.RING_SIZE) || 4);
    // Preserve the former active exit aperture: (configured radius - old tube radius 0.3) * 1.4.
    const ringSize = visualKind === 'exit'
        ? Math.max(0.01, configuredRingSize * 1.4 - 0.12)
        : configuredRingSize;
    const compactMode = options?.compact === true;
    const visualType = normalizePortalVisualType(options?.visualType);
    const pairIndex = Math.max(0, Math.trunc(Number(options?.pairIndex) || 0));
    const pairMarkIndex = pairIndex % PORTAL_PAIR_MARK_COUNT;
    const ringSizeKey = ringSize.toFixed(3);
    const displayColor = toColorHex(color, 0x00ffcc);
    const handle = createInstancedVisualHandle(visualRegistry, position, options?.quaternion);

    const outerRadius = ringSize + (compactMode ? 0.26 : 0.34);
    const bodyBandWidth = compactMode ? 0.52 : 0.62;
    const body = handle.addComponent('frameBody', {
        batchKey: `portal:frame-body:${visualType}:${ringSizeKey}:${compactMode ? 'compact' : 'full'}`,
        geometry: getSharedGeometry(
            `portal:frame-body-geometry:${visualType}:${ringSizeKey}:${compactMode ? 'compact' : 'full'}`,
            () => createPortalFrameGeometry(visualType, outerRadius, bodyBandWidth, compactMode ? 0.32 : 0.46)
        ),
        material: portalDarkBodyMaterial(),
        colorHex: 0xffffff,
    });

    const rimOuterRadius = outerRadius - bodyBandWidth + (compactMode ? 0.16 : 0.2);
    const rimBandWidth = compactMode ? 0.12 : 0.16;
    const bodyDepth = compactMode ? 0.32 : 0.46;
    const rim = handle.addComponent('insetRim', {
        batchKey: `portal:inset-rim:${visualType}:${ringSizeKey}:${compactMode ? 'compact' : 'full'}`,
        geometry: getSharedGeometry(
            `portal:inset-rim-geometry:${visualType}:${ringSizeKey}:${compactMode ? 'compact' : 'full'}`,
            () => createPortalFrameGeometry(visualType, rimOuterRadius, rimBandWidth, bodyDepth + 0.08)
        ),
        material: portalGlowMaterial(`portal:inset-rim-material:${compactMode ? 'compact' : 'full'}`),
        colorHex: displayColor,
    });

    let pairMark = null;
    let crown = null;
    if (visualKind === 'exit') {
        crown = handle.addComponent('crown', {
            batchKey: 'portal:exit-crown',
            geometry: getSharedGeometry('portal:exit-crown-geometry', () => createPortalCrownGeometry(0.82, 0.22)),
            material: portalGlowMaterial('portal:exit-crown-material'),
            colorHex: displayColor,
            localPosition: new THREE.Vector3(0, outerRadius + 0.92, 0),
        });
    } else {
        pairMark = handle.addComponent('pairMark', {
            batchKey: `portal:pair-mark:${pairMarkIndex}:${compactMode ? 'compact' : 'full'}`,
            geometry: getSharedGeometry(
                `portal:pair-mark-geometry:${pairMarkIndex}:${compactMode ? 'compact' : 'full'}`,
                () => createPortalPairMarkGeometry(pairMarkIndex, compactMode ? 0.44 : 0.54, compactMode ? 0.14 : 0.2)
            ),
            material: portalGlowMaterial('portal:pair-mark-material'),
            colorHex: displayColor,
            localPosition: new THREE.Vector3(0, outerRadius + (compactMode ? 0.62 : 0.76), 0),
        });
    }

    let directionCue = null;
    if (direction !== 'NEUTRAL') {
        const arrowQuaternion = direction === 'DOWN'
            ? new THREE.Quaternion().setFromAxisAngle(AXIS_Z, Math.PI)
            : new THREE.Quaternion();
        directionCue = handle.addComponent('directionCue', {
            batchKey: `portal:direction-cue:${direction}`,
            geometry: getSharedGeometry('portal:direction-cue-geometry', () => createPortalArrowGeometry(0.62, 0.16)),
            material: portalGlowMaterial('portal:direction-cue-material'),
            colorHex: PORTAL_DIRECTION_COLOR,
            localPosition: new THREE.Vector3(outerRadius + (compactMode ? 0.58 : 0.72), 0, 0),
            localQuaternion: arrowQuaternion,
        });
    }

    const innerRadius = rimOuterRadius - rimBandWidth - (compactMode ? 0.04 : 0.06);
    const flow = installPortalFlow(handle, visualType, innerRadius, ringSizeKey, compactMode, displayColor);
    installPortalVisualUpdater(handle, displayColor, rim, pairMark, crown, flow);

    handle.userData.body = body;
    handle.userData.torus = body;
    handle.userData.disc = null;
    handle.userData.rim = rim;
    handle.userData.pairMark = pairMark;
    handle.userData.pairMarkIndex = pairMarkIndex;
    handle.userData.directionCue = directionCue;
    handle.userData.arrow = directionCue;
    handle.userData.direction = direction;
    handle.userData.compact = compactMode;
    handle.userData.visualType = visualType;
    handle.userData.visualKind = visualKind;
    handle.userData.displayColor = displayColor;
    handle.userData.innerOpeningRadius = innerRadius;
    handle.updatePortalVisualState(0, 0, false, options?.active !== false);
    return handle;
}
