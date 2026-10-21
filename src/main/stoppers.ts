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

export type Alert =
  | { type: 'waiting-long'; cwd: string; minutes: number; reason: 'answer' | 'permission' }
  | { type: 'long-chat'; cwd: string; transcript: string; tokens: number };

interface Chat {
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
    const chat = this.chats.get(e.session) ?? { cwd: e.cwd, reason: 'answer', reminded: false, warnedAt: 0 };
    chat.cwd = e.cwd;
    if (e.transcript) chat.transcript = e.transcript;
    this.chats.set(e.session, chat);

    if (e.event === 'UserPromptSubmit') {
      chat.waitingSince = undefined; // the user is back in this chat
    } else if (e.event === 'Stop') {
      this.wait(chat, e.ts, 'answer');
      this.checkLength(chat);
    } else if (e.event === 'Notification' && e.type === 'permission_prompt') {
      this.wait(chat, e.ts, 'permission');
    }
  }

  /** Call periodically; raises at most one reminder per wait. */
  tick(now = Date.now()) {
    const after = this.config().remindAfterMinutes * 60_000;
    for (const chat of this.chats.values()) {
      if (chat.waitingSince === undefined || chat.reminded || now - chat.waitingSince < after) continue;
      chat.reminded = true;
      this.alert({ type: 'waiting-long', cwd: chat.cwd, minutes: Math.max(1, Math.round((now - chat.waitingSince) / 60_000)), reason: chat.reason });
    }
  }

  private wait(chat: Chat, since: number, reason: Chat['reason']) {
    chat.waitingSince = since;
    chat.reason = reason;
    chat.reminded = false;
  }

  private checkLength(chat: Chat) {
    if (!chat.transcript) return;
    const tokens = conversationTokens(chat.transcript);
    const limit = this.config().longChatTokens;
    if (!tokens || tokens < limit) return;
    // Warn when crossing the limit, then again after every further half-limit of growth.
    if (chat.warnedAt && tokens < chat.warnedAt + limit / 2) return;
    chat.warnedAt = tokens;
    this.alert({ type: 'long-chat', cwd: chat.cwd, transcript: chat.transcript, tokens });
  }
}
