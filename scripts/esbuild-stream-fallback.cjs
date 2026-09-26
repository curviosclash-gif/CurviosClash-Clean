if (process.platform === 'win32') {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const writeFile = fs.writeFile;

    // esbuild falls back to its process pipe when writing a large temporary input fails.
    fs.writeFile = function (file, contents, options, callback) {
        const done = typeof options === 'function' ? options : callback;
        if (
            typeof file === 'string' &&
            path.dirname(file) === os.tmpdir() &&
            /^esbuild-[a-f0-9]{64}$/.test(path.basename(file)) &&
            typeof done === 'function'
        ) {
            queueMicrotask(() => done(new Error('Use esbuild stream transport')));
            return;
        }
        return writeFile.apply(this, arguments);
    };
}
