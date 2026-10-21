/**
 * Bridge from Claude Code (VS Code, terminal) to Sidekick.
 *
 * Claude Code runs `hook.cjs` on Stop and Notification events; the script
 * appends one JSON line per event to `events.jsonl`, which Sidekick tails.
 * A file instead of a socket means events still land while Sidekick is closed
 * and the hook never blocks Claude Code.
 */
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BRIDGE_DIR = process.env.SIDEKICK_BRIDGE ?? join(homedir(), '.sidekick');
export const EVENTS_FILE = join(BRIDGE_DIR, 'events.jsonl');
const HOOK_FILE = join(BRIDGE_DIR, 'hook.cjs');
const SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');
const EVENTS = ['Stop', 'Notification'] as const;

/** One line of events.jsonl. */
export interface BridgeEvent {
  ts: number;
  event: 'Stop' | 'Notification';
  cwd: string;
  session: string;
  message?: string;
  type?: string;
  last?: string;
}

// Plain CommonJS with no dependencies: it runs under whatever `node` Claude Code finds.
const HOOK_SOURCE = `// Written by Sidekick. Appends Claude Code hook events to events.jsonl.
const fs = require('fs');
const path = require('path');
if (process.env.SIDEKICK_SELF) process.exit(0);
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(raw);
    const line = {
      ts: Date.now(),
      event: i.hook_event_name,
      cwd: i.cwd,
      session: i.session_id,
      message: i.message,
      type: i.notification_type,
      last: typeof i.last_assistant_message === 'string' ? i.last_assistant_message.slice(0, 800) : undefined,
    };
    fs.appendFileSync(path.join(__dirname, 'events.jsonl'), JSON.stringify(line) + '\\n');
  } catch {}
  process.exit(0);
});
`;

export function writeHookScript() {
  mkdirSync(BRIDGE_DIR, { recursive: true });
  writeFileSync(HOOK_FILE, HOOK_SOURCE);
}

const hookCommand = () => `node "${HOOK_FILE.replace(/\\/g, '/')}"`;
const isOurs = (entry: { hooks?: { command?: string }[] }) =>
  !!entry.hooks?.some((h) => h.command === hookCommand() || h.command?.includes('.sidekick/hook.cjs'));

type Settings = { hooks?: Record<string, { matcher?: string; hooks?: { type: string; command?: string; timeout?: number }[] }[]> } & Record<string, unknown>;

function readSettings(): Settings {
  return existsSync(SETTINGS_FILE) ? JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) : {};
}

export function hooksInstalled() {
  try {
    const hooks = readSettings().hooks ?? {};
    return EVENTS.every((e) => hooks[e]?.some(isOurs));
  } catch {
    return false;
  }
}

/**
 * Add (or remove) Sidekick's entries in ~/.claude/settings.json, leaving
 * everything else as it was. The first write keeps a backup next to it.
 * Returns the old and new file text; `dryRun` only computes them.
 */
export function setHooks(on: boolean, { dryRun = false } = {}) {
  const before = existsSync(SETTINGS_FILE) ? readFileSync(SETTINGS_FILE, 'utf8') : '{}\n';
  const settings = readSettings();
  const hooks = { ...(settings.hooks ?? {}) };
  for (const e of EVENTS) {
    const rest = (hooks[e] ?? []).filter((entry) => !isOurs(entry));
    const next = on ? [...rest, { hooks: [{ type: 'command', command: hookCommand(), timeout: 10 }] }] : rest;
    if (next.length) hooks[e] = next;
    else delete hooks[e];
  }
  const updated: Settings = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete updated.hooks;
  const after = JSON.stringify(updated, null, 2) + '\n';
  if (!dryRun && after !== before) {
    writeHookScript();
    const backup = `${SETTINGS_FILE}.sidekick-backup`;
    if (existsSync(SETTINGS_FILE) && !existsSync(backup)) copyFileSync(SETTINGS_FILE, backup);
    mkdirSync(join(homedir(), '.claude'), { recursive: true });
    writeFileSync(SETTINGS_FILE, after);
  }
  return { before, after };
}

/** Call `onEvent` for every event appended from now on. Returns a stop function. */
export function tailEvents(onEvent: (e: BridgeEvent) => void) {
  mkdirSync(BRIDGE_DIR, { recursive: true });
  // Old events are history, not news; drop the log once it gets big.
  if (existsSync(EVENTS_FILE) && statSync(EVENTS_FILE).size > 2_000_000) writeFileSync(EVENTS_FILE, '');
  let offset = existsSync(EVENTS_FILE) ? statSync(EVENTS_FILE).size : 0;
  let partial = '';

  const read = () => {
    if (!existsSync(EVENTS_FILE)) return;
    const size = statSync(EVENTS_FILE).size;
    if (size < offset) offset = 0;
    if (size === offset) return;
    const buf = Buffer.alloc(size - offset);
    const fd = openSync(EVENTS_FILE, 'r');
    readSync(fd, buf, 0, buf.length, offset);
    closeSync(fd);
    offset = size;
    const lines = (partial + buf.toString('utf8')).split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) {
      try {
        onEvent(JSON.parse(line));
      } catch {
        /* a torn or foreign line: skip it */
      }
    }
  };

  watchFile(EVENTS_FILE, { interval: 700 }, read);
  return () => unwatchFile(EVENTS_FILE, read);
}
