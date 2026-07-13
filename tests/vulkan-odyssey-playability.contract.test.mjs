import assert from 'node:assert/strict';
import test from 'node:test';

import { VULKAN_ODYSSEY_MAP } from '../src/core/config/maps/presets/vulkan_odyssey.js';

function distance3(a, b) {
    return Math.hypot(
        Number(a?.[0] || 0) - Number(b?.[0] || 0),
        Number(a?.[1] || 0) - Number(b?.[1] || 0),
        Number(a?.[2] || 0) - Number(b?.[2] || 0)
    );
}

function edgeGap2d(left, right) {
    const dx = Math.max(0, Math.abs(left.pos[0] - right.pos[0]) - ((left.size[0] + right.size[0]) / 2));
    const dz = Math.max(0, Math.abs(left.pos[2] - right.pos[2]) - ((left.size[2] + right.size[2]) / 2));
    return Math.hypot(dx, dz);
}

test('Vulkan Odyssey precision hop keeps playable landing footprints', () => {
    const map = VULKAN_ODYSSEY_MAP.vulkan_odyssey;
    const precisionPlatforms = map.obstacles.filter((entry) => {
        const [x, y] = entry?.pos || [];
        return Number(x) >= 80 && Number(x) <= 96 && Number(y) >= 60 && Number(y) <= 64;
    });

    assert.equal(precisionPlatforms.length, 3);
    for (const platform of precisionPlatforms) {
        assert.ok(platform.size[0] >= 6, `precision platform x footprint too small at ${platform.pos}`);
        assert.ok(platform.size[2] >= 6, `precision platform z footprint too small at ${platform.pos}`);
    }

    const phase3LandingSequence = [
        map.obstacles.find((entry) => distance3(entry?.pos, [72, 58, 0]) < 0.1),
        ...precisionPlatforms,
        map.obstacles.find((entry) => distance3(entry?.pos, [104, 65, 0]) < 0.1),
    ];

    assert.equal(phase3LandingSequence.filter(Boolean).length, 5);
    for (let index = 1; index < phase3LandingSequence.length; index += 1) {
        const gap = edgeGap2d(phase3LandingSequence[index - 1], phase3LandingSequence[index]);
        assert.ok(gap <= 8, `precision hop edge gap too wide: ${gap.toFixed(2)}`);
    }
});
