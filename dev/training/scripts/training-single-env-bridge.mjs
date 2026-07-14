#!/usr/bin/env node
import process from 'node:process';
import readline from 'node:readline';

import { HeadlessBoundaryController } from './training-headless-lane-runner.mjs';

const forwardToStderr = (...args) => {
    process.stderr.write(`${args.map((entry) => String(entry)).join(' ')}\n`);
};
Reflect.set(console, 'log', forwardToStderr);
Reflect.set(console, 'info', forwardToStderr);
Reflect.set(console, 'warn', forwardToStderr);
Reflect.set(console, 'error', forwardToStderr);

function parseArgs(argv) {
    const options = {
        port: 9765,
        maxSteps: 100,
        seed: 91,
        sessionId: 'bt92-single-env',
        rewardProfileId: '',
        mapKey: 'standard',
        domainMode: 'classic-3d',
        gameMode: '',
        modePath: '',
        curriculumStepOffset: 0,
    };
    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--port') {
            options.port = Number(argv[index + 1]);
            index += 1;
            continue;
        }
        if (value === '--max-steps') {
            options.maxSteps = Number(argv[index + 1]);
            index += 1;
            continue;
        }
        if (value === '--seed') {
            options.seed = Number(argv[index + 1]);
            index += 1;
            continue;
        }
        if (value === '--session-id') {
            options.sessionId = String(argv[index + 1] || options.sessionId);
            index += 1;
            continue;
        }
        if (value === '--reward-profile-id') {
            options.rewardProfileId = String(argv[index + 1] || '');
            index += 1;
            continue;
        }
        if (value === '--map-key') {
            options.mapKey = String(argv[index + 1] || options.mapKey);
            index += 1;
            continue;
        }
        if (value === '--domain-mode') {
            options.domainMode = String(argv[index + 1] || options.domainMode);
            index += 1;
            continue;
        }
        if (value === '--game-mode') {
            options.gameMode = String(argv[index + 1] || '');
            index += 1;
            continue;
        }
        if (value === '--mode-path') {
            options.modePath = String(argv[index + 1] || '');
            index += 1;
            continue;
        }
        if (value === '--planar-mode') {
            options.planarMode = String(argv[index + 1] || '');
            index += 1;
            continue;
        }
        if (value === '--curriculum-step-offset') {
            options.curriculumStepOffset = Number(argv[index + 1] || 0);
            index += 1;
        }
    }
    return options;
}


async function main() {
    const options = parseArgs(process.argv);
    const controller = new HeadlessBoundaryController({
        ...options,
        episodeIdPrefix: 'bt92-headless',
    });
    await controller.initialize();

    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });

    try {
        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            let decoded = null;
            try {
                decoded = JSON.parse(trimmed);
                const command = String(decoded.command || '').trim();
                let response = null;
                if (command === 'reset') {
                    response = await controller.reset();
                } else if (command === 'step') {
                    response = await controller.step();
                } else if (command === 'stats') {
                    response = await controller.stats();
                } else if (command === 'close') {
                    response = await controller.close();
                    process.stdout.write(`${JSON.stringify(response)}\n`);
                    break;
                } else {
                    throw new Error(`unsupported command: ${command || '<empty>'}`);
                }
                process.stdout.write(`${JSON.stringify(response)}\n`);
            } catch (error) {
                process.stdout.write(`${JSON.stringify({
                    ok: false,
                    command: decoded?.command || null,
                    error: error?.stack || String(error),
                })}\n`);
            }
        }
    } finally {
        await controller.close();
        rl.close();
    }
}

main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
});
