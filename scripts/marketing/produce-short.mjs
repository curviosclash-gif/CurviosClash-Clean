import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { buildTrailTemplateCopy } from './short-copy-templates.mjs';
import { MAX_CANDIDATES, validateBrief, validateCopy, validateEvidence } from './short-quality-contract.mjs';
import { prepareShort } from './short-quality.mjs';

function validateSupportedRecipe(brief) {
    if (!['thick', 'ghost'].includes(brief.scenario) || brief.mode !== 'CLASSIC'
        || brief.mapKey !== 'standard' || brief.subjectPlayer !== (brief.scenario === 'ghost' ? 1 : 0)) {
        throw new Error('No automatic capture recipe matches this brief; supply recorded evidence to short-quality.mjs instead');
    }
    const types = new Set(brief.scenario === 'ghost'
        ? ['TRAILS_PRESENT', 'ITEM_PICKUP', 'ITEM_USE', 'TRAIL_CROSSING']
        : ['TRAILS_PRESENT', 'ITEM_PICKUP', 'ITEM_USE', 'TRAIL_WIDENED']);
    if (brief.requiredEvents.some((type) => !types.has(type))) {
        throw new Error('Capture recipe cannot prove every required event');
    }
    if (!brief.approvedFacts?.some((fact) => fact.id === 'classic-mode' && fact.approvedBy)) {
        throw new Error('Classic mode copy needs an approved product fact');
    }
}

async function runScript(script, args, root) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...args], {
            cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let tail = '';
        for (const stream of [child.stdout, child.stderr]) {
            stream.on('data', (chunk) => { tail = (tail + chunk.toString()).slice(-6000); });
        }
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve(tail)
            : reject(new Error(`${path.basename(script)} exited ${code}: ${tail.trim()}`)));
    });
}

export function isRetryableCandidateFailure(error) {
    const message = String(error?.message || error);
    return /required events missing|first gameplay frame needs|camera .*handoff|HUD fade|gameplay contains a black or frozen|gameplay audio contains silence|short has missing or extra video frames|Capture fell behind simulation|Rehearsal failed|no verified|correctly timed|correctly ordered/i.test(message);
}

export async function produceShort({ briefPath, outputRoot, root, capture = runScript, render = runScript,
    prepare = prepareShort }) {
    const brief = validateBrief(JSON.parse(await readFile(briefPath, 'utf8')));
    validateSupportedRecipe(brief);
    await mkdir(path.dirname(outputRoot), { recursive: true });
    await mkdir(outputRoot);
    const attempts = [];
    for (let number = 1; number <= MAX_CANDIDATES; number += 1) {
        const attemptDir = path.join(outputRoot, `candidate-${number}`);
        await mkdir(attemptDir);
        try {
            await capture(path.join(root, 'scripts/marketing/produce-trail-short.mjs'), [
                attemptDir, '--portrait', ...(brief.scenario === 'ghost' ? ['--ghost'] : []),
                '--brief', briefPath,
            ], root);
            const children = (await readdir(attemptDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
            if (children.length !== 1) throw new Error('capture did not create exactly one take directory');
            const takeDir = path.join(attemptDir, children[0].name);
            const evidencePath = path.join(takeDir, 'evidence.json');
            const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
            validateEvidence(brief, evidence);
            const take = JSON.parse(await readFile(path.join(takeDir, 'take.json'), 'utf8'));
            const copy = buildTrailTemplateCopy(brief, evidence, take.orientations.portrait.beats);
            validateCopy(brief, evidence, copy);
            const copyPath = path.join(takeDir, 'copy.json');
            await writeFile(copyPath, `${JSON.stringify(copy, null, 2)}\n`, { flag: 'wx' });
            const finalDir = path.join(attemptDir, 'final');
            await render(path.join(root, 'scripts/marketing/render-trail-short.mjs'), [
                path.join(takeDir, 'take.json'), finalDir, '--portrait',
            ], root);
            const packet = await prepare({ root, briefPath, evidencePath, copyPath, renderDir: finalDir });
            attempts.push({ number, status: 'prepared', path: finalDir });
            await writeFile(path.join(outputRoot, 'candidates.json'), `${JSON.stringify(attempts, null, 2)}\n`, { flag: 'wx' });
            return packet;
        } catch (error) {
            attempts.push({ number, status: 'rejected', reason: String(error.message || error).slice(0, 1000) });
            if (!isRetryableCandidateFailure(error) || number === MAX_CANDIDATES) {
                await writeFile(path.join(outputRoot, 'candidates.json'), `${JSON.stringify(attempts, null, 2)}\n`, { flag: 'wx' });
                throw new Error(`No candidate passed after ${number} attempt(s): ${attempts.at(-1).reason}`);
            }
        }
    }
}

async function main(args) {
    if (args.length !== 2) throw new Error('usage: produce-short.mjs <brief.json> <new-output-root>');
    const root = process.cwd();
    const briefPath = path.resolve(args[0]);
    const outputRoot = path.resolve(args[1]);
    await produceShort({ briefPath, outputRoot, root });
    console.log(`Prepared short: ${outputRoot}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main(process.argv.slice(2)).catch((error) => { console.error(error); process.exitCode = 1; });
}
