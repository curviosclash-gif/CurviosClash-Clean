import { createRuntimeConfigSnapshot } from '../../../src/core/RuntimeConfig.js';
import {
    MATCH_KERNEL_FIXED_STEP_SECONDS,
} from '../../../src/shared/contracts/MatchKernelRuntimeContract.js';
import {
    createHeadlessMatchKernelRuntime,
} from '../src/state/HeadlessMatchKernelRuntime.js';
import {
    HEURISTIC_PROFILES,
} from '../../../src/entities/ai/HeuristicBotPolicyOps.js';

const FIXED_STEP = MATCH_KERNEL_FIXED_STEP_SECONDS;
const MAX_TICKS = 3600;

function fightSettings(profile) {
    return {
        localSettings: { modePath: 'fight', sessionType: 'single' },
        mode: '1p', mapKey: 'standard', gameMode: 'HUNT',
        numBots: 2, winsNeeded: 1,
        botDifficulty: 'NORMAL', botPolicyStrategy: 'heuristic', botHeuristicProfile: profile,
        gameplay: { planarMode: false, fightPlayerHp: 100, fightMgDamage: 15, mgTrailAimRadius: 0.3 },
        hunt: { respawnEnabled: false, deathmatchKillLimit: 1 },
        portalsEnabled: false,
    };
}

function detectWinner(em) {
    const bots = em.players.filter((p) => p.isBot && p.alive);
    const humans = em.players.filter((p) => !p.isBot && p.alive);
    if (bots.length === 1 && humans.length === 0) return { winner: bots[0].index, isBot: true };
    if (bots.length === 0 && humans.length === 1) return { winner: humans[0].index, isBot: false };
    const allAlive = em.players.filter((p) => p.alive);
    if (allAlive.length <= 1) return { winner: allAlive[0]?.index ?? -1, isBot: allAlive[0]?.isBot ?? false };
    return null;
}

async function runMatch(settings) {
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    const runtime = await Promise.resolve(createHeadlessMatchKernelRuntime({
        settings, runtimeConfig,
        requestedMapKey: runtimeConfig.session.mapKey,
        profile: { sessionId: 'tuning-run', fixedStepSeconds: FIXED_STEP, deterministic: true },
    }));

    const em = runtime.session.entityManager;
    const bots = em.players.filter((p) => p.isBot);
    const prevAlive = em.players.map(() => true);
    const deathTicks = {};
    let winner = null, endTick = MAX_TICKS;

    for (let frame = 1; frame <= MAX_TICKS; frame++) {
        runtime.step(
            { players: [{ actions: {} }] },
            { tickIndex: runtime.kernel.tickIndex, fixedStepSeconds: FIXED_STEP, frameId: frame, wallClockMs: frame * 16, highResTimestampMs: frame * 16 }
        );
        for (const p of em.players) { if (prevAlive[p.index] && !p.alive) deathTicks[p.index] = frame; prevAlive[p.index] = p.alive; }
        winner = detectWinner(em);
        if (winner) { endTick = frame; break; }
    }
    if (!winner && em.players.some((p) => p.alive)) { const a = em.players.filter((p) => p.alive); winner = { winner: a[0].index, isBot: a[0].isBot }; }
    if (!winner) winner = { winner: -1, isBot: false };

    const survival = {};
    for (const bot of bots) survival[`bot_${bot.index}`] = (deathTicks[bot.index] || endTick) * FIXED_STEP;
    runtime.dispose();
    return { winnerIsBot: winner.isBot, winnerIndex: winner.winner, endTick, survival, forced: endTick >= MAX_TICKS };
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function med(arr) { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

async function runBattery(settingsFn, rounds) {
    const profiles = Object.keys(HEURISTIC_PROFILES);
    const data = {}; for (const p of profiles) data[p] = { wins: 0, rounds: 0, survivals: [], forced: 0 };
    for (let r = 0; r < rounds; r++) {
        for (const profile of profiles) {
            const res = await runMatch(settingsFn(profile));
            data[profile].rounds++; if (res.winnerIsBot) data[profile].wins++;
            if (res.forced) data[profile].forced++;
            Object.values(res.survival).forEach((s) => data[profile].survivals.push(s));
        }
    }
    return data;
}

function printTable(title, data) {
    console.log(`\n### ${title} ###\n`);
    console.log('| Profil     | Runden | Bot-Wins | Forced | Survival O | Median |');
    console.log('|------------|--------|----------|--------|------------|--------|');
    for (const profile of Object.keys(HEURISTIC_PROFILES)) {
        const d = data[profile];
        console.log(`| ${profile.padEnd(10)} | ${String(d.rounds).padEnd(6)} | ${String(d.wins).padEnd(8)} | ${String(d.forced).padEnd(6)} | ${avg(d.survivals).toFixed(1).padEnd(10)}s | ${med(d.survivals).toFixed(1).padEnd(6)}s |`);
    }
}

function printDelta(label, def, agg, fn) {
    const d = fn(def), a = fn(agg);
    const delta = d - a;
    console.log(`  ${label.padEnd(20)} def: ${d.toFixed(1)} agg: ${a.toFixed(1)} delta: ${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${delta > 0 ? '^' : delta < 0 ? 'v' : '='}`);
}

async function main() {
    console.log('=== HEADLESS KERNEL TUNING LOOP ===');
    console.log('Fight: 2 bots, 100 HP, 15 MG, no respawn\n');
    const ROUNDS = 12;
    console.log(`Running ${ROUNDS} rounds per profile...`);

    const fight = await runBattery(fightSettings, ROUNDS);
    printTable('FIGHT MODE', fight);

    console.log('\n=== DELTA ANALYSIS (defensive vs aggressive) ===\n');
    const d = fight.defensive, a = fight.aggressive;
    printDelta('Fight Survival O', d, a, (x) => avg(x.survivals));
    printDelta('Fight Survival Med', d, a, (x) => med(x.survivals));
    printDelta('Fight Winrate %', d, a, (x) => x.wins / x.rounds * 100);
    printDelta('Fight Forced %', d, a, (x) => x.forced / x.rounds * 100);

    const dA = avg(d.survivals), aA = avg(a.survivals);
    const spread = ((dA - aA) / Math.max(0.01, (dA + aA) / 2)) * 100;
    console.log(`\nProfile spread: ${spread.toFixed(1)}%`);
    if (spread < 10) console.log('NARROW -- widen safetyDistance gap');
    else if (spread > 40) console.log('WIDE -- profiles well differentiated');
    else console.log('ADEQUATE');
}

const TIMER = setTimeout(() => { console.error('timeout'); process.exit(2); }, 900000);
TIMER.unref?.();
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
