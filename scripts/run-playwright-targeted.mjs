import process from 'node:process';
import { runPlaywrightProfile } from './playwright-run-profile.mjs';

runPlaywrightProfile(process.env.PW_RUN_PROFILE || 'desktop-e2e', process.argv.slice(2));
