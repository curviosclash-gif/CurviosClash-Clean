// @ts-check

export function updateEntityCameraContext(context, player, otherPlayerPosition) {
    const playerState = context.playerState;
    playerState.hp = Number(player?.hp) || 0;
    playerState.maxHp = Number(player?.maxHp) || 1;
    playerState.score = Number(player?.score) || 0;
    playerState.speed = Number(player?.speed) || 0;
    playerState.isBoosting = player?.isBoosting === true;
    context.otherPlayerPosition = otherPlayerPosition;
    return context;
}
