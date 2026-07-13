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
