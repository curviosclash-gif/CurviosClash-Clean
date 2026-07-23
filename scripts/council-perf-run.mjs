import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const TICKS = process.argv.includes('--quick') ? 180 : 600;
const WARMUP = process.argv.includes('--quick') ? 30 : 120;
const RAW_JSON = process.argv.includes('--raw');
const COMPACT = process.argv.includes('--compact');

const scriptPath = resolve(import.meta.dirname || '.', 'perf-snapshot.mjs');
const args = ['--ticks', String(TICKS), '--warmup', String(WARMUP), '--raw'];

const result = execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
});
const report = JSON.parse(result);

const { snapshot, config } = report;
const fm = snapshot.frameMs;

const promptBlock = `
PERFORMANCE SNAPSHOT (${config.ticks} ticks, p95 threshold: 16ms)
  frameMs: avg=${fm.avg.toFixed(2)} min=${fm.min.toFixed(2)} max=${fm.max.toFixed(2)} p95=${fm.p95.toFixed(2)} p99=${fm.p99.toFixed(2)}
  status:  ${fm.p95 > 16 ? '&#x1f534; FRAME DROPS (p95 > 16ms)' : fm.p95 > 8 ? '&#x1f7e0; MARGINAL (p95 > 8ms)' : '&#x1f7e2; OK'}
  spikes:  ${snapshot.spikes.recent > 0 ? `&#x1f534; ${snapshot.spikes.recent} spikes detected` : '&#x1f7e2; none'}
  subsystems: update=${snapshot.subsystems.update?.avg?.toFixed(2) || '0.00'}ms collision=${snapshot.subsystems.collision?.avg?.toFixed(2) || '0.00'}ms render=${snapshot.subsystems.render?.avg?.toFixed(2) || '0.00'}ms
`.trim();

if (RAW_JSON) {
    process.stdout.write(JSON.stringify(report));
} else if (COMPACT) {
    process.stdout.write(promptBlock);
} else {
    process.stdout.write('=== Council-Perf Snapshot ===\n');
    process.stdout.write(promptBlock + '\n');
    process.stdout.write('\n=== Full JSON ===\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
