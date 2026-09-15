import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const dockerfilePath = path.join(repositoryRoot, 'server', 'Dockerfile');
const dockerfileSource = readFileSync(dockerfilePath, 'utf8');

function parseDockerfile(source) {
    const comments = [];
    const instructions = [];
    let pending = '';
    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!pending && line.startsWith('#')) {
            comments.push(line.slice(1).trim());
            continue;
        }
        if (!pending && !line) continue;
        if (line.endsWith('\\')) {
            pending += `${line.slice(0, -1).trim()} `;
            continue;
        }
        const full = `${pending}${line}`.trim();
        pending = '';
        if (!full) continue;
        const tokens = full.split(/\s+/);
        instructions.push({ keyword: tokens[0].toUpperCase(), args: tokens.slice(1), text: full });
    }
    return { comments, instructions };
}

function collectRelativeImports(source) {
    const specifiers = [];
    const patterns = [
        /(?:^|[\s;}])(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g,
        /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
        /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
        let match = pattern.exec(source);
        while (match !== null) {
            if (match[1].startsWith('.')) specifiers.push(match[1]);
            match = pattern.exec(source);
        }
    }
    return specifiers;
}

function collectImportClosure(entryFile) {
    const visited = new Set();
    const queue = [path.resolve(entryFile)];
    while (queue.length > 0) {
        const file = queue.pop();
        if (visited.has(file)) continue;
        visited.add(file);
        if (!existsSync(file)) continue;
        for (const specifier of collectRelativeImports(readFileSync(file, 'utf8'))) {
            queue.push(path.resolve(path.dirname(file), specifier));
        }
    }
    return [...visited];
}

// Mirrors the subset of docker COPY semantics the signaling image relies on: the
// build context is the repository root, a directory source contributes its
// contents, and a trailing slash (or more than one source) marks a folder target.
function stageDockerfileCopies(instructions, stageRoot) {
    let workdir = '/';
    const toStagePath = (containerPath) => path.join(stageRoot, containerPath.replace(/^\//, ''));
    for (const instruction of instructions) {
        if (instruction.keyword === 'WORKDIR') {
            const target = instruction.args[0];
            workdir = target.startsWith('/') ? target : path.posix.join(workdir, target);
            mkdirSync(toStagePath(workdir), { recursive: true });
            continue;
        }
        if (instruction.keyword !== 'COPY') continue;
        const args = instruction.args.filter((arg) => !arg.startsWith('--'));
        const destinationArg = args[args.length - 1];
        const sources = args.slice(0, -1);
        const destination = destinationArg.startsWith('/')
            ? destinationArg
            : path.posix.join(workdir, destinationArg);
        const destinationIsFolder = destinationArg.endsWith('/') || sources.length > 1;
        for (const source of sources) {
            const absoluteSource = path.join(repositoryRoot, source);
            assert.ok(existsSync(absoluteSource), `COPY source ${source} is missing from the build context`);
            const sourceIsDirectory = statSync(absoluteSource).isDirectory();
            const target = sourceIsDirectory || !destinationIsFolder
                ? toStagePath(destination)
                : toStagePath(path.posix.join(destination, path.basename(source)));
            mkdirSync(path.dirname(target), { recursive: true });
            cpSync(absoluteSource, target, { recursive: true });
        }
    }
    return workdir;
}

test('the signaling Dockerfile installs from the lockfile and documents its build context', () => {
    const { comments, instructions } = parseDockerfile(dockerfileSource);
    const buildHint = comments.join(' ');
    assert.match(buildHint, /docker build/i);
    assert.match(buildHint, /-f\s+server\/Dockerfile/);

    const copySources = instructions
        .filter((instruction) => instruction.keyword === 'COPY')
        .flatMap((instruction) => instruction.args.filter((arg) => !arg.startsWith('--')).slice(0, -1));
    assert.ok(
        copySources.includes('server/package-lock.json'),
        'the image must copy server/package-lock.json so npm ci can run'
    );
    assert.ok(copySources.includes('server/package.json'), 'the image must copy server/package.json');

    const runCommands = instructions
        .filter((instruction) => instruction.keyword === 'RUN')
        .map((instruction) => instruction.args.join(' '));
    assert.ok(
        runCommands.some((command) => /\bnpm ci\b/.test(command)),
        'the image must install with npm ci, not npm install'
    );
    assert.ok(
        !runCommands.some((command) => /\bnpm install\b/.test(command)),
        'npm install ignores the lockfile and must not be used'
    );
});

test('the repository root keeps a .dockerignore that spares the copied sources', () => {
    const dockerignorePath = path.join(repositoryRoot, '.dockerignore');
    assert.ok(
        existsSync(dockerignorePath),
        'the repository root is the build context and needs a .dockerignore'
    );
    const patterns = readFileSync(dockerignorePath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    for (const required of ['node_modules', '.git']) {
        assert.ok(patterns.includes(required), `.dockerignore must exclude ${required}`);
    }
    for (const copied of ['server', 'src', 'src/shared', 'src/shared/contracts']) {
        assert.ok(
            !patterns.includes(copied) && !patterns.includes(`${copied}/`),
            `.dockerignore must not exclude ${copied}, the image copies from it`
        );
    }
});

test('every module signaling-server.js imports is copied into the image', (t) => {
    const stageParent = path.join(repositoryRoot, 'tmp');
    mkdirSync(stageParent, { recursive: true });
    const stageRoot = mkdtempSync(path.join(stageParent, 'dockerfile-stage-'));
    t.after(() => rmSync(stageRoot, { recursive: true, force: true }));

    const { instructions } = parseDockerfile(dockerfileSource);
    const workdir = stageDockerfileCopies(instructions, stageRoot);
    const stagedWorkdir = path.join(stageRoot, workdir.replace(/^\//, ''));
    const stagedEntry = path.join(stagedWorkdir, 'signaling-server.js');
    assert.ok(existsSync(stagedEntry), 'signaling-server.js is not copied into the image workdir');

    const sourceModules = collectImportClosure(path.join(repositoryRoot, 'server', 'signaling-server.js'))
        .filter((file) => path.relative(path.join(repositoryRoot, 'server'), file).startsWith('..'));
    assert.ok(sourceModules.length > 0, 'expected signaling-server.js to import modules outside server/');

    const stagedModules = collectImportClosure(stagedEntry);
    for (const stagedFile of stagedModules) {
        assert.ok(
            existsSync(stagedFile),
            `${path.relative(stageRoot, stagedFile)} is imported but never copied into the image`
        );
    }
    const stagedNames = new Set(stagedModules.map((file) => path.basename(file)));
    for (const module of sourceModules) {
        assert.ok(
            stagedNames.has(path.basename(module)),
            `${path.relative(repositoryRoot, module)} is imported but missing from the image`
        );
    }

    // Runtime proof: node resolves the copied tree, and importing the entry point
    // must not start listening on its own.
    const output = execFileSync(process.execPath, [
        '--input-type=module',
        '-e',
        [
            "const signaling = await import('./signaling-server.js');",
            "if (typeof signaling.createSignalingServer !== 'function') {",
            "    console.error('createSignalingServer export is missing');",
            '    process.exit(3);',
            '}',
            "console.log('imports-resolved');",
        ].join('\n'),
    ], { cwd: stagedWorkdir, encoding: 'utf8', timeout: 30_000 });
    assert.match(output, /imports-resolved/);
    assert.ok(!/Signaling Server running/.test(output), 'importing the entry point must not start the server');
});
