// ============================================
// BotActionOps.js - action/input mapping operations for BotAI
// ============================================

export function applyDecisionToInput(bot) {
    const input = bot.currentInput;
    bot._resetInput(input);

    if (bot._decision.yaw > 0) input.yawLeft = true;
    else if (bot._decision.yaw < 0) input.yawRight = true;

    if (bot._decision.pitch > 0) input.pitchUp = true;
    else if (bot._decision.pitch < 0) input.pitchDown = true;

    input.boost = bot._decision.boost;
    input.useItem = bot._decision.useItem;
    input.shootItem = bot._decision.shootItem;
    input.shootItemIndex = bot._decision.shootItemIndex;

    return input;
}

export function runAction(bot) {
    return applyDecisionToInput(bot);
}
