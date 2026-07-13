export function createHuntHudDomRefs(doc = document) {
    return {
        root: doc.getElementById('hunt-hud'),
        p1ShieldFill: doc.getElementById('hunt-p1-shield-fill'),
        p1ShieldText: doc.getElementById('hunt-p1-shield-text'),
        p1BoostFill: doc.getElementById('hunt-p1-boost-fill'),
        p1BoostText: doc.getElementById('hunt-p1-boost-text'),
        p1OverheatFill: doc.getElementById('hunt-p1-overheat-fill'),
        p1OverheatText: doc.getElementById('hunt-p1-overheat-text'),
        p2Panel: doc.getElementById('hunt-p2-panel'),
        p2ShieldFill: doc.getElementById('hunt-p2-shield-fill'),
        p2ShieldText: doc.getElementById('hunt-p2-shield-text'),
        p2BoostFill: doc.getElementById('hunt-p2-boost-fill'),
        p2BoostText: doc.getElementById('hunt-p2-boost-text'),
        p2OverheatFill: doc.getElementById('hunt-p2-overheat-fill'),
        p2OverheatText: doc.getElementById('hunt-p2-overheat-text'),
        killFeedList: doc.getElementById('hunt-kill-feed-list'),
        damageIndicatorP1: doc.getElementById('hunt-damage-indicator'),
        damageIndicatorP2: doc.getElementById('hunt-damage-indicator-p2'),
        createKillFeedItem: () => doc.createElement('li'),
    };
}
