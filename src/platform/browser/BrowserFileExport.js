// @ts-check

/**
 * Saves a Blob as a user-visible file. Browsers and Electron use an anchor download;
 * the Capacitor Android app cannot follow blob download links, so it writes the file
 * to the app cache and hands it to the Android share sheet.
 */

const NATIVE_EXPORT_DIRECTORY = 'exports';
const SHARE_DIALOG_TITLE = 'Datei speichern oder teilen';

/** @param {any} [runtimeGlobal] */
export function isCapacitorNativePlatform(runtimeGlobal = globalThis) {
    return runtimeGlobal?.Capacitor?.isNativePlatform?.() === true;
}

/** @param {unknown} fileName */
export function sanitizeExportFileName(fileName) {
    const baseName = String(fileName || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
    return baseName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'curviosclash-export';
}

/**
 * @param {Blob} blob
 * @param {any} runtimeGlobal
 * @returns {Promise<string>}
 */
function readBlobAsBase64(blob, runtimeGlobal) {
    const FileReaderCtor = runtimeGlobal?.FileReader || globalThis.FileReader;
    return new Promise((resolve, reject) => {
        const reader = new FileReaderCtor();
        reader.onerror = () => reject(reader.error || new Error('blob_read_failed'));
        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
        };
        reader.readAsDataURL(blob);
    });
}

async function loadCapacitorFilePlugins() {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
    ]);
    return { Filesystem, Directory, Share };
}

/** @param {unknown} error */
function isShareCancelled(error) {
    return /cancel/i.test(String(/** @type {any} */ (error)?.message || error || ''));
}

/**
 * @param {{ blob: Blob, fileName: string, runtimeGlobal?: any, loadPlugins?: () => Promise<any> }} params
 * @returns {Promise<{ saved: boolean, transport: string, uri?: string, cancelled?: boolean, error?: unknown }>}
 */
export async function shareBlobAsNativeFile({
    blob,
    fileName,
    runtimeGlobal = globalThis,
    loadPlugins = loadCapacitorFilePlugins,
}) {
    const safeName = sanitizeExportFileName(fileName);
    try {
        const { Filesystem, Directory, Share } = await loadPlugins();
        const written = await Filesystem.writeFile({
            path: `${NATIVE_EXPORT_DIRECTORY}/${safeName}`,
            data: await readBlobAsBase64(blob, runtimeGlobal),
            directory: Directory.Cache,
            recursive: true,
        });
        try {
            await Share.share({ title: safeName, files: [written.uri], dialogTitle: SHARE_DIALOG_TITLE });
        } catch (error) {
            if (isShareCancelled(error)) {
                return { saved: false, cancelled: true, transport: 'native-share', uri: written.uri };
            }
            throw error;
        }
        return { saved: true, transport: 'native-share', uri: written.uri };
    } catch (error) {
        return { saved: false, transport: 'native-share', error };
    }
}

/**
 * @param {{ blob: Blob, fileName: string, runtimeGlobal?: any }} params
 * @returns {{ saved: boolean, transport: string }}
 */
export function downloadBlobViaAnchor({ blob, fileName, runtimeGlobal = globalThis }) {
    const doc = runtimeGlobal?.document ?? null;
    const urlApi = runtimeGlobal?.URL ?? globalThis.URL;
    if (!doc || !blob || !fileName || typeof urlApi?.createObjectURL !== 'function') {
        return { saved: false, transport: 'download' };
    }
    const anchor = doc.createElement?.('a');
    const body = doc.body;
    if (!anchor || typeof anchor.click !== 'function' || typeof body?.appendChild !== 'function') {
        return { saved: false, transport: 'download' };
    }
    const url = urlApi.createObjectURL(blob);
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    runtimeGlobal?.setTimeout?.(() => {
        if (typeof urlApi?.revokeObjectURL === 'function') urlApi.revokeObjectURL(url);
    }, 0);
    return { saved: true, transport: 'download' };
}

/**
 * @param {{ blob: Blob, fileName: string, runtimeGlobal?: any }} params
 * @returns {Promise<{ saved: boolean, transport: string, uri?: string, cancelled?: boolean, error?: unknown }>}
 */
export async function saveBlobAsUserFile({ blob, fileName, runtimeGlobal = globalThis }) {
    if (isCapacitorNativePlatform(runtimeGlobal)) {
        return shareBlobAsNativeFile({ blob, fileName, runtimeGlobal });
    }
    return downloadBlobViaAnchor({ blob, fileName, runtimeGlobal });
}
