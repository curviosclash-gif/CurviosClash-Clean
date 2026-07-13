const SETTINGS_STUDIO_FLAG = '--settings-studio';

function resolveDesktopMainEntry(argv = process.argv) {
    const args = Array.isArray(argv) ? argv : [];
    return args.includes(SETTINGS_STUDIO_FLAG)
        ? './settings-studio/main.cjs'
        : './main.cjs';
}

function startDesktopEntry(argv = process.argv) {
    return require(resolveDesktopMainEntry(argv));
}

function isElectronRuntime(runtime = process) {
    return Boolean(runtime?.versions?.electron);
}

if (isElectronRuntime()) {
    startDesktopEntry();
}

module.exports = {
    SETTINGS_STUDIO_FLAG,
    isElectronRuntime,
    resolveDesktopMainEntry,
    startDesktopEntry,
};
