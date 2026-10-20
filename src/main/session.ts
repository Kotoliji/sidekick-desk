import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TileEvent } from '../shared/protocol';

/** Async queue of user messages: the session's prompt stream, kept open between turns. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting?: (r: IteratorResult<SDKUserMessage>) => void;
  private ended = false;

  push(text: string) {
    const msg: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    if (this.waiting) {
      this.waiting({ value: msg, done: false });
      this.waiting = undefined;
    } else this.items.push(msg);
  }

  end() {
    this.ended = true;
    this.waiting?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

export interface SessionOptions {
  cwd: string;
  model?: string;
  resume?: string;
}

/**
 * One long-lived Claude Code process per tile (streaming input mode), so only
 * the first message pays the cold start.
 */
export class Session {
  private inbox = new Inbox();
  private q: Query;
  private startedAt = 0;
  private streaming = false;

  constructor(private emit: (e: TileEvent) => void, opts: SessionOptions) {
    this.q = query({
      prompt: this.inbox,
      options: {
        cwd: opts.cwd,
        model: opts.model,
        resume: opts.resume,
        includePartialMessages: true,
        // Tool approval cards come in a later phase; until then the agent answers without side effects.
        canUseTool: async () => ({ behavior: 'deny', message: 'Tool use is not enabled in tiledeck yet. Answer directly.' }),
      },
    });
    void this.pump();
  }

  send(text: string) {
    this.startedAt = Date.now();
    this.streaming = false;
    this.emit({ t: 'status', status: 'thinking' });
    this.inbox.push(text);
  }

  async interrupt() {
    await this.q.interrupt();
  }

  close() {
    this.inbox.end();
    this.q.close();
  }

  private async pump() {
    try {
      for await (const m of this.q) {
        if (m.type === 'stream_event') {
          // Skip subagent output; only the tile's own agent streams into the chat.
          if (m.parent_tool_use_id) continue;
          const ev = m.event;
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            if (!this.streaming) {
              this.streaming = true;
              this.emit({ t: 'status', status: 'streaming' });
            }
            this.emit({ t: 'delta', text: ev.delta.text });
          }
        } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
          for (const block of m.message.content) {
            if (block.type === 'tool_use') this.emit({ t: 'tool', name: block.name });
          }
        } else if (m.type === 'result') {
          if (m.subtype === 'success') {
            this.emit({ t: 'done', sessionId: m.session_id, ms: Date.now() - this.startedAt, costUsd: m.total_cost_usd });
          } else {
            this.emit({ t: 'error', message: `Claude stopped: ${m.subtype}` });
          }
          this.emit({ t: 'status', status: 'idle' });
        }
      }
    } catch (err) {
      this.emit({ t: 'error', message: err instanceof Error ? err.message : String(err) });
      this.emit({ t: 'status', status: 'error' });
    }
  }
}
