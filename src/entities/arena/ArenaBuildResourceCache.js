import * as THREE from 'three';
import { isModernGraphicsStyle } from '../../shared/contracts/GraphicsStyleContract.js';

const CHECKER_TEXTURE_CACHE = new Map();
const CHECKPOINT_LABEL_TEXTURE_CACHE = new Map();
const MATERIAL_BUNDLE_CACHE = new Map();

function canCreateCanvasElement() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function createCanvasSurface(size) {
    if (!canCreateCanvasElement()) {
        return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
}

function hexColorToRgba(color) {
    const safeColor = Number(color) >>> 0;
    return [
        (safeColor >> 16) & 0xff,
        (safeColor >> 8) & 0xff,
        safeColor & 0xff,
        0xff,
    ];
}

function createEmptyTexture() {
    const texture = new THREE.Texture();
    texture.needsUpdate = true;
    return texture;
}

function createHeadlessCheckerTexture(lightColor, darkColor) {
    const light = hexColorToRgba(lightColor);
    const dark = hexColorToRgba(darkColor);
    const texture = new THREE.DataTexture(new Uint8Array([
        ...light, ...dark,
        ...dark, ...light,
    ]), 2, 2, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

function createCheckerTexture(lightColor, darkColor, graphicsStyle) {
    const size = 128;
    const half = size / 2;
    const canvas = createCanvasSurface(size);
    if (!canvas) {
        return createHeadlessCheckerTexture(lightColor, darkColor);
    }

    const ctx = canvas.getContext('2d');
    const light = `#${lightColor.toString(16).padStart(6, '0')}`;
    const dark = `#${darkColor.toString(16).padStart(6, '0')}`;

    if (isModernGraphicsStyle(graphicsStyle)) {
        ctx.fillStyle = dark;
        ctx.fillRect(0, 0, size, size);

        for (let row = 0; row < 2; row++) {
            for (let column = 0; column < 2; column++) {
                ctx.globalAlpha = (row + column) % 2 === 0 ? 0.34 : 0.18;
                ctx.fillStyle = light;
                ctx.fillRect(column * half + 3, row * half + 3, half - 6, half - 6);
            }
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(93, 176, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, size - 4, size - 4);
        ctx.beginPath();
        ctx.moveTo(half, 0);
        ctx.lineTo(half, size);
        ctx.moveTo(0, half);
        ctx.lineTo(size, half);
        ctx.stroke();
        ctx.fillStyle = 'rgba(76, 211, 255, 0.18)';
        ctx.fillRect(half - 1, 0, 2, size);
    } else {
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, half, half);
        ctx.fillRect(half, half, half, half);
        ctx.fillStyle = dark;
        ctx.fillRect(half, 0, half, half);
        ctx.fillRect(0, half, half, half);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

function getBaseCheckerTexture(lightColor, darkColor, graphicsStyle) {
    const key = `${graphicsStyle}|${lightColor}|${darkColor}`;
    if (!CHECKER_TEXTURE_CACHE.has(key)) {
        CHECKER_TEXTURE_CACHE.set(key, createCheckerTexture(lightColor, darkColor, graphicsStyle));
    }
    return CHECKER_TEXTURE_CACHE.get(key);
}

function createCheckpointLabelTexture(label) {
    const size = 128;
    const canvas = createCanvasSurface(size);
    if (!canvas) {
        return createEmptyTexture();
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return createEmptyTexture();
    }

    ctx.clearRect(0, 0, size, size);
    ctx.font = 'bold 90px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeText(label, size / 2, size / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, size / 2, size / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

export function getCheckpointLabelTexture(label) {
    const key = String(label);
    if (!CHECKPOINT_LABEL_TEXTURE_CACHE.has(key)) {
        CHECKPOINT_LABEL_TEXTURE_CACHE.set(key, createCheckpointLabelTexture(key));
    }
    return CHECKPOINT_LABEL_TEXTURE_CACHE.get(key);
}

function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function stableSerialize(value) {
    try {
        return JSON.stringify(value) || '';
    } catch {
        return '';
    }
}

function hashString(input = '') {
    let hash = 2166136261;
    const text = String(input || '');
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createArenaMapFingerprint(map) {
    return hashString(stableSerialize(map && typeof map === 'object' ? map : null));
}

export function createArenaBuildSignature({
    mapKey,
    mapFingerprint = '',
    scale,
    sx,
    sy,
    sz,
    portalsEnabled = true,
    planarMode = false,
    portalCount = 0,
    planarLevelCount = 0,
    graphicsStyle = 'modern',
}) {
    return [
        String(mapKey || 'standard'),
        String(mapFingerprint || ''),
        round2(scale),
        round2(sx),
        round2(sy),
        round2(sz),
        portalsEnabled ? 1 : 0,
        planarMode ? 1 : 0,
        Math.max(0, Math.round(Number(portalCount) || 0)),
        Math.max(0, Math.round(Number(planarLevelCount) || 0)),
        String(graphicsStyle || 'modern'),
    ].join('|');
}

export function getArenaMaterialBundle({
    checkerLightColor,
    checkerDarkColor,
    checkerWorldSize,
    sx,
    sy,
    sz,
    graphicsStyle = 'modern',
}) {
    const modern = isModernGraphicsStyle(graphicsStyle);
    const resolvedLightColor = modern ? 0x243b58 : checkerLightColor;
    const resolvedDarkColor = modern ? 0x0d1626 : checkerDarkColor;
    const bundleKey = [
        graphicsStyle,
        resolvedLightColor,
        resolvedDarkColor,
        round2(checkerWorldSize),
        round2(sx),
        round2(sy),
        round2(sz),
    ].join('|');

    if (MATERIAL_BUNDLE_CACHE.has(bundleKey)) {
        return MATERIAL_BUNDLE_CACHE.get(bundleKey);
    }

    const baseChecker = getBaseCheckerTexture(resolvedLightColor, resolvedDarkColor, graphicsStyle);
    const floorTexture = baseChecker.clone();
    floorTexture.needsUpdate = true;
    floorTexture.repeat.set(
        Math.max(1, sx / checkerWorldSize),
        Math.max(1, sz / checkerWorldSize)
    );

    const wallTexture = baseChecker.clone();
    wallTexture.needsUpdate = true;
    wallTexture.repeat.set(
        Math.max(1, sx / checkerWorldSize),
        Math.max(1, sy / checkerWorldSize)
    );

    const bundle = {
        floorTexture,
        wallTexture,
        wallMat: new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: wallTexture,
            transparent: true,
            opacity: modern ? 0.84 : 0.9,
            roughness: modern ? 0.68 : 0.75,
            metalness: modern ? 0.2 : 0.1,
            emissive: modern ? 0x061221 : 0x000000,
            emissiveIntensity: modern ? 0.32 : 1,
            side: THREE.DoubleSide,
        }),
        floorMat: new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: floorTexture,
            roughness: modern ? 0.76 : 0.9,
            metalness: modern ? 0.18 : 0.05,
            emissive: modern ? 0x040a12 : 0x000000,
            emissiveIntensity: modern ? 0.18 : 1,
        }),
        obstacleMat: new THREE.MeshStandardMaterial({
            color: modern ? 0x1f3552 : 0x2a2a4a,
            roughness: modern ? 0.42 : 0.4,
            metalness: modern ? 0.58 : 0.5,
            transparent: true,
            opacity: modern ? 0.74 : 0.6,
            emissive: modern ? 0x07182b : 0x000000,
            emissiveIntensity: modern ? 0.44 : 1,
        }),
        foamMat: new THREE.MeshStandardMaterial({
            color: modern ? 0x3a7c68 : 0x2b5a49,
            roughness: 0.55,
            metalness: 0.15,
            transparent: true,
            opacity: modern ? 0.64 : 0.42,
            emissive: modern ? 0x0f6b53 : 0x000000,
            emissiveIntensity: modern ? 0.9 : 1,
        }),
        obstacleEdgeMat: new THREE.LineBasicMaterial({ color: 0x4466aa, transparent: true, opacity: 0.5 }),
        foamEdgeMat: new THREE.LineBasicMaterial({
            color: modern ? 0x59f0b5 : 0x3ddc97,
            transparent: true,
            opacity: modern ? 0.68 : 0.42,
        }),
    };

    MATERIAL_BUNDLE_CACHE.set(bundleKey, bundle);
    return bundle;
}
