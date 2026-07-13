import process from 'node:process';
import { runPlaywrightProfile } from './playwright-run-profile.mjs';

runPlaywrightProfile('desktop-e2e', process.argv.slice(2));
