import path from 'node:path';

/**
 * Groups of chunks that import each other statically, directly or through others.
 * A page evaluates such a ring from whichever chunk it imports first, so a binding
 * that one chunk reads at module initialization can still be in its temporal dead
 * zone ("Cannot access 'x' before initialization") on one page and fine on another.
 * @param {Array<{ fileName: string, imports: string[] }>} chunks
 * @returns {string[][]} Each ring as sorted chunk file names.
 */
export function findStaticChunkRings(chunks) {
    const imports = new Map(chunks.map((chunk) => [chunk.fileName, chunk.imports.filter((name) => name !== chunk.fileName)]));
    const index = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    const rings = [];
    let counter = 0;

    // Tarjan's strongly connected components; every component above one chunk is a ring.
    const visit = (name) => {
        index.set(name, counter);
        low.set(name, counter);
        counter += 1;
        stack.push(name);
        onStack.add(name);
        for (const next of imports.get(name) || []) {
            if (!imports.has(next)) continue;
            if (!index.has(next)) {
                visit(next);
                low.set(name, Math.min(low.get(name), low.get(next)));
            } else if (onStack.has(next)) {
                low.set(name, Math.min(low.get(name), index.get(next)));
            }
        }
        if (low.get(name) !== index.get(name)) return;
        const component = [];
        let member;
        do {
            member = stack.pop();
            onStack.delete(member);
            component.push(member);
        } while (member !== name);
        if (component.length > 1) rings.push(component.sort());
    };
    for (const name of imports.keys()) if (!index.has(name)) visit(name);
    return rings;
}

/** Fails every renderer build whose chunks import each other in a ring. */
export function rendererChunkRingGuardPlugin({ rootDir = process.cwd() } = {}) {
    return {
        name: 'curvios-renderer-chunk-ring-guard',
        apply: 'build',
        generateBundle(_options, bundle) {
            const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
            const rings = findStaticChunkRings(chunks);
            if (rings.length === 0) return;
            const chunkOfModule = new Map();
            for (const chunk of chunks) for (const id of chunk.moduleIds) chunkOfModule.set(id, chunk.fileName);
            const relative = (id) => path.relative(rootDir, id).replace(/\\/g, '/');
            const lines = [];
            for (const ring of rings) {
                lines.push(`ring: ${ring.join(' <-> ')}`);
                for (const chunk of chunks.filter((candidate) => ring.includes(candidate.fileName))) {
                    const edges = [];
                    for (const id of chunk.moduleIds) {
                        for (const dependency of this.getModuleInfo(id)?.importedIds || []) {
                            const target = chunkOfModule.get(dependency);
                            if (target && target !== chunk.fileName && ring.includes(target)) {
                                edges.push(`  ${relative(id)} -> ${relative(dependency)} (${target})`);
                            }
                        }
                    }
                    lines.push(...edges.slice(0, 8));
                    if (edges.length > 8) lines.push(`  ... ${edges.length - 8} more from ${chunk.fileName}`);
                }
            }
            this.error(`Renderer chunks import each other statically:\n${lines.join('\n')}`);
        },
    };
}
