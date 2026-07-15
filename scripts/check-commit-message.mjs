import { readFileSync } from 'node:fs';

const messageFile = process.argv[2];

if (!messageFile) {
    console.error('Commit message file is required.');
    process.exit(2);
}

const subject = readFileSync(messageFile, 'utf8').split(/\r?\n/, 1)[0].trim();
const conventionalSubject = /^(feat|fix|refactor|test|docs|build|ci|perf|chore)\([a-z0-9][a-z0-9._/-]*\): [a-z0-9].{0,71}$/;
const generatedGitSubject = /^(Merge |Revert ")/;

if (!conventionalSubject.test(subject) && !generatedGitSubject.test(subject)) {
    console.error('Invalid commit message.');
    console.error('Expected: <type>(<scope>): <short English description>');
    console.error('Example: fix(runtime): clean up session resources');
    process.exit(1);
}
