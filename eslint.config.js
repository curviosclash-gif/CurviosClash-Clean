import boundaries from 'eslint-plugin-boundaries';
import { LEGACY_MAX_LINES } from './scripts/architecture/LegacyMaxLinesConfig.mjs';

const createMaxLinesRule = (max) => ([
    'error',
    {
        max,
        skipBlankLines: true,
        skipComments: true,
    },
]);

const legacyFileCeilings = LEGACY_MAX_LINES;

const readonlyGlobals = (names) => Object.fromEntries(names.map((name) => [name, 'readonly']));

// Host globals shared by the renderer and by Node tooling. ECMAScript built-ins
// (Math, JSON, Promise, ...) come from languageOptions.ecmaVersion and are not listed.
const SHARED_HOST_GLOBALS = [
    'console', 'globalThis',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
    'performance', 'structuredClone', 'crypto', 'atob', 'btoa',
    'fetch', 'Request', 'Response', 'Headers', 'FormData', 'AbortController', 'AbortSignal',
    'Blob', 'File', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
    'ReadableStream', 'WritableStream', 'TransformStream',
    'Event', 'EventTarget', 'CustomEvent', 'MessageChannel', 'MessagePort', 'MessageEvent',
    'WebSocket', 'DOMException',
];

// Deliberately narrower than the full DOM global list: legacy window properties such as
// name, event, status, top, parent, open, close, focus and blur are left out so that
// no-undef keeps catching typos instead of silently resolving them.
const BROWSER_GLOBALS = [
    ...SHARED_HOST_GLOBALS,
    'window', 'self', 'document', 'navigator', 'location', 'history', 'screen', 'devicePixelRatio',
    'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
    'localStorage', 'sessionStorage', 'indexedDB', 'IDBKeyRange', 'caches', 'Notification',
    'getComputedStyle', 'matchMedia', 'scrollTo', 'alert', 'confirm', 'prompt',
    'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver',
    'XMLHttpRequest', 'DOMParser', 'XMLSerializer', 'FileReader', 'FileList', 'DataTransfer',
    'Image', 'ImageData', 'ImageBitmap', 'createImageBitmap', 'OffscreenCanvas', 'Path2D',
    'DOMMatrix', 'DOMPoint', 'DOMRect', 'CSS',
    'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'SVGElement',
    'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement', 'HTMLVideoElement', 'HTMLAudioElement',
    'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLButtonElement',
    'HTMLFormElement', 'HTMLDivElement', 'HTMLAnchorElement', 'HTMLLabelElement',
    'HTMLDetailsElement',
    'CanvasRenderingContext2D', 'WebGLRenderingContext', 'WebGL2RenderingContext',
    'UIEvent', 'InputEvent', 'FocusEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
    'TouchEvent', 'Touch', 'WheelEvent', 'DragEvent', 'ProgressEvent', 'ErrorEvent',
    'CloseEvent', 'PopStateEvent', 'GamepadEvent', 'Gamepad',
    'Audio', 'AudioContext', 'webkitAudioContext', 'AudioBuffer', 'AudioWorkletNode',
    'MediaRecorder', 'MediaStream', 'MediaStreamTrack', 'MediaSource', 'VideoFrame',
    'RTCPeerConnection', 'RTCSessionDescription', 'RTCIceCandidate', 'RTCDataChannel',
    'Worker', 'SharedWorker', 'BroadcastChannel',
];

const NODE_GLOBALS = [
    ...SHARED_HOST_GLOBALS,
    'process', 'Buffer', 'global', 'setImmediate', 'clearImmediate',
];

const COMMONJS_GLOBALS = [
    ...NODE_GLOBALS,
    'require', 'module', 'exports', '__dirname', '__filename',
];

// Compile-time constants replaced by Vite, see createRendererBuildDefines in
// dev/vite/rendererShellConfig.js. Keep both lists in sync.
const RENDERER_BUILD_DEFINES = [
    '__APP_VERSION__', '__BUILD_TIME__', '__BUILD_ID__', '__CURVIOS_E2E__',
    '__APP_MODE__', '__APP_TARGET__',
    '__SIGNALING_URL__', '__TURN_URL__', '__TURN_USERNAME__', '__TURN_CREDENTIAL__',
];

// Node scripts that drive a real page through Playwright: the bodies of
// page.evaluate/waitForFunction callbacks run in the browser, not in Node.
const PAGE_DRIVING_SCRIPTS = [
    'scripts/check-packaged-electron.mjs',
    'scripts/perf-jitter-matrix.mjs',
    'scripts/perf-lifecycle-measure.mjs',
    'scripts/self-trail-debug-smoke.mjs',
];

export default [
    {
        ignores: [
            'data/**',
            'dist/**',
            'node_modules/**',
            'output/**',
            'playwright-report/**',
            'test-results*/**',
            'tmp/**',
            'videos/**',
        ],
    },
    {
        plugins: {
            boundaries,
        },
        settings: {
            'boundaries/elements': [
                { type: 'core', pattern: 'src/core/**/*.js' },
                { type: 'ui', pattern: 'src/ui/**/*.js' },
                { type: 'network', pattern: 'src/network/**/*.js' },
                { type: 'contracts', pattern: 'src/shared/contracts/**/*.js' }
            ],
            'boundaries/ignore': ['**/*.test.js', '**/*.spec.js']
        }
    },
    {
        // Renderer/browser sources: ESM in a DOM host.
        files: [
            'src/**/*.js',
            'editor/**/*.js',
            'prototypes/vehicle-lab/**/*.js',
            'electron/**/*.js',
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: readonlyGlobals(BROWSER_GLOBALS),
        },
        rules: {
            'no-undef': 'error',
        },
    },
    {
        files: ['src/**/*.js'],
        languageOptions: {
            globals: readonlyGlobals(RENDERER_BUILD_DEFINES),
        },
    },
    {
        // Node tooling: ESM (package.json declares "type": "module").
        files: [
            'scripts/**/*.{js,mjs}',
            'server/**/*.{js,mjs}',
            'dev/vite/**/*.{js,mjs}',
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: readonlyGlobals(NODE_GLOBALS),
        },
        rules: {
            'no-undef': 'error',
        },
    },
    {
        files: PAGE_DRIVING_SCRIPTS,
        languageOptions: {
            globals: readonlyGlobals(BROWSER_GLOBALS),
        },
    },
    {
        // Electron main/preload and other CommonJS tooling.
        files: ['**/*.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: readonlyGlobals(COMMONJS_GLOBALS),
        },
        rules: {
            'no-undef': 'error',
        },
    },
    {
        files: [
            'src/**/*.js',
            'electron/**/*.{js,cjs,mjs}',
            'server/**/*.{js,cjs,mjs}',
            'editor/**/*.{js,cjs,mjs}',
            'scripts/**/*.{js,cjs,mjs}',
            'prototypes/vehicle-lab/**/*.{js,cjs,mjs}',
            'dev/vite/**/*.{js,cjs,mjs}',
        ],
        rules: {
            'no-unused-vars': [
                'error',
                {
                    args: 'none',
                    caughtErrors: 'none',
                },
            ],
        },
    },
    {
        files: ['src/**/*.js'],
        rules: {
            'max-lines': createMaxLinesRule(500),
            'no-restricted-syntax': [
                'warn',
                {
                    selector: 'AssignmentExpression[left.property.name="innerHTML"]',
                    message: 'Do not use innerHTML. Use document.createElement and textContent instead to prevent XSS vulnerabilities.',
                }
            ],
            'boundaries/element-types': [
                'error',
                {
                    default: 'allow',
                    rules: [
                        {
                            from: 'ui',
                            disallow: ['core'],
                            message: 'UI components MUST NOT directly import from Core. Use shared contracts or ports instead.'
                        }
                    ]
                }
            ]
        },
    },
    ...Object.entries(legacyFileCeilings).map(([file, max]) => ({
        files: [file],
        rules: {
            'max-lines': createMaxLinesRule(max),
        },
    })),
];
