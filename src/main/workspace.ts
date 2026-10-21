import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { StopperConfig } from './stoppers';

export interface SidekickConfig extends StopperConfig {
  /** Model for the manager itself; management needs no top-tier model. */
  managerModel: string;
  /** Past this many tokens the manager writes its journal and starts with a fresh context. */
  managerContextLimit: number;
  /** Two chats editing one file: "ask" the user, "deny" the edit, or "off". */
  fileGuard: 'ask' | 'deny' | 'off';
  /** How long a chat keeps its claim on a file it edited. */
  fileGuardMinutes: number;
}

const DEFAULT_CONFIG: SidekickConfig = {
  remindAfterMinutes: 10,
  longChatTokens: 100_000,
  managerModel: 'sonnet',
  managerContextLimit: 40_000,
  fileGuard: 'ask',
  fileGuardMinutes: 20,
};

/** Plain-file home of the manager: the user edits these files by hand too. */
export function dataDir() {
  return process.env.SIDEKICK_HOME ?? join(app.getPath('documents'), 'Sidekick');
}

const DEFAULTS: Record<string, string> = {
  'profile.md': `# Profile

Sidekick reads this file at every start. Write it in your own words.

- Name:
- Language: Russian
- What I work on:
- How I like to be helped: short answers, one next step at a time
`,
  'tasks.md': `# Tasks

## Today

## Backlog
`,
  'config.json': `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
};

/** Read on every use, so edits to config.json apply without a restart (the model on the next session). */
export function loadConfig(): SidekickConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(join(dataDir(), 'config.json'), 'utf8')) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function ensureWorkspace() {
  const dir = dataDir();
  mkdirSync(join(dir, 'journal'), { recursive: true });
  for (const [name, body] of Object.entries(DEFAULTS)) {
    const file = join(dir, name);
    if (!existsSync(file)) writeFileSync(file, body);
  }
  return dir;
}

export function isInside(dir: string, path: string) {
  const rel = relative(dir, resolve(dir, path));
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
}

/** The manager's whole system prompt: it replaces Claude Code's coding preset. */
export function managerPrompt(dir: string, eventsFile: string) {
  return `You are Sidekick, the user's personal manager agent. You live in a small window on their Windows desktop.

# What you are, and are not
- You manage the user's work: the day's plan, priorities, direction, and prompts for their other AI chats.
- You do not implement. Never write or review code at length and never analyse a codebase. When something needs real work, write a prompt for the user's Claude Code chat instead.
- Light checks only: you may glance at one file or at the chats log to answer a question. Do not dig.

# Workspace
Your files live in ${dir}. You may read any file, but you may only write inside this folder.
- profile.md: who the user is and how to work with them. Follow it.
- tasks.md: the plan, "- [ ]" / "- [x]". Keep it current with Edit whenever the user adds, finishes or moves a task. Keep "Today" to at most 5 items; move the rest to "Backlog".
- journal/YYYY-MM-DD.md: your short notes from earlier sessions. Your conversation is cleared regularly, so anything worth remembering belongs in tasks.md or the journal.

# The user's other chats
${eventsFile} is a live log of the user's Claude Code and Codex (OpenAI) chats in VS Code or the terminal, one JSON object per line:
ts (ms), agent ("codex", or absent for Claude Code), event ("Stop" = a chat finished, "Notification" = a chat needs the user, "Conflict" = two chats touched the same file), cwd (the project), message, last (start of the last answer).
The user sees these events as speech bubbles from you (the octopus) and as cards in your chat. When something happened since their last message, it comes first in that message under "[Chat activity …]": treat it as what the user has seen, and refer to it naturally. For anything older, read the tail of the log.

# How to answer
Use this shape, skipping parts that do not apply, with the labels in the user's language:
1. **Goal**: one line.
2. **Next step**: exactly one concrete action.
3. **Prompt**: when the step happens in another chat, one fenced code block ready to paste. A prompt you write states the goal, the context, the constraints and "done when".
4. **Check**: one line on how the user will know it worked.
Sanity-check every request: if a plan or prompt looks unrealistic, risky, or too big for one step, say so in one line and offer a smaller step.
Keep it short: at most 8 lines outside code blocks, no tables, no preamble. Reply in the user's language.`;
}

export function handoffPrompt(project: string, cwd: string, tokens: number, turns: string) {
  return `[Long chat] The user's Claude Code chat in "${project}" (${cwd}) has grown by about ${Math.round(tokens / 1000)}k tokens of conversation, so it is time to continue in a fresh chat.
Below are its last turns. Reply with:
1. 3-6 short bullets: where that work stands and what is still open.
2. One fenced prompt the user can paste into a new Claude Code chat in the same folder so it picks up the work without the old context (goal, current state, next step, key files or decisions).

--- last turns ---
${turns || '(the transcript could not be read; ask the user what the chat was about)'}`;
}

/** Local calendar day as YYYY-MM-DD. */
export const dayKey = (d = new Date()) => d.toLocaleDateString('sv-SE');

/** The newest journal entry, relative to the workspace, if any. */
function latestJournal(dir: string) {
  try {
    const last = readdirSync(join(dir, 'journal'))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .at(-1);
    return last && `journal/${last}`;
  } catch {
    return undefined;
  }
}

const stamp = (now: Date) =>
  now.toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** First turn of a fresh session at the start of a day. */
export function kickoff(dir: string, now = new Date()) {
  const journal = latestJournal(dir);
  return `[Session start: ${stamp(now)}] Read profile.md, tasks.md${journal ? ` and ${journal} (your last notes)` : ''}. If tasks.md has a "Tomorrow" section from an earlier day, move those items into "Today". Greet the user in one line with today's date, list today's open tasks briefly (or ask for the plan if there are none), then ask what we start with.`;
}

/** First turn of a fresh session that replaces a full one mid-day: no greeting. */
export function resumeKickoff(dir: string, now = new Date()) {
  const journal = latestJournal(dir);
  return `[Context refreshed: ${stamp(now)}] Your earlier conversation was saved and cleared. Read tasks.md${journal ? ` and ${journal}` : ''}. Do not greet; reply with one line: what we are focused on right now.`;
}

/**
 * Last turn before the context is erased: everything worth keeping goes to files.
 * `day` is the day being closed (yesterday, for a new-day rollover).
 */
export function wrapUpPrompt(day: string, now = new Date()) {
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `[Wrap-up] Your conversation context is about to be erased; only your files survive. Briefly, now:
1. Update tasks.md: check off what is done and keep what is open. Put anything planned for the next day under a "## Tomorrow" heading (create it if missing).
2. Append to journal/${day}.md (create it if missing) a section "## ${time}" with 3-5 short lines: what got done, what is still open, decisions or facts worth remembering.
Then reply with exactly one short line confirming it, in the user's language.`;
}
