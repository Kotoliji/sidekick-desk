/**
 * Bridge from Claude Code (VS Code, terminal) to Sidekick.
 *
 * Claude Code runs `hook.cjs` on its events; the script appends one JSON line
 * per event to `events.jsonl`, which Sidekick tails. A file instead of a socket
 * means events still land while Sidekick is closed and the hook never waits on it.
 *
 * The same script guards files: before a chat edits a file that another chat
 * edited within the last minutes (tracked in `locks.json`), it stops the edit
 * and makes Claude Code ask the user, and logs a "Conflict" event.
 */
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BRIDGE_DIR = process.env.SIDEKICK_BRIDGE ?? join(homedir(), '.sidekick');
export const EVENTS_FILE = join(BRIDGE_DIR, 'events.jsonl');
const HOOK_FILE = join(BRIDGE_DIR, 'hook.cjs');
const GUARD_FILE = join(BRIDGE_DIR, 'guard.json');
const SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');
const FILE_TOOLS = 'Edit|Write|MultiEdit|NotebookEdit';
// UserPromptSubmit only tells Sidekick the user is back in a chat; it adds nothing to the prompt.
// The tool hooks fire only for file-editing tools.
const HOOKS: { event: string; matcher?: string }[] = [
  { event: 'Stop' },
  { event: 'Notification' },
  { event: 'UserPromptSubmit' },
  { event: 'PreToolUse', matcher: FILE_TOOLS },
  { event: 'PostToolUse', matcher: FILE_TOOLS },
];

/** One line of events.jsonl. */
export interface BridgeEvent {
  ts: number;
  /** Which assistant the chat runs (absent = Claude Code, from the hook). */
  agent?: 'claude' | 'codex';
  event: 'Stop' | 'Notification' | 'UserPromptSubmit' | 'Conflict';
  cwd: string;
  session: string;
  transcript?: string;
  message?: string;
  type?: string;
  last?: string;
  /** Conflict: the file, and the project of the chat that edited it first. */
  file?: string;
  other?: string;
  /** Codex: how much the conversation has grown, in tokens (Claude's is read from its transcript). */
  growth?: number;
}

/**
 * Record edits that happened without the hook (Codex has no pre-edit hook) in the same
 * claims file, so Claude chats are stopped before touching them. Returns files that
 * another chat held, as conflicts to report.
 */
export function claimFiles(files: string[], session: string, cwd: string) {
  const locksFile = join(BRIDGE_DIR, 'locks.json');
  let guard: GuardSettings = { mode: 'ask', minutes: 20 };
  let locks: Record<string, { session: string; cwd: string; ts: number }> = {};
  try {
    guard = JSON.parse(readFileSync(GUARD_FILE, 'utf8'));
  } catch {
    /* defaults */
  }
  if (guard.mode === 'off' || !files.length) return [];
  try {
    locks = JSON.parse(readFileSync(locksFile, 'utf8'));
  } catch {
    /* no claims yet */
  }
  const now = Date.now();
  const conflicts: { file: string; other: string }[] = [];
  for (const file of files) {
    const key = file.toLowerCase(); // same key as hook.cjs: resolved path, lower-cased
    const held = locks[key];
    if (held && held.session !== session && now - held.ts < guard.minutes * 60_000) conflicts.push({ file, other: held.cwd });
    locks[key] = { session, cwd, ts: now };
  }
  mkdirSync(BRIDGE_DIR, { recursive: true });
  writeFileSync(locksFile, JSON.stringify(locks));
  return conflicts;
}

export interface GuardSettings {
  /** ask: Claude Code asks the user; deny: the edit is refused; off: no guard. */
  mode: 'ask' | 'deny' | 'off';
  /** How long a chat keeps its claim on a file after editing it. */
  minutes: number;
}

/** The hook reads the guard settings from the bridge folder; Sidekick keeps them in sync with config.json. */
export function writeGuardSettings(g: GuardSettings) {
  mkdirSync(BRIDGE_DIR, { recursive: true });
  const next = JSON.stringify(g);
  if (!existsSync(GUARD_FILE) || readFileSync(GUARD_FILE, 'utf8') !== next) writeFileSync(GUARD_FILE, next);
}

// Plain CommonJS with no dependencies: it runs under whatever `node` Claude Code finds.
const HOOK_SOURCE = `// Written by Sidekick. Logs Claude Code hook events and guards files edited by two chats.
const fs = require('fs');
const path = require('path');
if (process.env.SIDEKICK_SELF) process.exit(0);

const log = (line) => fs.appendFileSync(path.join(__dirname, 'events.jsonl'), JSON.stringify(line) + '\\n');
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
};

function guard(i) {
  const g = readJson(path.join(__dirname, 'guard.json'), { mode: 'ask', minutes: 20 });
  const file = i.tool_input && (i.tool_input.file_path || i.tool_input.notebook_path);
  if (g.mode === 'off' || !file) return;
  const key = path.resolve(i.cwd || '', file).toLowerCase();
  const locksFile = path.join(__dirname, 'locks.json');
  const locks = readJson(locksFile, {});
  const now = Date.now();
  for (const k of Object.keys(locks)) if (now - locks[k].ts > g.minutes * 60000) delete locks[k];
  const held = locks[key];
  if (i.hook_event_name === 'PreToolUse' && held && held.session !== i.session_id) {
    const mins = Math.max(1, Math.round((now - held.ts) / 60000));
    log({ ts: now, event: 'Conflict', cwd: i.cwd, session: i.session_id, file, other: held.cwd });
    const reason = 'Sidekick: ' + file + ' was edited ' + mins + ' min ago by another Claude Code chat (' + path.basename(held.cwd || '') + '). Two chats editing one file can overwrite each other. Stop and check with the user before changing this file.';
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: g.mode === 'deny' ? 'deny' : 'ask', permissionDecisionReason: reason } }));
  } else {
    // A free file, or an edit that went ahead (PostToolUse, e.g. after the user allowed it): this chat holds it now.
    locks[key] = { session: i.session_id, cwd: i.cwd, ts: now };
  }
  writeJson(locksFile, locks);
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(raw);
    if (i.hook_event_name === 'PreToolUse' || i.hook_event_name === 'PostToolUse') guard(i);
    else
      log({
        ts: Date.now(),
        event: i.hook_event_name,
        cwd: i.cwd,
        session: i.session_id,
        transcript: i.transcript_path,
        message: i.message,
        type: i.notification_type,
        last: typeof i.last_assistant_message === 'string' ? i.last_assistant_message.slice(0, 800) : undefined,
      });
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
    return HOOKS.every((h) => hooks[h.event]?.some(isOurs));
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
  for (const { event, matcher } of HOOKS) {
    const rest = (hooks[event] ?? []).filter((entry) => !isOurs(entry));
    const ours = { ...(matcher && { matcher }), hooks: [{ type: 'command', command: hookCommand(), timeout: 10 }] };
    const next = on ? [...rest, ours] : rest;
    if (next.length) hooks[event] = next;
    else delete hooks[event];
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
