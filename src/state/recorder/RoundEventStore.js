export class RoundEventStore {
    constructor({ maxEvents = 800, timeProvider = null } = {}) {
        this.maxEvents = Math.max(1, Number(maxEvents) || 800);
        this.timeProvider = typeof timeProvider === 'function' ? timeProvider : (() => 0);
        this.events = new Array(this.maxEvents);
        for (let i = 0; i < this.maxEvents; i++) {
            this.events[i] = { time: 0, type: '', player: -1, data: '' };
        }
        this.eventIndex = 0;
        this.eventCount = 0;
    }

    reset() {
        this.eventIndex = 0;
        this.eventCount = 0;
    }

    append(type, playerIndex, data = '') {
        const entry = this.events[this.eventIndex];
        entry.time = this.timeProvider();
        entry.type = type;
        entry.player = playerIndex;
        entry.data = data;

        this.eventIndex = (this.eventIndex + 1) % this.maxEvents;
        if (this.eventCount < this.maxEvents) this.eventCount++;
        return entry;
    }

    toLogLines() {
        const eventList = [];
        const startIdx = this.eventCount >= this.maxEvents ? this.eventIndex : 0;
        for (let i = 0; i < this.eventCount; i++) {
            const idx = (startIdx + i) % this.maxEvents;
            const e = this.events[idx];
            eventList.push(`[${e.time.toFixed(2)}s] ${e.type} P${e.player} ${e.data}`);
        }
        return eventList;
    }
}
