export function updateTraversalStatus(element, player) {
    if (!element) return;
    const traversal = player?.traversal;
    const portalCooldown = Math.max(0, Number(traversal?.portalCooldownRemaining) || 0);
    const gateCooldown = Math.max(0, Number(traversal?.gateCooldownRemaining) || 0);
    const activeExitCount = Math.max(0, Number(traversal?.exitPortal?.activeCount) || 0);
    const inactiveExitCount = Math.max(0, Number(traversal?.exitPortal?.inactiveCount) || 0);
    let text = '';
    if (portalCooldown > 0) text = `PORTAL ${portalCooldown.toFixed(1)}s`;
    else if (gateCooldown > 0) text = `GATE ${gateCooldown.toFixed(1)}s`;
    else if (activeExitCount > 0) text = 'EXIT BEREIT';
    else if (inactiveExitCount > 0) text = 'EXIT GESPERRT';
    if (element.textContent !== text) element.textContent = text;
    element.classList.toggle('hidden', text.length === 0);
}
