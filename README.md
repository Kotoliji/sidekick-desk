# Sidekick

A pixel-art octopus that floats on your Windows desktop and manages your day. You do the deep work in your Claude Code chats; Sidekick keeps the plan, helps you shape prompts and choose a direction, and pings you with a speech bubble when something needs you. Click it and it unfolds into a small chat.

> Work in progress. Built in small phases; see the commit history.

## What it does today

- The octopus floats above your windows; clicks pass through everywhere except the octopus itself.
- Drag it anywhere (it remembers the spot), click to open the chat, right-click for the menu (open chat, tasks folder, quit).
- Greets you with the date at start, reads your profile and today's tasks, and asks for the plan.
- When an answer lands while the chat is closed, it shows up as a speech bubble; click the bubble to open the chat.
- Every bubble about your chats is also kept as a card in the Sidekick chat, and the manager is told about them with your next message, so you can ask it "what happened?". Click a card to jump to that chat: Sidekick focuses the VS Code window it was opened in and opens its tab (reopening it if closed).
- Keeps `tasks.md` current as you talk ("add…", "done with…", "move to backlog").
- Writes prompts for your other chats as code blocks with a one-click copy button.
- Watches your Claude Code and Codex (OpenAI) chats, in VS Code or the terminal, several per project if you like: a green bubble when one finishes, a yellow one when a Claude chat needs your permission. Labels read "PROJECT · tab title".
- Codex is followed read-only through its session files (`~/.codex/sessions`), with no change to its config. Its file edits are recorded for the file guard, so a Claude chat is stopped before touching a file Codex just edited; Codex itself has no pre-edit hook, so its own clashes are reported after the fact.
- Stoppers: a reminder when a chat has waited for you 10 minutes (writing in that chat cancels it), and a purple bubble when a chat's conversation has grown by 100k tokens (its fixed starting size, which depends on your tools and MCP servers, is left out). Click that one and Sidekick reads the end of the chat and writes a short summary plus a prompt to continue in a fresh chat.
- File guard: when a chat is about to edit a file that a different chat edited in the last 20 minutes, the edit is stopped and Claude Code asks you first (or refuses outright, if you prefer); a red bubble tells you which chats collided. Edits made through shell commands are not covered.
- A manager, not a coder: it runs in its own environment (own prompt, no plugins or CLAUDE.md, a lighter model) and answers as goal → one next step → a ready prompt → how to check. It turns implementation requests into prompts for your Claude Code chats and flags plans that are too big for a day.
- Memory in files, not in context: when its context passes a limit, at a new day, or on **Wrap up now**, it writes 3-5 lines to `journal/` and a "Tomorrow" list to `tasks.md`, then starts fresh from those files.

## Connecting your Claude Code chats

Right-click the octopus → **Connect Claude Code chats**. This adds hook entries (`Stop`, `Notification`, `UserPromptSubmit`, and `PreToolUse`/`PostToolUse` for file-editing tools only) to `~/.claude/settings.json`, keeping a backup at `settings.json.sidekick-backup`, and leaves the rest of the file untouched. Unticking it removes them. New chats pick it up; reload VS Code windows that were already open.

The hook is a tiny dependency-free script, `~/.sidekick/hook.cjs`, that appends one JSON line per event to `~/.sidekick/events.jsonl` and keeps file claims in `~/.sidekick/locks.json`. Sidekick tails that file, so the hook never blocks Claude Code and events are not lost while Sidekick is closed. The manager agent can read the same log when you ask it what is going on.

## Your files

Sidekick's memory is plain Markdown in `Documents\Sidekick` (the ▤ button opens it). Edit them by hand any time:

| File | Purpose |
|---|---|
| `profile.md` | Who you are and how you like to be helped. Read at every start. |
| `tasks.md` | Today's plan and the backlog, as `- [ ]` checkboxes. |
| `journal/YYYY-MM-DD.md` | The manager's short notes, written before each context reset. |
| `config.json` | Settings, applied without a restart (the model on the next session): `remindAfterMinutes` (10), `longChatTokens` (100000), `managerModel` ("sonnet"), `managerContextLimit` (40000), `fileGuard` ("ask", "deny" or "off"), `fileGuardMinutes` (20). |

The agent may read any file but can only write inside this folder.

## Install

`npm run dist` builds `release\Sidekick Setup <version>.exe`, a one-click per-user installer (no admin rights) with Start menu and desktop shortcuts. The installed app starts with Windows by default; untick **Start with Windows** in the octopus menu to stop that. The installer is not code-signed, so SmartScreen will ask you to confirm ("More info" → "Run anyway").

The Claude Code binary that the Agent SDK drives is bundled (unpacked next to `app.asar`), which is why the installer is about 190 MB. You still need to be signed in to Claude Code on the machine.

## Run from source

Requirements: Windows 10/11, Node 20+, and Claude Code signed in on this machine (`claude login`) or `ANTHROPIC_API_KEY` set. Sidekick never reads or stores your credentials: it runs Claude Code through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) with whatever auth you already have.

```bash
npm install
npm run dev
npm test           # stopper logic
npm run dist       # Windows installer in release/
npm run icon       # regenerate build/icon.png from the sprite
```

| Env var | Default | Meaning |
|---|---|---|
| `SIDEKICK_HOME` | `Documents\Sidekick` | Folder with `profile.md` and `tasks.md` |
| `SIDEKICK_BRIDGE` | `~/.sidekick` | Folder with the hook script and the event log |

If the app starts as a plain Node process from inside VS Code, your terminal has `ELECTRON_RUN_AS_NODE=1` set; unset it first.

## How it works

- `src/main` is the Electron main process: a transparent always-on-top pet window (mouse pass-through outside the sprite), the chat panel it unfolds into, and one long-lived Claude Code session (Agent SDK, streaming input) with a manager system prompt and a write-only-inside-the-folder tool policy.
- `src/preload` exposes a small typed IPC API (`window.sidekick`) to the sandboxed window.
- `src/renderer` serves both windows (`?view=pet|panel`): the octopus (an original 20×18 sprite drawn as SVG rects in `octopus.ts`, with blink and swim frames) and the React chat with Markdown answers and two themes, Aurora (translucent, Windows 11 acrylic) and HUD (flat, amber).
- `src/shared/protocol.ts` is the contract between them.

## License

MIT. Not affiliated with Anthropic.
