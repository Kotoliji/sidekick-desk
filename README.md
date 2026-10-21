# Sidekick

A personal manager agent that lives in a small window on your Windows desktop. You do the deep work in your Claude Code chats; Sidekick keeps the day's plan, helps you shape prompts and choose a direction, and keeps you on one next step.

> Work in progress. Built in small phases; see the commit history. Next up: alerts when a Claude Code chat in VS Code finishes or is waiting for you.

## What it does today

- Greets you with the date at start, reads your profile and today's tasks, and asks for the plan.
- Keeps `tasks.md` current as you talk ("add…", "done with…", "move to backlog").
- Writes prompts for your other chats as code blocks with a one-click copy button.
- Sits at the right edge of the screen, remembers where you put it; the pin button keeps it on top.

## Your files

Sidekick's memory is plain Markdown in `Documents\Sidekick` (the ▤ button opens it). Edit them by hand any time:

| File | Purpose |
|---|---|
| `profile.md` | Who you are and how you like to be helped. Read at every start. |
| `tasks.md` | Today's plan and the backlog, as `- [ ]` checkboxes. |

The agent may read any file but can only write inside this folder.

## Run it

Requirements: Windows 10/11, Node 20+, and Claude Code signed in on this machine (`claude login`) or `ANTHROPIC_API_KEY` set. Sidekick never reads or stores your credentials: it runs Claude Code through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) with whatever auth you already have.

```bash
npm install
npm run dev
```

| Env var | Default | Meaning |
|---|---|---|
| `SIDEKICK_HOME` | `Documents\Sidekick` | Folder with `profile.md` and `tasks.md` |

If the app starts as a plain Node process from inside VS Code, your terminal has `ELECTRON_RUN_AS_NODE=1` set; unset it first.

## How it works

- `src/main` is the Electron main process: the frameless widget window, its saved position, and one long-lived Claude Code session (Agent SDK, streaming input) with a manager system prompt and a write-only-inside-the-folder tool policy.
- `src/preload` exposes a small typed IPC API (`window.sidekick`) to the sandboxed window.
- `src/renderer` is the React + TypeScript chat with Markdown answers and two themes behind one set of CSS tokens: Aurora (translucent, Windows 11 acrylic) and HUD (flat, amber).
- `src/shared/protocol.ts` is the contract between them.

## License

MIT. Not affiliated with Anthropic.
