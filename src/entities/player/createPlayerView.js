import { BotView } from '../bot/BotView.js';
import { PlayerView } from './PlayerView.js';

export function createPlayerView(player, renderer) {
    if (player?.isBot) {
        return new BotView(player, renderer);
    }
    return new PlayerView(player, renderer);
}
