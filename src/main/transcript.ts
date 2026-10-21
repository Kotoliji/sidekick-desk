/**
 * Reading Claude Code transcripts (~/.claude/projects/<project>/<session>.jsonl).
 * They can grow to many megabytes, so only the tail is read.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';

interface Line {
  type?: string;
  isSidechain?: boolean;
  message?: {
    content?: string | { type: string; text?: string }[];
    usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
}

function tailLines(path: string, bytes: number): Line[] {
  const size = statSync(path).size;
  const len = Math.min(size, bytes);
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  readSync(fd, buf, 0, len, size - len);
  closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  if (len < size) lines.shift(); // first line is cut mid-way
  return lines.flatMap((l) => {
    try {
      return [JSON.parse(l) as Line];
    } catch {
      return [];
    }
  });
}

/** Tokens in the chat's context as of its last answer (what the model actually saw). */
export function contextTokens(path: string): number | undefined {
  try {
    const lines = tailLines(path, 512_000);
    for (let i = lines.length - 1; i >= 0; i--) {
      const u = lines[i].type === 'assistant' && !lines[i].isSidechain ? lines[i].message?.usage : undefined;
      if (u) return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    }
  } catch {
    /* transcript moved or unreadable */
  }
  return undefined;
}

type Content = NonNullable<Line['message']>['content'];

const textOf = (content: Content) =>
  typeof content === 'string' ? content : (content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');

/** The last few user/assistant text turns, trimmed, as a plain-text digest for a handoff. */
export function recentTurns(path: string, count = 14, maxChars = 600): string {
  const turns: string[] = [];
  try {
    const lines = tailLines(path, 1_500_000);
    for (let i = lines.length - 1; i >= 0 && turns.length < count; i--) {
      const l = lines[i];
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
