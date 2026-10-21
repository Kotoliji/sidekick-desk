import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { StopperConfig } from './stoppers';

export interface SidekickConfig extends StopperConfig {
  /** Model for the manager itself; management needs no top-tier model. */
  managerModel: string;
}

const DEFAULT_CONFIG: SidekickConfig = { remindAfterMinutes: 10, longChatTokens: 150_000, managerModel: 'sonnet' };

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
  mkdirSync(dir, { recursive: true });
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

# The user's other chats
${eventsFile} is a live log of the user's Claude Code chats (VS Code, terminal), one JSON object per line:
ts (ms), event ("Stop" = a chat finished, "Notification" = a chat needs the user, "Conflict" = two chats touched the same file), cwd (the project), message, last (start of the last answer).
Read its tail when the user asks what is going on, which chats wait for them, or where they left off.

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
  return `[Long chat] The user's Claude Code chat in "${project}" (${cwd}) has grown to about ${Math.round(tokens / 1000)}k tokens of context, so it is time to continue in a fresh chat.
Below are its last turns. Reply with:
1. 3-6 short bullets: where that work stands and what is still open.
2. One fenced prompt the user can paste into a new Claude Code chat in the same folder so it picks up the work without the old context (goal, current state, next step, key files or decisions).

--- last turns ---
${turns || '(the transcript could not be read; ask the user what the chat was about)'}`;
}

export function kickoff(now = new Date()) {
  const when = now.toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `[Session start: ${when}] Read profile.md and tasks.md. Greet the user in one line with today's date, list today's open tasks briefly (or ask for the plan if there are none), then ask what we start with.`;
}
