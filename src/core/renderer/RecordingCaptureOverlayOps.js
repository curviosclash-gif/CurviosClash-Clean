function drawHudSegment({
    ctx,
    segment,
    player,
    labelText = '',
    tmpColor,
    boostDuration = 1,
}) {
    if (!ctx || !segment || !player || !tmpColor) return;
    const x = Math.floor(segment.x);
    const y = Math.floor(segment.y);
    const width = Math.floor(segment.width);
    const height = Math.floor(segment.height);
    const padding = Math.max(8, Math.floor(height * 0.035));
    const panelWidth = Math.min(Math.floor(width * 0.42), 270);
    const panelHeight = Math.min(Math.floor(height * 0.34), 170);

    ctx.save();
    ctx.fillStyle = 'rgba(5, 9, 18, 0.58)';
    ctx.fillRect(x + padding, y + padding, panelWidth, panelHeight);
    ctx.strokeStyle = 'rgba(111, 208, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + padding, y + padding, panelWidth, panelHeight);

    const titleColor = tmpColor.setHex(Number(player?.color) || 0xffffff).getStyle();
    ctx.fillStyle = titleColor;
    ctx.font = `${Math.max(14, Math.floor(height * 0.054))}px "Segoe UI", sans-serif`;
    ctx.fillText(
        labelText || `P${(Number(player?.playerIndex ?? player?.index) || 0) + 1}`,
        x + padding + 10,
        y + padding + Math.max(20, Math.floor(height * 0.09))
    );

    ctx.fillStyle = '#e8f5ff';
    ctx.font = `${Math.max(12, Math.floor(height * 0.04))}px "Segoe UI", sans-serif`;
    const speedValue = Math.max(0, Math.round(Number(player?.speed) || 0));
    const scoreValue = Math.max(0, Math.round(Number(player?.score) || 0));
    ctx.fillText(`SPD ${speedValue}`, x + padding + 10, y + padding + 56);
    ctx.fillText(`SCORE ${scoreValue}`, x + padding + 10, y + padding + 80);

    const hpCurrent = Math.max(0, Number(player?.hp) || 0);
    const hpMax = Math.max(0.01, Number(player?.maxHp) || 1);
    const hpRatio = Math.max(0, Math.min(1, hpCurrent / hpMax));
    const boostCurrent = Math.max(0, Number(player?.boostCharge) || Number(player?.boostTimer) || 0);
    const boostMax = Math.max(0.01, Number(player?.boostCapacity) || Number(boostDuration) || 1);
    const boostRatio = Math.max(0, Math.min(1, boostCurrent / boostMax));

    const barWidth = panelWidth - 20;
    const hpBarY = y + padding + panelHeight - 52;
    const boostBarY = y + padding + panelHeight - 24;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(x + padding + 10, hpBarY, barWidth, 12);
    ctx.fillRect(x + padding + 10, boostBarY, barWidth, 12);
    ctx.fillStyle = '#5ef58c';
    ctx.fillRect(x + padding + 10, hpBarY, Math.floor(barWidth * hpRatio), 12);
    ctx.fillStyle = '#6ec6ff';
    ctx.fillRect(x + padding + 10, boostBarY, Math.floor(barWidth * boostRatio), 12);
    ctx.fillStyle = '#e8f5ff';
    ctx.font = `${Math.max(10, Math.floor(height * 0.032))}px "Segoe UI", sans-serif`;
    ctx.fillText('HP', x + padding + 10, hpBarY - 4);
    ctx.fillText('BOOST', x + padding + 10, boostBarY - 4);
    ctx.restore();
}

export function drawHudOverlay({
    ctx,
    width,
    height,
    segments,
    tmpColor,
    boostDuration = 1,
}) {
    if (!ctx || !Array.isArray(segments) || segments.length === 0) return;
    for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        drawHudSegment({
            ctx,
            segment,
            player: segment?.player,
            labelText: segment?.label,
            tmpColor,
            boostDuration,
        });
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, Math.max(0, width - 2), Math.max(0, height - 2));
    ctx.restore();
}

export function drawLetterboxOverlay({ ctx, segments, resolveLetterboxProgress }) {
    if (!ctx || !Array.isArray(segments) || typeof resolveLetterboxProgress !== 'function') return;
    for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        if (!segment) continue;
        const progress = resolveLetterboxProgress(segment.slotIndex ?? i);
        if (progress <= 0.001) continue;

        const barHeight = Math.floor(segment.height * 0.07 * progress);
        if (barHeight <= 0) continue;
        const sx = Math.floor(segment.x);
        const sy = Math.floor(segment.y);
        const sw = Math.floor(segment.width);
        const sh = Math.floor(segment.height);

        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${(0.85 * progress).toFixed(3)})`;
        ctx.fillRect(sx, sy, sw, barHeight);
        ctx.fillRect(sx, sy + sh - barHeight, sw, barHeight);
        ctx.restore();
    }
}

export function storeCaptureMeta(baseMeta, segments) {
    return {
        ...baseMeta,
        segments: (segments || []).map((segment) => ({
            label: segment.label,
            playerIndex: Number(segment?.player?.playerIndex ?? segment?.player?.index ?? segment?.playerIndex ?? -1),
            x: Math.floor(segment.x),
            y: Math.floor(segment.y),
            width: Math.floor(segment.width),
            height: Math.floor(segment.height),
        })),
    };
}
