/**
 * Self-update for the macOS build. Squirrel.Mac (electron-updater's way) only accepts an update
 * signed by the same Apple developer as the running app, and this app is ad-hoc signed (no Apple
 * Developer account), so it updates itself: download the release zip, check it against the SHA-512
 * published in latest-mac.yml, unpack it, and swap the .app bundle after the app quits.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

export interface UpdateFile {
  readonly url: string;
  readonly sha512: string;
}

/** The release zip for this Mac's architecture (arm64 or x64). */
export function pickZip(files: readonly UpdateFile[], arch: string): UpdateFile | undefined {
  return files.find((f) => f.url.endsWith(`-mac-${arch}.zip`));
}

/** The .app bundle around the running executable (…/Name.app/Contents/MacOS/Name). */
export function appBundle(execPath: string): string {
  return dirname(dirname(dirname(execPath)));
}

const isWritable = (path: string) => {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether the app can replace itself: a bundle in a folder the user can write to. Not from the
 * disk image (/Volumes) and not from a translocated copy (an app opened where it was downloaded
 * runs from a read-only random path until it is moved).
 */
export function canReplace(bundle: string, writable: (path: string) => boolean = isWritable): boolean {
  if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return false;
  return writable(dirname(bundle)) && writable(bundle);
}

/** Downloads the zip, checks its SHA-512 and unpacks it; resolves to the new .app bundle. */
export async function prepare(file: UpdateFile, url: string, fetcher: (url: string) => Promise<Response>): Promise<string> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`downloading the update failed (HTTP ${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (createHash('sha512').update(bytes).digest('base64') !== file.sha512) {
    throw new Error('the downloaded update does not match its published SHA-512');
  }
  const dir = mkdtempSync(join(tmpdir(), 'pocket-master-update-'));
  const zip = join(dir, 'update.zip');
  writeFileSync(zip, bytes);
  await promisify(execFile)('/usr/bin/ditto', ['-x', '-k', zip, join(dir, 'app')]);
  const app = readdirSync(join(dir, 'app')).find((name) => name.endsWith('.app'));
  if (!app) throw new Error('the update has no app bundle');
  return join(dir, 'app', app);
}

/**
 * sh script, arguments: bundle, new bundle, pid, relaunch (1/0). Waits for the app to exit,
 * moves the old bundle aside, copies the new one in (putting the old one back if that fails),
 * clears the quarantine flag, removes the download and reopens the app when asked.
 */
export const swapScript = `
bundle="$1"; next="$2"; pid="$3"; relaunch="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
old="$bundle.old-$$"
if mv "$bundle" "$old"; then
  if /usr/bin/ditto "$next" "$bundle"; then rm -rf "$old"; else rm -rf "$bundle"; mv "$old" "$bundle"; fi
fi
/usr/bin/xattr -dr com.apple.quarantine "$bundle" 2>/dev/null
case "$next" in */pocket-master-update-*/app/*.app) rm -rf "$(dirname "$(dirname "$next")")" ;; esac
if [ "$relaunch" = 1 ]; then /usr/bin/open "$bundle"; fi
`;

/** Starts the swap detached, so it runs after the app has quit. */
export function startSwap(bundle: string, next: string, pid: number, relaunch: boolean): void {
  spawn('/bin/sh', ['-c', swapScript, 'swap', bundle, next, String(pid), relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref();
}
