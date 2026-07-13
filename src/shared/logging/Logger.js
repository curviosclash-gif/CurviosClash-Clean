// Async Error-Handling Pattern (V59.4.3)
// ─────────────────────────────────────
// All async operations MUST use try-catch with a specific logger call.
// No bare-catch blocks (i.e. `catch { }` or `.catch(() => {})`).
//
//   try {
//       const res = await fetch(url);
//       const data = await res.json();
//   } catch (err) {
//       logger.warn('descriptive context:', err);
//   }
//
// For fire-and-forget fetch: `.catch((err) => { logger.debug('context:', err); })`
// Production builds suppress debug/info — only warn+error reach the console.

/** @typedef {{ DEV?: boolean }} LoggerImportMetaEnv */
/** @typedef {{ env?: LoggerImportMetaEnv }} LoggerImportMeta */
/**
 * @typedef {object} LoggerOutput
 * @property {((...args: any[]) => void)=} debug
 * @property {((...args: any[]) => void)=} info
 * @property {((...args: any[]) => void)=} log
 * @property {((...args: any[]) => void)=} warn
 * @property {((...args: any[]) => void)=} error
 */
/** @typedef {{ level?: number, output?: LoggerOutput }} LoggerOptions */

const LOG_LEVEL = Object.freeze({
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    SILENT: 4,
});

const LEVEL_NAMES = ['debug', 'info', 'warn', 'error', 'silent'];

const IMPORT_META = /** @type {LoggerImportMeta | undefined} */ (
    typeof import.meta !== 'undefined' ? import.meta : undefined
);

const DEFAULT_LEVEL = IMPORT_META?.env?.DEV
    ? LOG_LEVEL.DEBUG
    : LOG_LEVEL.WARN;

export class Logger {
    /**
     * @param {string} namespace
     * @param {LoggerOptions} [options]
     */
    constructor(namespace, { level, output } = {}) {
        this._namespace = namespace ? `[${namespace}]` : '';
        this._level = level ?? DEFAULT_LEVEL;
        this._output = output ?? console;
    }

    debug(...args) {
        if (this._level <= LOG_LEVEL.DEBUG) {
            this._output.debug(this._namespace, ...args);
        }
    }

    info(...args) {
        if (this._level <= LOG_LEVEL.INFO) {
            (this._output.info ?? this._output.log).call(this._output, this._namespace, ...args);
        }
    }

    warn(...args) {
        if (this._level <= LOG_LEVEL.WARN) {
            this._output.warn(this._namespace, ...args);
        }
    }

    error(...args) {
        if (this._level <= LOG_LEVEL.ERROR) {
            this._output.error(this._namespace, ...args);
        }
    }

    setLevel(level) {
        if (typeof level === 'string') {
            const idx = LEVEL_NAMES.indexOf(level);
            this._level = idx >= 0 ? idx : DEFAULT_LEVEL;
        } else if (typeof level === 'number') {
            this._level = level;
        }
    }

    child(subNamespace) {
        const parentNs = this._namespace
            ? this._namespace.slice(1, -1)
            : '';
        const ns = parentNs ? `${parentNs}:${subNamespace}` : subNamespace;
        return new Logger(ns, { level: this._level, output: this._output });
    }
}

export { LOG_LEVEL };

export function createLogger(namespace, options) {
    return new Logger(namespace, options);
}
