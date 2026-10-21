/**
 * Reading Claude Code transcripts (~/.claude/projects/<project>/<session>.jsonl).
 * They can grow to many megabytes, so only the tail is read.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';

interface Line {
  type?: string;
  isSidechain?: boolean;
  cwd?: string;
  entrypoint?: string;
  aiTitle?: string;
  payload?: { type?: string; role?: string; content?: { type: string; text?: string }[] };
  message?: {
    content?: string | { type: string; text?: string }[];
    usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
}

/** Parsed lines from the end (`fromEnd`) or the start of a transcript, reading at most `bytes`. */
function readLines(path: string, bytes: number, fromEnd = true): Line[] {
  const size = statSync(path).size;
  const len = Math.min(size, bytes);
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  readSync(fd, buf, 0, len, fromEnd ? size - len : 0);
  closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  // Drop the line cut mid-way by the read window.
  if (len < size) fromEnd ? lines.shift() : lines.pop();
  return lines.flatMap((l) => {
    try {
      return [JSON.parse(l) as Line];
    } catch {
      return [];
    }
  });
}

export interface SessionInfo {
  /** Folder the chat started in: the VS Code window's workspace, even if the chat later cd'ed elsewhere. */
  root?: string;
  /** Started from the VS Code extension (so it can be reopened there as a tab). */
  inVSCode: boolean;
  /** The chat's tab title (Claude Code's generated title). */
  title?: string;
}

export function sessionInfo(path: string): SessionInfo {
  try {
    const head = readLines(path, 64_000, false);
    const first = head.find((l) => l.cwd);
    // Latest title wins: search from the end of the file back.
    const title = [...head, ...readLines(path, 256_000)].reverse().find((l) => l.type === 'ai-title')?.aiTitle;
    return { root: first?.cwd, inVSCode: first?.entrypoint === 'claude-vscode', title };
  } catch {
    return { inVSCode: false };
  }
}

const contextOf = (l: Line) => {
  const u = l.type === 'assistant' && !l.isSidechain ? l.message?.usage : undefined;
  return u && (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
};

/**
 * How much the conversation itself has grown, in tokens: the context of the last
 * answer minus the context of the first one. The starting size (system prompt, tools,
 * MCP servers, CLAUDE.md) differs a lot between setups, so it is left out.
 */
export function conversationTokens(path: string): number | undefined {
  try {
    const last = readLines(path, 512_000).reverse().map(contextOf).find(Boolean);
    const first = readLines(path, 512_000, false).map(contextOf).find(Boolean);
    return last && first ? last - first : undefined;
  } catch {
    return undefined; // transcript moved or unreadable
  }
}

type Content = NonNullable<Line['message']>['content'];

const textOf = (content: Content) =>
  typeof content === 'string' ? content : (content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');

/** The last few user/assistant text turns, trimmed, as a plain-text digest for a handoff. */
export function recentTurns(path: string, count = 14, maxChars = 600): string {
  const turns: string[] = [];
  try {
    const lines = readLines(path, 1_500_000);
    for (let i = lines.length - 1; i >= 0 && turns.length < count; i--) {
      let l = lines[i];
      // Codex rollouts wrap messages as { type: 'response_item', payload: { type: 'message', role, content } }.
      if (l.type === 'response_item' && l.payload?.type === 'message') l = { type: l.payload.role, message: { content: l.payload.content } };
      if (l.isSidechain || (l.type !== 'user' && l.type !== 'assistant')) continue;
      const text = textOf(l.message?.content).trim();
      // Skip tool results, command echoes and other machinery.
      if (!text || text.startsWith('<')) continue;
      const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
      turns.push(`${l.type === 'user' ? 'User' : 'Claude'}: ${clipped}`);
    }
  } catch {
    /* fall through with what we have */
  }
  return turns.reverse().join('\n\n');
}
