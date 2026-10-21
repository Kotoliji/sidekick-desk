import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BridgeEvent } from './hooks';
import { Stoppers, type Alert } from './stoppers';

const MIN = 60_000;

function setup() {
  const alerts: Alert[] = [];
  const stoppers = new Stoppers(() => ({ remindAfterMinutes: 10, longChatTokens: 100_000 }), (a) => alerts.push(a));
  const ev = (event: BridgeEvent['event'], session: string, ts: number, extra: Partial<BridgeEvent> = {}) =>
    stoppers.onEvent({ ts, event, cwd: `D:/p/${session}`, session, ...extra });
  return { alerts, stoppers, ev };
}

test('reminds once when an answer waits too long', () => {
  const { alerts, stoppers, ev } = setup();
  ev('Stop', 'a', 0);
  stoppers.tick(9 * MIN);
  assert.equal(alerts.length, 0);
  stoppers.tick(11 * MIN);
  stoppers.tick(30 * MIN);
  assert.deepEqual(alerts, [{ type: 'waiting-long', minutes: 11, reason: 'answer', agent: 'claude', cwd: 'D:/p/a', session: 'a', transcript: undefined }]);
});

test('the user writing in the chat cancels the reminder', () => {
  const { alerts, stoppers, ev } = setup();
  ev('Stop', 'a', 0);
  ev('UserPromptSubmit', 'a', 5 * MIN);
  stoppers.tick(60 * MIN);
  assert.equal(alerts.length, 0);
});

test('a pending permission is reminded; idle_prompt alone is not', () => {
  const { alerts, stoppers, ev } = setup();
  ev('Notification', 'c', 0, { type: 'permission_prompt' });
  ev('Notification', 'd', 0, { type: 'idle_prompt' });
  stoppers.tick(11 * MIN);
  assert.deepEqual(
    alerts.map((a) => a.type === 'waiting-long' && `${a.cwd}:${a.reason}`),
    ['D:/p/c:permission'],
  );
});
