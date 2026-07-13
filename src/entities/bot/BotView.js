import { PlayerView } from '../player/PlayerView.js';

export class BotView extends PlayerView {
    constructor(player, renderer) {
        super(player, renderer);
        this.viewType = 'bot';
    }
}
