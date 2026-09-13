import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMapAssetArgs, resolveMapAssetJobs } from './map-asset-jobs.mjs';
import { createMapWorldSource } from './map-world-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function findBlender(explicit) {
    if (explicit) return explicit;
    if (process.env.BLENDER_BIN) return process.env.BLENDER_BIN;
    if (process.platform === 'win32') {
        const foundation = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Blender Foundation');
        if (existsSync(foundation)) {
            const candidates = readdirSync(foundation).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
            for (const entry of candidates) {
                const executable = path.join(foundation, entry, 'blender.exe');
                if (existsSync(executable)) return executable;
            }
        }
    }
    return 'blender';
}

try {
    const options = parseMapAssetArgs(process.argv.slice(2));
    const plan = resolveMapAssetJobs(options);
    console.log(JSON.stringify(plan, null, 2));
    if (!options.dryRun) {
        if (plan.nativeMaps.length) {
            throw new Error(`No Blender generator registered for: ${plan.nativeMaps.join(', ')}. No assets were written.`);
        }
        if (!plan.jobs.length) throw new Error('The selected maps have no registered Blender assets yet.');
        const blender = findBlender(options.blender);
        for (const job of plan.jobs) {
            const world = job.script === 'generate_map_world.py';
            const result = spawnSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
                '--python', path.join(root, 'scripts', 'generate_map_assets.py'), '--', '--pack', job.pack,
                ...(options.outputDir ? ['--output-dir', path.resolve(options.outputDir)] : []),
                ...(job.pack === 'burg_falkenwacht' ? [] : job.parts.flatMap((part) => ['--part', part])),
            ], { cwd: root, windowsHide: true, stdio: [world ? 'pipe' : 'ignore', 'inherit', 'inherit'],
                input: world ? JSON.stringify(createMapWorldSource(job.pack)) : undefined, shell: false });
            if (result.error || result.status !== 0) {
                throw new Error(`Blender failed for ${job.pack}: ${result.error?.message || result.status}`);
            }
        }
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
