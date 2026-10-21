import { app } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

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
};

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

export function kickoff(now = new Date()) {
  const when = now.toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `[Session start: ${when}] Read profile.md and tasks.md. Greet the user in one line with today's date, list today's open tasks briefly (or ask for the plan if there are none), then ask what we start with.`;
}
