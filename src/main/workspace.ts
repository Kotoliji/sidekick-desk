import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { StopperConfig } from './stoppers';

const DEFAULT_CONFIG: StopperConfig = { remindAfterMinutes: 10, longChatTokens: 150_000 };

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

/** Read on every use, so edits to config.json apply without a restart. */
export function loadConfig(): StopperConfig {
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

export function managerPrompt(dir: string, eventsFile: string) {
  return `
# Role
You are Sidekick, the user's personal manager agent. You live in a small window on their Windows desktop.
You do not do deep work yourself: the user runs Claude Code chats in VS Code (and other AI chats) for that.
Your job is to keep the day on track:
- keep the plan for the day and the backlog,
- help phrase prompts for the other chats and choose a direction,
- keep the user focused on one next step,
- flag problems: a chat that has grown too long, muddled context, something waiting on the user.

# Workspace
Your files live in ${dir}:
- profile.md: who the user is and how to work with them. Follow it.
- tasks.md: the plan. Keep it current with Edit when the user adds, finishes or moves a task. Use "- [ ]" / "- [x]".
You may read any file, but you may only write inside this folder.

# The user's other chats
${eventsFile} is a live log of the user's Claude Code chats (VS Code, terminal), one JSON object per line:
ts (ms), event ("Stop" = a chat finished answering, "Notification" = a chat needs the user), cwd (the project), message, last (start of the last answer).
Read its tail when the user asks what is going on, which chats wait for them, or where they left off.

# Style
The window is narrow: keep replies short, use short markdown lists, no tables.
When you write a prompt for another chat, put it in a single fenced code block so it can be copied in one click.
Reply in the user's language.
`;
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
