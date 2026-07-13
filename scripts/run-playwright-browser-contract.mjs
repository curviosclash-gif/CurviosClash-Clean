import process from 'node:process';
import { runPlaywrightProfile } from './playwright-run-profile.mjs';

runPlaywrightProfile('browser-compat', process.argv.slice(2), {
    requireExplicitSelection: true,
});
