function lerpNumber(from, to, amount) {
    return from + (to - from) * amount;
}

function lerpHexColor(from, to, amount) {
    const source = Number(from) >>> 0;
    const target = Number(to) >>> 0;
    const channel = (shift) => Math.round(
        ((source >> shift) & 0xff) + (((target >> shift) & 0xff) - ((source >> shift) & 0xff)) * amount
    );
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function resolveSandstormLighting(normal, intensity) {
    const blend = Math.max(0, Math.min(1, Number(intensity) || 0));
    return {
        ...normal,
        key: { ...normal.key, color: lerpHexColor(normal.key.color, 0xe19a52, blend), intensity: lerpNumber(normal.key.intensity, normal.key.intensity * 0.72, blend) },
        fill: { ...normal.fill, color: lerpHexColor(normal.fill.color, 0x71331f, blend), intensity: lerpNumber(normal.fill.intensity, normal.fill.intensity * 0.65, blend) },
        rim: { ...normal.rim, color: lerpHexColor(normal.rim.color, 0xb94f25, blend), intensity: lerpNumber(normal.rim.intensity, normal.rim.intensity * 0.75, blend) },
        hemisphere: { skyColor: lerpHexColor(normal.hemisphere.skyColor, 0x8c4a2b, blend), groundColor: lerpHexColor(normal.hemisphere.groundColor, 0x2c160e, blend) },
        fog: { ...normal.fog, color: lerpHexColor(normal.fog.color, 0xb56d32, blend), colorHigh: lerpHexColor(normal.fog.colorHigh, 0x562517, blend), colorLow: lerpHexColor(normal.fog.colorLow, 0x2a110c, blend) },
        skyDome: { zenithColor: lerpHexColor(normal.skyDome.zenithColor, 0x5d2d1e, blend), horizonColor: lerpHexColor(normal.skyDome.horizonColor, 0xb56d32, blend), nadirColor: lerpHexColor(normal.skyDome.nadirColor, 0x2a110c, blend) },
    };
}
