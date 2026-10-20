# tiledeck

A calm cockpit for parallel Claude sessions: several chats as tiles on one screen, a focus mode, and music in the corner.

> Work in progress. Built in small phases; see the commit history.

## Run it

Requirements: Node 20+, and Claude Code signed in on this machine (`claude login`) or `ANTHROPIC_API_KEY` set. tiledeck never reads or stores your credentials: each tile runs Claude Code through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) with whatever auth you already have.

```bash
npm install
npm run dev        # UI on http://127.0.0.1:5199, server on 127.0.0.1:8787
```

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Local server port |
| `TILEDECK_CWD` | current dir | Working directory for the Claude sessions |

Append `?theme=hud` or `?theme=aurora` to the URL to pick a theme.

## How it works

- `server/` is a small Node WebSocket server bound to `127.0.0.1` that rejects foreign origins. Each tile owns one long-lived Claude Code process (streaming input mode), so only the first message pays the cold start.
- `web/` is a Vite + React + TypeScript UI with two themes (Aurora glass, HUD) behind one set of CSS tokens.
- `shared/protocol.ts` is the wire protocol between them.

Tool use is denied for now; approval cards come in a later phase.

## License

MIT. Not affiliated with Anthropic.
