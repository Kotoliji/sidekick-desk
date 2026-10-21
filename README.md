# Sidekick

A pixel-art octopus that floats on your Windows desktop and manages your day. You do the deep work in your Claude Code chats; Sidekick keeps the plan, helps you shape prompts and choose a direction, and pings you with a speech bubble when something needs you. Click it and it unfolds into a small chat.

> Work in progress. Built in small phases; see the commit history. Next up: alerts when a Claude Code chat in VS Code finishes or is waiting for you.

## What it does today

- The octopus floats above your windows; clicks pass through everywhere except the octopus itself.
- Drag it anywhere (it remembers the spot), click to open the chat, right-click for the menu (open chat, tasks folder, quit).
- Greets you with the date at start, reads your profile and today's tasks, and asks for the plan.
- When an answer lands while the chat is closed, it shows up as a speech bubble; click the bubble to open the chat.
- Keeps `tasks.md` current as you talk ("add…", "done with…", "move to backlog").
- Writes prompts for your other chats as code blocks with a one-click copy button.

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

- `src/main` is the Electron main process: a transparent always-on-top pet window (mouse pass-through outside the sprite), the chat panel it unfolds into, and one long-lived Claude Code session (Agent SDK, streaming input) with a manager system prompt and a write-only-inside-the-folder tool policy.
- `src/preload` exposes a small typed IPC API (`window.sidekick`) to the sandboxed window.
- `src/renderer` serves both windows (`?view=pet|panel`): the octopus (an original 20×18 sprite drawn as SVG rects in `octopus.ts`, with blink and swim frames) and the React chat with Markdown answers and two themes, Aurora (translucent, Windows 11 acrylic) and HUD (flat, amber).
- `src/shared/protocol.ts` is the contract between them.

## License

MIT. Not affiliated with Anthropic.
