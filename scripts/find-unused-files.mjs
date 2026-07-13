import fs from 'fs/promises';
import path from 'path';

const SRC_DIRS = ['src', 'editor', 'index.html', 'style.css'];
const ASSET_DIRS = ['assets'];
const JS_DIRS = ['src', 'editor/js'];

async function getFiles(dir, ext = null) {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return ext && !dir.endsWith(ext) ? [] : [dir];

    const files = await fs.readdir(dir);
    let result = [];
    for (const file of files) {
        const filePath = path.join(dir, file);
        const subStat = await fs.stat(filePath);
        if (subStat.isDirectory()) {
            result = result.concat(await getFiles(filePath, ext));
        } else if (!ext || filePath.endsWith(ext)) {
            result.push(filePath);
        }
    }
    return result;
}

async function readFileContents(dirs) {
    let content = '';
    for (const dir of dirs) {
        try {
            const files = await getFiles(dir);
            for (const file of files) {
                if (file.endsWith('.js') || file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.md')) { // only read text files
                    content += await fs.readFile(file, 'utf-8') + '\n';
                }
            }
        } catch (e) { /* ignore non-existent */ }
    }
    return content;
}

async function run() {
    console.log('1. Lese Codebase ein...');
    const codebase = await readFileContents(SRC_DIRS);

    console.log('2. Suche nach ungenutzten Assets...');
    let unusedAssets = [];
    try {
        const assets = await getFiles('assets');
        for (const asset of assets) {
            const basename = path.basename(asset);
            if (!codebase.includes(basename)) {
                unusedAssets.push(asset);
            }
        }
    } catch (e) {
        console.log('Kein assets Ordner gefunden oder Fehler beim Lesen.');
    }

    console.log('3. Suche nach ungenutzten JS Dateien via Textexact-Match...');
    let unusedJsFiles = [];
    for (const dir of JS_DIRS) {
        try {
            const jsFiles = await getFiles(dir, '.js');
            for (const jsFile of jsFiles) {
                const basename = path.basename(jsFile);
                // Skip main entries
                if (basename === 'main.js') continue;
                // Check if file name appears anywhere in the codebase (minus itself)
                const regex = new RegExp(basename, 'g');
                const matches = codebase.match(regex);
                if (!matches || matches.length <= 1) { // 1 is expected because we read the file itself into `codebase` if it's in SRC_DIRS
                    // let's do a stricter check. Just checking if basename without extension is mentioned
                    const baseNoExt = basename.replace('.js', '');
                    const matchesNoExt = codebase.match(new RegExp(baseNoExt, 'g'));
                    if (!matchesNoExt || matchesNoExt.length <= 1) {
                        unusedJsFiles.push(jsFile);
                    }
                }
            }
        } catch (e) { /* ignore */ }
    }

    console.log('\n--- BERICHT ---');
    console.log(`\nUngenutzte Assets (${unusedAssets.length}):`);
    unusedAssets.forEach(a => console.log('  - ' + a));

    console.log(`\nMöglicherweise ungenutzte JS Dateien (reiner Text-Match, ${unusedJsFiles.length}):`);
    unusedJsFiles.forEach(f => console.log('  - ' + f));
    console.log('\nHinweis: JS Dateien sollten primär mit knip geprüft werden. Diese Liste markiert Dateien, deren Namensstamm im gesamten Projekt nicht mehrfach vorkommt.');
}

run().catch(console.error);
