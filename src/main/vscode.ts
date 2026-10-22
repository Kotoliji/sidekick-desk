/**
 * Which VS Code window has a folder open, so a deep link can be sent to that window
 * (VS Code routes `vscode://` links with `windowId=N` to window N, and otherwise to the
 * last active window, which is often the wrong one when several are open).
 *
 * VS Code exposes no API for this from outside, so it is read from its own files, best effort:
 * each window's extension-host log names its workspace storage folder, and that folder's
 * workspace.json names the opened folder.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_DATA = join(process.env.APPDATA ?? '', 'Code');

function readStart(path: string, bytes: number) {
  const buf = Buffer.alloc(bytes);
  const fd = openSync(path, 'r');
  const n = readSync(fd, buf, 0, bytes, 0);
  closeSync(fd);
  return buf.toString('utf8', 0, n);
}

const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

export function vscodeWindowId(folder: string): number | undefined {
  try {
    const logs = join(CODE_DATA, 'logs');
    // The running VS Code's log session is the newest one with a main.log (CLI calls leave empty ones).
    const session = readdirSync(logs)
      .filter((d) => existsSync(join(logs, d, 'main.log')))
      .sort()
      .at(-1);
    if (!session) return undefined;
    const windows = readdirSync(join(logs, session))
      .filter((d) => /^window\d+$/.test(d))
      .map((d) => Number(d.slice(6)))
      .sort((a, b) => b - a); // a reopened folder gets a newer window id: prefer it
    for (const id of windows) {
      const log = join(logs, session, `window${id}`, 'exthost', 'exthost.log');
      if (!existsSync(log)) continue;
      const hash = /workspaceStorage[\\/]([0-9a-f]{32})/.exec(readStart(log, 8192))?.[1];
      const meta = hash && join(CODE_DATA, 'User', 'workspaceStorage', hash, 'workspace.json');
      if (!meta || !existsSync(meta)) continue;
      const opened = JSON.parse(readFileSync(meta, 'utf8')).folder;
      if (typeof opened === 'string' && opened.startsWith('file:') && same(fileURLToPath(opened), folder)) return id;
    }
  } catch {
    /* VS Code's layout changed or is unreadable: fall back to the last active window */
  }
  return undefined;
}
