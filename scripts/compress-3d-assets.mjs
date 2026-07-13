import fs from 'fs/promises';
import path from 'path';
import gltfPipeline from 'gltf-pipeline';

const processGltf = gltfPipeline.processGltf;
const processGlb = gltfPipeline.processGlb;

const PROJECT_ROOT = process.cwd();
const INPUT_DIR = path.join(PROJECT_ROOT, 'data', 'models', 'raw');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'data', 'models', 'compressed');

async function compressModels() {
    console.log('Starte 3D-Asset Kompressions-Pipeline (Draco)...');

    try {
        await fs.mkdir(INPUT_DIR, { recursive: true });
        await fs.mkdir(OUTPUT_DIR, { recursive: true });

        const files = await fs.readdir(INPUT_DIR);
        const modelFiles = files.filter(f => f.endsWith('.glb') || f.endsWith('.gltf'));

        if (modelFiles.length === 0) {
            console.log(`Keine Modelle im Verzeichnis ${INPUT_DIR} gefunden. (Leerer Lauf)`);
            return;
        }

        const options = {
            dracoOptions: {
                compressionLevel: 7
            }
        };

        for (const file of modelFiles) {
            const inputPath = path.join(INPUT_DIR, file);
            const outputPath = path.join(OUTPUT_DIR, file.replace('.gltf', '.glb')); // Immer als GLB speichern
            
            console.log(`Komprimiere: ${file}...`);
            const buffer = await fs.readFile(inputPath);
            
            let results;
            if (file.endsWith('.glb')) {
                 results = await processGlb(buffer, options);
            } else {
                 results = await processGltf(JSON.parse(buffer.toString()), options);
            }

            await fs.writeFile(outputPath, results.glb);
            
            const originalSize = buffer.length / 1024;
            const newSize = results.glb.length / 1024;
            console.log(`✓ ${file} komprimiert: ${originalSize.toFixed(2)} KB -> ${newSize.toFixed(2)} KB (${(100 - (newSize/originalSize*100)).toFixed(1)}% Reduktion)`);
        }
        
        console.log('Pipeline erfolgreich abgeschlossen.');
        
    } catch (err) {
        console.error('Fehler in der Kompressions-Pipeline:', err);
        process.exit(1);
    }
}

compressModels();