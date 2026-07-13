import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projects = [
    'pm-abm',
    'pm-aero-system',
    'pm-avatar-garden',
    'pm-avatar-show',
    'pm-ca-world',
    'pm-christmas',
    'pm-chromatic-chaos',
    'pm-crystal-crossroads',
    'pm-lunar-year',
    'pm-medieval-fair'
];

const BASE_URL = 'https://raw.githubusercontent.com/ToxSam/open-source-3D-assets/main/data/assets/';
const DEST_DIR = path.join(__dirname, '..', 'assets', 'models', 'downloaded_cc0');

if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function fetchFile(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

async function run() {
    let totalDownloaded = 0;
    for (const project of projects) {
        const classDir = path.join(DEST_DIR, project);
        if (!fs.existsSync(classDir)) {
            fs.mkdirSync(classDir, { recursive: true });
        }

        console.log(`Fetching registry for ${project}...`);
        try {
            const dbUrl = `${BASE_URL}${project}.json`;
            const items = await fetchJson(dbUrl);

            const toDownload = items.slice(0, 12); // Download 12 per class
            for (const item of toDownload) {
                const destPath = path.join(classDir, `${item.name}.glb`);
                if (!fs.existsSync(destPath)) {
                    console.log(`  Downloading ${item.name}.glb...`);
                    try {
                        await fetchFile(item.model_file_url, destPath);
                        totalDownloaded++;
                        console.log(`  Downloaded ${item.name}.glb successfully!`);
                    } catch (err) {
                        console.error(`  Failed desc ${item.name}: ${err}`);
                    }
                } else {
                    console.log(`  Skipping existing ${item.name}.glb`);
                    totalDownloaded++;
                }
            }
        } catch (err) {
            console.error(`Failed to process project ${project} from github:`, err.message);
        }
    }
    console.log(`Done! Total downloaded: ${totalDownloaded}`);
}

run();
