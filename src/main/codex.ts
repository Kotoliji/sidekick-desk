/**
 * Codex (OpenAI) chats, in VS Code or the terminal, read from their session files:
 * ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. Read-only; Codex's config is untouched.
 *
 * Their events are appended to the same events.jsonl the Claude Code hook writes, so
 * bubbles, cards, stoppers and the manager treat both assistants alike.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { claimFiles, type BridgeEvent } from './hooks';
import type { SessionInfo } from './transcript';

const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const SESSIONS = join(CODEX_HOME, 'sessions');

interface Rollout {
  type?: string;
  payload?: {
    type?: string;
    id?: string;
    cwd?: string;
    originator?: string;
    last_agent_message?: string;
    name?: string;
    input?: string;
    role?: string;
    content?: { type: string; text?: string }[];
    info?: { last_token_usage?: { input_tokens?: number } };
  };
}

interface Tracked {
  offset: number;
  partial: string;
  id?: string;
  cwd?: string;
  firstContext?: number;
  lastContext?: number;
}

function readFrom(path: string, from: number, to: number) {
  const buf = Buffer.alloc(to - from);
  const fd = openSync(path, 'r');
  readSync(fd, buf, 0, buf.length, from);
  closeSync(fd);
  return buf.toString('utf8');
}

const parse = (line: string): Rollout | undefined => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

/** Files named in an apply_patch call ("*** Update File: path" and friends). */
function patchedFiles(patch: string) {
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
}

/** Start following Codex sessions; returns a stop function. */
export function watchCodex(emit: (e: BridgeEvent) => void) {
  if (!existsSync(SESSIONS)) return () => {};
  const startedAt = Date.now();
  const tracked = new Map<string, Tracked>();

  const handle = (path: string, t: Tracked, r: Rollout, live: boolean) => {
    const p = r.payload ?? {};
    if (r.type === 'session_meta') {
      t.id = p.id;
      t.cwd = p.cwd;
      return;
    }
    if (r.type === 'event_msg' && p.type === 'token_count') {
      const ctx = p.info?.last_token_usage?.input_tokens;
      if (ctx) {
        t.firstContext ??= ctx;
        t.lastContext = ctx;
      }
      return;
    }
    if (!live || !t.id || !t.cwd) return; // history replayed only to learn the session's identity and size
    const base = { ts: Date.now(), agent: 'codex' as const, cwd: t.cwd, session: t.id, transcript: path };
    if (r.type === 'event_msg' && p.type === 'task_started') emit({ ...base, event: 'UserPromptSubmit' });
    else if (r.type === 'event_msg' && p.type === 'task_complete') {
      const growth = t.firstContext && t.lastContext ? t.lastContext - t.firstContext : undefined;
      emit({ ...base, event: 'Stop', last: p.last_agent_message?.slice(0, 800), growth });
    } else if (r.type === 'response_item' && p.type === 'custom_tool_call' && p.name === 'apply_patch' && p.input) {
      // Codex has no pre-edit hook, so its edits are recorded after the fact: Claude chats
      // touching these files next will be stopped, and a file another chat held is reported.
      const files = patchedFiles(p.input).map((f) => resolve(t.cwd!, f));
      for (const c of claimFiles(files, t.id, t.cwd)) emit({ ...base, event: 'Conflict', file: c.file, other: c.other });
    }
  };

  const read = (path: string) => {
    let t = tracked.get(path);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return;
    }
    if (!t) {
      t = { offset: 0, partial: '' };
      tracked.set(path, t);
      // A session that existed before Sidekick started: learn who it is, but its past is not news.
      if (statSync(path).birthtimeMs < startedAt) {
        for (const line of readFrom(path, 0, size).split('\n')) {
          const r = parse(line);
          if (r) handle(path, t, r, false);
        }
        t.offset = size;
        return;
      }
    }
    if (size <= t.offset) return;
    const lines = (t.partial + readFrom(path, t.offset, size)).split('\n');
    t.offset = size;
    t.partial = lines.pop() ?? '';
    for (const line of lines) {
      const r = parse(line);
      if (r) handle(path, t, r, true);
    }
  };

  const watcher = watch(SESSIONS, { recursive: true }, (_type, name) => {
    if (name && String(name).endsWith('.jsonl')) read(join(SESSIONS, String(name)));
  });
  return () => watcher.close();
}

/** Window, tab and title of a Codex chat, from its session file and Codex's thread index. */
export function codexSessionInfo(path: string): SessionInfo {
  try {
    const meta = parse(readFrom(path, 0, Math.min(statSync(path).size, 64_000)).split('\n')[0])?.payload ?? {};
    // Trust the originator: desktop-app sessions also carry source "vscode".
    const originator = String(meta.originator ?? '');
    const desktop = /desktop/i.test(originator);
    const inVSCode = originator === 'codex_vscode';
    let title: string | undefined;
    const index = join(CODEX_HOME, 'session_index.jsonl');
    if (meta.id && existsSync(index)) {
      for (const line of readFileSync(index, 'utf8').split('\n')) {
        const e = parse(line) as { id?: string; thread_name?: string } | undefined;
        if (e?.id === meta.id && e.thread_name) title = e.thread_name; // the latest rename wins
      }
    }
    return { root: meta.cwd, inVSCode, desktop, title };
  } catch {
    return { inVSCode: false };
  }
}
