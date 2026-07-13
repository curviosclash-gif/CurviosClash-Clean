function drawSourceCover({
    ctx,
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    targetX,
    targetY,
    targetWidth,
    targetHeight,
}) {
    if (!ctx || !source) return false;

    const sx = Math.max(0, Math.floor(Number(sourceX) || 0));
    const sy = Math.max(0, Math.floor(Number(sourceY) || 0));
    const sw = Math.max(1, Math.floor(Number(sourceWidth) || 0));
    const sh = Math.max(1, Math.floor(Number(sourceHeight) || 0));
    const tx = Math.floor(Number(targetX) || 0);
    const ty = Math.floor(Number(targetY) || 0);
    const tw = Math.max(1, Math.floor(Number(targetWidth) || 0));
    const th = Math.max(1, Math.floor(Number(targetHeight) || 0));
    if (sw <= 1 || sh <= 1 || tw <= 1 || th <= 1) return false;

    const sourceAspect = sw / sh;
    const targetAspect = tw / th;
    let cropX = sx;
    let cropY = sy;
    let cropWidth = sw;
    let cropHeight = sh;

    if (sourceAspect > targetAspect) {
        cropWidth = Math.max(1, Math.floor(sh * targetAspect));
        cropX = sx + Math.floor((sw - cropWidth) * 0.5);
    } else if (sourceAspect < targetAspect) {
        cropHeight = Math.max(1, Math.floor(sw / targetAspect));
        cropY = sy + Math.floor((sh - cropHeight) * 0.5);
    }

    ctx.drawImage(source, cropX, cropY, cropWidth, cropHeight, tx, ty, tw, th);
    return true;
}

export function renderShortsFallbackFromSource({
    captureCtx,
    sourceCanvas,
    sizes,
    splitScreen = true,
}) {
    if (!captureCtx || !sourceCanvas || !sizes) return false;

    const sourceWidth = Math.max(2, Math.floor(Number(sourceCanvas?.width) || 0));
    const sourceHeight = Math.max(2, Math.floor(Number(sourceCanvas?.height) || 0));
    const targetWidth = Math.max(2, Math.floor(Number(sizes?.width) || 0));
    const targetHeight = Math.max(2, Math.floor(Number(sizes?.height) || 0));
    const halfHeight = Math.floor(targetHeight / 2);
    const leftWidth = Math.floor(sourceWidth * 0.5);
    const rightWidth = Math.max(1, sourceWidth - leftWidth);

    captureCtx.clearRect(0, 0, targetWidth, targetHeight);

    if (splitScreen && leftWidth > 1 && rightWidth > 1) {
        const topOk = drawSourceCover({
            ctx: captureCtx,
            source: sourceCanvas,
            sourceX: 0,
            sourceY: 0,
            sourceWidth: leftWidth,
            sourceHeight,
            targetX: 0,
            targetY: 0,
            targetWidth,
            targetHeight: halfHeight,
        });
        const bottomOk = drawSourceCover({
            ctx: captureCtx,
            source: sourceCanvas,
            sourceX: leftWidth,
            sourceY: 0,
            sourceWidth: rightWidth,
            sourceHeight,
            targetX: 0,
            targetY: halfHeight,
            targetWidth,
            targetHeight: targetHeight - halfHeight,
        });
        if (topOk || bottomOk) return true;
    }

    const topOk = drawSourceCover({
        ctx: captureCtx,
        source: sourceCanvas,
        sourceX: 0,
        sourceY: 0,
        sourceWidth,
        sourceHeight,
        targetX: 0,
        targetY: 0,
        targetWidth,
        targetHeight: halfHeight,
    });
    const bottomOk = drawSourceCover({
        ctx: captureCtx,
        source: sourceCanvas,
        sourceX: 0,
        sourceY: 0,
        sourceWidth,
        sourceHeight,
        targetX: 0,
        targetY: halfHeight,
        targetWidth,
        targetHeight: targetHeight - halfHeight,
    });
    return topOk || bottomOk;
}
