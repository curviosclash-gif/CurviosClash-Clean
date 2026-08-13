import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function option(name, fallback = '') {
    const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
    return inline ? inline.slice(name.length + 3) : fallback;
}

const artifactDirectory = path.resolve(option('directory', 'release'));
const requestedArch = option('arch');
const architectures = requestedArch ? [requestedArch] : ['x64', 'arm64'];
assert.ok(architectures.every((arch) => ['x64', 'arm64'].includes(arch)), 'Invalid release architecture.');
const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
const electronPackage = JSON.parse(await readFile('electron/package.json', 'utf8'));
assert.equal(rootPackage.version, electronPackage.version, 'Root and Electron versions differ.');
const tag = option('tag', process.env.GITHUB_REF_NAME || '');
if (tag) assert.equal(tag, `v${rootPackage.version}`, `Tag ${tag} does not match v${rootPackage.version}.`);

const directoryEntries = existsSync(artifactDirectory) ? await readdir(artifactDirectory) : [];
const lines = [];
const signatureStatuses = [];
for (const architecture of architectures) {
    const fileName = `CurviosClash-Setup-${rootPackage.version}-${architecture}.exe`;
    assert.equal(directoryEntries.includes(fileName), true, `Release installer is missing: ${fileName}`);
    const filePath = path.join(artifactDirectory, fileName);
    const hash = createHash('sha256').update(await readFile(filePath)).digest('hex');
    const proofPath = path.join(artifactDirectory, `installer-proof-${architecture}.json`);
    assert.equal(existsSync(proofPath), true, `Installed-product proof is missing: ${proofPath}`);
    const proof = JSON.parse((await readFile(proofPath, 'utf8')).replace(/^\uFEFF/, ''));
    assert.equal(proof.architecture, architecture, `Proof architecture mismatch for ${architecture}.`);
    assert.equal(String(proof.installerSha256).toLowerCase(), hash, `Tested bytes differ for ${fileName}.`);
    if (process.platform === 'win32') {
        const signatureStatus = execFileSync('powershell', [
            '-NoProfile',
            '-Command',
            `(Get-AuthenticodeSignature -LiteralPath '${filePath.replaceAll("'", "''")}').Status`,
        ], { encoding: 'utf8' }).trim();
        if (process.env.CSC_LINK) assert.equal(signatureStatus, 'Valid', `Signed release required for ${fileName}.`);
        proof.signatureStatus = signatureStatus;
        signatureStatuses.push(signatureStatus);
    }
    lines.push(`${hash}  ${fileName}`);
}
await writeFile(path.join(artifactDirectory, 'SHA256SUMS.txt'), `${lines.sort().join('\n')}\n`, 'utf8');
const signingStatus = signatureStatuses.length > 0 && signatureStatuses.every((status) => status === 'Valid')
    ? 'SIGNED'
    : 'UNSIGNED';
await writeFile(path.join(artifactDirectory, 'RELEASE-SIGNING.txt'), `${signingStatus}\n`, 'utf8');
await writeFile(
    path.join(artifactDirectory, 'RELEASE-NOTES.md'),
    `Windows installer signing status: **${signingStatus}**.\n\nThe published installers are the exact bytes covered by SHA256SUMS.txt and the native installer-test proofs.\n`,
    'utf8'
);
console.log(JSON.stringify({
    artifactDirectory,
    version: rootPackage.version,
    architectures,
    checksums: 'SHA256SUMS.txt',
    signingStatus,
}));
