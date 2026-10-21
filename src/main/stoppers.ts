/**
 * Stoppers: gentle nudges about the user's Claude Code chats, built from hook events.
 * - a chat has waited for the user too long (after an answer or a permission request);
 * - a chat's conversation has grown past a limit, so a fresh chat with a summary is due.
 */
import type { BridgeEvent } from './hooks';
import { conversationTokens } from './transcript';

export interface StopperConfig {
  remindAfterMinutes: number;
  /** Warn when a chat's conversation (beyond its fixed starting size) has grown this much. */
  longChatTokens: number;
}

/** Which chat an alert is about, so the user can be taken back to it. */
export interface ChatRef {
  agent: 'claude' | 'codex';
  cwd: string;
  session: string;
  transcript?: string;
}

export type Alert =
  | ({ type: 'waiting-long'; minutes: number; reason: 'answer' | 'permission' } & ChatRef)
  | ({ type: 'long-chat'; tokens: number } & ChatRef & { transcript: string });

interface Chat {
  agent: ChatRef['agent'];
  cwd: string;
  transcript?: string;
  waitingSince?: number;
  reason: 'answer' | 'permission';
  reminded: boolean;
  /** Context size at the last long-chat warning (0 = never warned). */
  warnedAt: number;
}

export class Stoppers {
  private chats = new Map<string, Chat>();

  constructor(
    private config: () => StopperConfig,
    private alert: (a: Alert) => void,
  ) {}

  onEvent(e: BridgeEvent) {
    const chat: Chat = this.chats.get(e.session) ?? { agent: e.agent ?? 'claude', cwd: e.cwd, reason: 'answer', reminded: false, warnedAt: 0 };
    chat.cwd = e.cwd;
    if (e.transcript) chat.transcript = e.transcript;
    this.chats.set(e.session, chat);

    if (e.event === 'UserPromptSubmit') {
      chat.waitingSince = undefined; // the user is back in this chat
    } else if (e.event === 'Stop') {
      this.wait(chat, e.ts, 'answer');
      this.checkLength(chat, e.session, e.growth);
    } else if (e.event === 'Notification' && e.type === 'permission_prompt') {
      this.wait(chat, e.ts, 'permission');
    }
  }

  /** Call periodically; raises at most one reminder per wait. */
  tick(now = Date.now()) {
    const after = this.config().remindAfterMinutes * 60_000;
    for (const [session, chat] of this.chats) {
      if (chat.waitingSince === undefined || chat.reminded || now - chat.waitingSince < after) continue;
      chat.reminded = true;
      const minutes = Math.max(1, Math.round((now - chat.waitingSince) / 60_000));
      this.alert({ type: 'waiting-long', minutes, reason: chat.reason, agent: chat.agent, cwd: chat.cwd, session, transcript: chat.transcript });
    }
  }

  private wait(chat: Chat, since: number, reason: Chat['reason']) {
    chat.waitingSince = since;
    chat.reason = reason;
    chat.reminded = false;
  }

  private checkLength(chat: Chat, session: string, growth?: number) {
    if (!chat.transcript) return;
    const tokens = growth ?? conversationTokens(chat.transcript);
    const limit = this.config().longChatTokens;
    if (!tokens || tokens < limit) return;
    // Warn when crossing the limit, then again after every further half-limit of growth.
    if (chat.warnedAt && tokens < chat.warnedAt + limit / 2) return;
    chat.warnedAt = tokens;
    this.alert({ type: 'long-chat', tokens, agent: chat.agent, cwd: chat.cwd, session, transcript: chat.transcript });
  }
}
