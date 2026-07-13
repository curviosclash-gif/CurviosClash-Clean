import process from 'node:process';
import { runPlaywrightProfile } from './playwright-run-profile.mjs';

runPlaywrightProfile('desktop-smoke', process.argv.slice(2));
