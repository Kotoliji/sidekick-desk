/**
 * Stoppers: gentle nudges about the user's Claude Code and Codex chats, built from their events.
 * - a chat has waited for the user too long (after an answer or a permission request);
 * - a chat has sat idle so long that it may be finished: ask the user whether it still matters;
 * - a chat's conversation has grown past a limit, so a fresh chat with a summary is due.
 */
import type { BridgeEvent } from './hooks';
import { conversationTokens } from './transcript';

export interface StopperConfig {
  remindAfterMinutes: number;
  /** Idle this long, ask whether the chat is still in use or done. */
  askAfterMinutes: number;
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
  | ({ type: 'idle-ask'; minutes: number } & ChatRef)
  | ({ type: 'long-chat'; tokens: number } & ChatRef & { transcript: string });

interface Chat {
  agent: ChatRef['agent'];
  cwd: string;
  transcript?: string;
  waitingSince?: number;
  reason: 'answer' | 'permission';
  reminded: boolean;
  asked: boolean;
  /** The user said they are done with it: no nudges until it is active again. */
  done: boolean;
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
    const chat: Chat = this.chats.get(e.session) ?? {
      agent: e.agent ?? 'claude',
      cwd: e.cwd,
      reason: 'answer',
      reminded: false,
      asked: false,
      done: false,
      warnedAt: 0,
    };
    chat.cwd = e.cwd;
    if (e.transcript) chat.transcript = e.transcript;
    this.chats.set(e.session, chat);
    if (e.event !== 'Conflict') chat.done = false; // any activity brings a finished chat back

    if (e.event === 'UserPromptSubmit') {
      chat.waitingSince = undefined; // the user is back in this chat
    } else if (e.event === 'Stop') {
      this.wait(chat, e.ts, 'answer');
      this.checkLength(chat, e.session, e.growth);
    } else if (e.event === 'Notification' && e.type === 'permission_prompt') {
      this.wait(chat, e.ts, 'permission');
    }
  }

  /** The user's answer to "still using this chat, or done?". */
  answer(session: string, choice: 'keep' | 'done', now = Date.now()) {
    const chat = this.chats.get(session);
    if (!chat) return;
    if (choice === 'done') {
      chat.done = true;
      chat.waitingSince = undefined;
    } else {
      // Still in use: start the idle clock over; the short reminder has already been given.
      this.wait(chat, now, chat.reason);
      chat.reminded = true;
    }
  }

  /** Call periodically; raises at most one reminder and one question per wait. */
  tick(now = Date.now()) {
    const { remindAfterMinutes, askAfterMinutes } = this.config();
    for (const [session, chat] of this.chats) {
      if (chat.waitingSince === undefined || chat.done) continue;
      const idle = now - chat.waitingSince;
      const minutes = Math.max(1, Math.round(idle / 60_000));
      const ref = { agent: chat.agent, cwd: chat.cwd, session, transcript: chat.transcript };
      if (!chat.asked && idle >= askAfterMinutes * 60_000) {
        // The question supersedes a reminder that has not gone out yet.
        chat.asked = chat.reminded = true;
        this.alert({ type: 'idle-ask', minutes, ...ref });
      } else if (!chat.reminded && idle >= remindAfterMinutes * 60_000) {
        chat.reminded = true;
        this.alert({ type: 'waiting-long', minutes, reason: chat.reason, ...ref });
      }
    }
  }

  private wait(chat: Chat, since: number, reason: Chat['reason']) {
    chat.waitingSince = since;
    chat.reason = reason;
    chat.reminded = false;
    chat.asked = false;
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
