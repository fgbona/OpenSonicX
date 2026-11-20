import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

/**
 * The file of the static web export (`root`) an `app://` URL asks for: `/` is index.html, a
 * path without an extension is that page's .html, and anything missing or outside `root`
 * (dot segments, encoded or not) is 404.html.
 */
export function resolveAppFile(root: string, url: string): string {
  const notFound = join(root, '404.html');
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return notFound;
  }
  const target = normalize(join(root, path));
  if (target !== root && !target.startsWith(root + sep)) return notFound;
  const candidates = path.endsWith('/') ? [join(target, 'index.html')] : [target, `${target}.html`, join(target, 'index.html')];
  return candidates.find(isFile) ?? notFound;
}
