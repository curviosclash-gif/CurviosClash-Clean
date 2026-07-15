export const VEHICLE_LAB_CONFIG_LIMITS = Object.freeze({
    maxParts: 128,
    maxDepth: 8,
    maxLabelLength: 80,
    maxPartNameLength: 80,
    maxAbsPosition: 100,
    maxAbsRotation: 36000,
    maxSize: 50,
    maxScale: 20,
});

export const VEHICLE_LAB_GEOMETRIES = Object.freeze([
    'box',
    'sphere',
    'cylinder',
    'cone',
    'torus',
    'capsule',
    'pylon',
    'engine',
    'forcefield',
    'flame',
]);

const VEHICLE_LAB_MATERIALS = new Set(['primary', 'secondary', 'glass', 'glow']);
const VEHICLE_LAB_ANIMATIONS = new Set(['rotate', 'bob', 'pulse']);
const VEHICLE_LAB_AXES = new Set(['x', 'y', 'z']);

function finiteNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function normalizeVector(source, fallback, min, max) {
    const input = Array.isArray(source) ? source : fallback;
    return fallback.map((defaultValue, index) => finiteNumber(input[index], defaultValue, min, max));
}

function normalizeColor(value, fallback = 0x60a5fa) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return Number.parseInt(value.slice(1), 16);
    const numeric = Number(value);
    return Number.isFinite(numeric)
        ? Math.max(0, Math.min(0xffffff, Math.trunc(numeric)))
        : fallback;
}

function normalizeAnimation(source) {
    if (!source || typeof source !== 'object' || !VEHICLE_LAB_ANIMATIONS.has(source.type)) return null;
    const animation = {
        type: source.type,
        speed: finiteNumber(source.speed, 1, -20, 20),
        amount: finiteNumber(source.amount, 1, 0, 20),
    };
    if (source.type === 'rotate') {
        animation.axis = VEHICLE_LAB_AXES.has(source.axis) ? source.axis : 'y';
    }
    return animation;
}

export function normalizeVehicleLabConfig(raw, options = {}) {
    const errors = [];
    const warnings = [];
    const limits = VEHICLE_LAB_CONFIG_LIMITS;
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;

    if (!source) {
        return { ok: false, config: null, errors: ['Fahrzeug-Konfiguration muss ein Objekt sein.'], warnings };
    }

    const inputParts = Array.isArray(source.parts) ? source.parts : [];
    if (!Array.isArray(source.parts)) errors.push('"parts" muss ein Array sein.');
    if (options.requireParts !== false && inputParts.length === 0) errors.push('Das Fahrzeug benötigt mindestens ein Bauteil.');

    let partCount = 0;
    const normalizePart = (part, depth, path) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
            warnings.push(`Ungültiges Bauteil ${path} wurde übersprungen.`);
            return null;
        }
        if (depth > limits.maxDepth) {
            warnings.push(`Verschachtelung bei ${path} wurde auf ${limits.maxDepth} Ebenen begrenzt.`);
            return null;
        }
        if (partCount >= limits.maxParts) {
            warnings.push(`Bauteillimit von ${limits.maxParts} erreicht.`);
            return null;
        }
        partCount += 1;

        const geo = VEHICLE_LAB_GEOMETRIES.includes(String(part.geo || '').toLowerCase())
            ? String(part.geo).toLowerCase()
            : 'box';
        const normalized = {
            ...part,
            name: String(part.name || `Part ${partCount}`).trim().slice(0, limits.maxPartNameLength) || `Part ${partCount}`,
            geo,
            size: normalizeVector(part.size, [1, 1, 1], 0.01, limits.maxSize),
            pos: normalizeVector(part.pos, [0, 0, 0], -limits.maxAbsPosition, limits.maxAbsPosition),
            rot: normalizeVector(part.rot, [0, 0, 0], -limits.maxAbsRotation, limits.maxAbsRotation),
            scale: normalizeVector(part.scale, [1, 1, 1], 0.01, limits.maxScale),
            material: VEHICLE_LAB_MATERIALS.has(part.material) ? part.material : 'primary',
        };

        if (part.color !== undefined) normalized.color = normalizeColor(part.color, '#ffffff');
        if (part.opacity !== undefined) normalized.opacity = finiteNumber(part.opacity, 1, 0, 1);
        if (part.emissive !== undefined) normalized.emissive = normalizeColor(part.emissive, 0x000000);
        normalized.emissiveIntensity = finiteNumber(part.emissiveIntensity, 0, 0, 20);

        const mirrorAxis = VEHICLE_LAB_AXES.has(part.mirrorAxis)
            ? part.mirrorAxis
            : (part.mirror === true ? 'x' : null);
        if (mirrorAxis) normalized.mirrorAxis = mirrorAxis;
        else {
            delete normalized.mirrorAxis;
            delete normalized.mirror;
        }

        const animation = normalizeAnimation(part.anim);
        if (animation) normalized.anim = animation;
        else delete normalized.anim;

        const children = Array.isArray(part.children) ? part.children : [];
        normalized.children = children
            .map((child, index) => normalizePart(child, depth + 1, `${path}.${index}`))
            .filter(Boolean);
        if (normalized.children.length === 0) delete normalized.children;
        return normalized;
    };

    const parts = inputParts
        .map((part, index) => normalizePart(part, 0, String(index)))
        .filter(Boolean);
    if (options.requireParts !== false && parts.length === 0 && errors.length === 0) {
        errors.push('Das Fahrzeug enthält keine verwendbaren Bauteile.');
    }

    const config = {
        ...source,
        label: String(source.label || options.fallbackLabel || 'Custom Vehicle')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, limits.maxLabelLength) || 'Custom Vehicle',
        primaryColor: normalizeColor(source.primaryColor),
        parts,
    };

    return { ok: errors.length === 0, config, errors, warnings };
}

export function formatVehicleLabConfigIssues(result) {
    return [...(result?.errors || []), ...(result?.warnings || [])].join('\n');
}
