import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appBundle, canReplace, pickZip, prepare, swapScript } from '../src/mac-update.ts';

const files = [
  { url: 'Pocket-Master-Editor-0.13.1-mac-arm64.zip', sha512: 'a' },
  { url: 'Pocket-Master-Editor-0.13.1-mac-arm64.dmg', sha512: 'b' },
  { url: 'Pocket-Master-Editor-0.13.1-mac-x64.zip', sha512: 'c' },
];
const mac = process.platform === 'darwin';

test('the update zip matches the running architecture', () => {
  assert.equal(pickZip(files, 'arm64')?.sha512, 'a');
  assert.equal(pickZip(files, 'x64')?.sha512, 'c');
  assert.equal(pickZip(files, 'ia32'), undefined);
});

test('the app replaces itself only from a writable folder, never from a disk image or a translocated copy', () => {
  assert.equal(appBundle('/Applications/Pocket Master Editor.app/Contents/MacOS/Pocket Master Editor'), '/Applications/Pocket Master Editor.app');
  const yes = () => true;
  assert.equal(canReplace('/Applications/Pocket Master Editor.app', yes), true);
  assert.equal(canReplace('/Volumes/Pocket Master Editor/Pocket Master Editor.app', yes), false);
  assert.equal(canReplace('/private/var/folders/x/AppTranslocation/1/d/Pocket Master Editor.app', yes), false);
  assert.equal(canReplace('/Applications/Pocket Master Editor.app', () => false), false);
  assert.equal(canReplace('/usr/local/bin/node', yes), false);
});

/** A zipped fake app, its bytes and their SHA-512 the way latest-mac.yml publishes it. */
function fakeRelease(version: string) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-release-'));
  mkdirSync(join(dir, 'Pocket Master Editor.app', 'Contents'), { recursive: true });
  writeFileSync(join(dir, 'Pocket Master Editor.app', 'Contents', 'version'), version);
  const zip = join(dir, 'update.zip');
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', join(dir, 'Pocket Master Editor.app'), zip]);
  const bytes = readFileSync(zip);
  return { bytes, sha512: createHash('sha512').update(bytes).digest('base64') };
}
const serve = (bytes: Uint8Array) => async () => new Response(Uint8Array.from(bytes));

test('a downloaded update is checked against its SHA-512 before it is unpacked', { skip: !mac }, async () => {
  const release = fakeRelease('2');
  const next = await prepare({ url: 'x.zip', sha512: release.sha512 }, 'https://example/x.zip', serve(release.bytes));
  assert.equal(readFileSync(join(next, 'Contents', 'version'), 'utf8'), '2');
  await assert.rejects(prepare({ url: 'x.zip', sha512: 'tampered' }, 'https://example/x.zip', serve(release.bytes)), /SHA-512/);
});

test('the swap replaces the bundle once the app has exited, and keeps the old one if the copy fails', { skip: !mac }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pm-installed-'));
  const bundle = join(root, 'Pocket Master Editor.app');
  mkdirSync(join(bundle, 'Contents'), { recursive: true });
  writeFileSync(join(bundle, 'Contents', 'version'), '1');
  const release = fakeRelease('2');
  const ready = await prepare({ url: 'x.zip', sha512: release.sha512 }, '', serve(release.bytes));
  const run = (from: string) => spawnSync('/bin/sh', ['-c', swapScript, 'swap', bundle, from, '999999', '0']);
  assert.equal(run(ready).status, 0);
  assert.equal(readFileSync(join(bundle, 'Contents', 'version'), 'utf8'), '2');
  assert.equal(existsSync(ready), false, 'the downloaded copy is cleaned up');
  run(join(root, 'missing.app'));
  assert.equal(readFileSync(join(bundle, 'Contents', 'version'), 'utf8'), '2', 'a failed copy rolls back');
});
