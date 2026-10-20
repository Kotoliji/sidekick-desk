# tiledeck

A calm cockpit for parallel Claude sessions on your Windows desktop. Every chat is its own frameless window; tiledeck tiles them across the screen so you can keep three or four conversations going side by side.

> Work in progress. Built in small phases; see the commit history.

## Run it

Requirements: Windows 10/11, Node 20+, and Claude Code signed in on this machine (`claude login`) or `ANTHROPIC_API_KEY` set. tiledeck never reads or stores your credentials: each window runs Claude Code through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) with whatever auth you already have.

```bash
npm install
npm run dev
```

| Shortcut / button | Action |
|---|---|
| `+` in a window header | Open another chat window (up to 4); all windows re-tile |
| `–` / `×` | Minimize / close that chat |
| Aurora · HUD | Switch theme in every window |
| Enter / Shift+Enter | Send / new line |

| Env var | Default | Meaning |
|---|---|---|
| `TILEDECK_CWD` | your home folder | Working directory for the Claude sessions |

If the app starts as a plain Node process from inside VS Code, your terminal has `ELECTRON_RUN_AS_NODE=1` set; unset it first.

## How it works

- `src/main` is the Electron main process. It creates one frameless window per chat, lays them out as a grid over the screen's work area, and owns one long-lived Claude Code process per window (Agent SDK, streaming input), so only the first message pays the cold start.
- `src/preload` exposes a small typed IPC API (`window.tiledeck`) to the sandboxed windows.
- `src/renderer` is the React + TypeScript chat UI with two themes behind one set of CSS tokens: Aurora (translucent, Windows 11 acrylic) and HUD (flat, amber).
- `src/shared/protocol.ts` is the contract between them.

Tool use is denied for now; approval cards come in a later phase.

## License

MIT. Not affiliated with Anthropic.
