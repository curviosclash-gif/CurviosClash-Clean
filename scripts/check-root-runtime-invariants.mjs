import process from 'node:process';
import {
    REQUIRED_EDITOR_VIEW_FILES,
    REQUIRED_DATA_DIRECTORIES,
    REQUIRED_ROOT_FILES,
    assertEditorStartScriptContainsEditorPath,
    collectMissingPaths,
} from './root-runtime-protection.mjs';

const REPO_ROOT = process.cwd();

const missingRootFiles = collectMissingPaths(REPO_ROOT, REQUIRED_ROOT_FILES);
if (missingRootFiles.length > 0) {
    console.error('Root runtime invariant guard failed (missing required root files):');
    for (const missingFile of missingRootFiles) {
        console.error(`- ${missingFile}`);
    }
    process.exit(1);
}

const missingDataDirectories = collectMissingPaths(REPO_ROOT, REQUIRED_DATA_DIRECTORIES);
if (missingDataDirectories.length > 0) {
    console.error('Root runtime invariant guard failed (missing required runtime data directories):');
    for (const missingDirectory of missingDataDirectories) {
        console.error(`- ${missingDirectory}`);
    }
    process.exit(1);
}

const missingEditorViewFiles = collectMissingPaths(REPO_ROOT, REQUIRED_EDITOR_VIEW_FILES);
if (missingEditorViewFiles.length > 0) {
    console.error('Root runtime invariant guard failed (missing required editor view files):');
    for (const missingView of missingEditorViewFiles) {
        console.error(`- ${missingView}`);
    }
    process.exit(1);
}

assertEditorStartScriptContainsEditorPath(REPO_ROOT, 'start_editor.bat');
assertEditorStartScriptContainsEditorPath(REPO_ROOT, 'start_editor_local.bat');

console.log('Root runtime invariant guard passed.');
console.log(`Required root files: ${REQUIRED_ROOT_FILES.length}`);
console.log(`Required data directories: ${REQUIRED_DATA_DIRECTORIES.length}`);
console.log(`Required editor view files: ${REQUIRED_EDITOR_VIEW_FILES.length}`);
