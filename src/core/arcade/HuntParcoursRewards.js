import { awardBoundArcadeVehicleXpInStore } from '../../state/arcade/ArcadeVehicleRewardBinding.js';
import { createRuntimeClock } from '../../shared/contracts/RuntimeClockContract.js';

/** Retains the original store, vehicle and run totals through map/session/profile changes. */
export class HuntParcoursRewards {
    constructor(clock = createRuntimeClock()) { this.clock = clock; this.pending = []; this.nextRetryMs = 0; }

    _save(reward) {
        try {
            const result = awardBoundArcadeVehicleXpInStore(reward.store, reward.binding, reward.amount);
            if (result?.persisted !== true) return null;
            reward.owner.xpEarned += result.earned;
            if (reward.primary) reward.owner.vehicleXpEarned += result.earned;
            return result;
        } catch { return null; }
    }

    _sync(owner) {
        if (!owner.summary) return;
        Object.assign(owner.summary, {
            xpEarned: owner.xpEarned, vehicleXpEarned: owner.vehicleXpEarned,
            pendingRewardCount: this.pending.filter(reward => reward.owner === owner).length,
        });
    }

    award(store, binding, amount, owner, primary) {
        if (!binding || amount <= 0) return null;
        const queued = this.pending.find(reward => reward.owner === owner && reward.store === store
            && reward.binding.vehicleId === binding.vehicleId && reward.primary === primary);
        if (queued) queued.amount += amount;
        else {
            const reward = { store, binding, amount, owner, primary };
            const result = this._save(reward);
            if (result) { this._sync(owner); return result; }
            this.pending.push(reward);
        }
        this._sync(owner);
        return { earned: 0, persisted: false, rewardPending: true };
    }

    maintain(nowMs = this.clock.nowHighRes()) {
        if (!this.pending.length || nowMs < this.nextRetryMs) return false;
        this.nextRetryMs = nowMs + 250;
        // One attempt per tick; a failed store cannot starve other profiles.
        const reward = this.pending.shift();
        const saved = this._save(reward);
        if (!saved) this.pending.push(reward);
        this._sync(reward.owner);
        return Boolean(saved);
    }
}
