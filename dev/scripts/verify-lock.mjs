#!/usr/bin/env node
// Import the canonical script in-process so Windows policy blocks on node.exe spawning
// do not prevent the lock/diagnostic layer from running at all.
await import('../../scripts/verify-lock.mjs');
