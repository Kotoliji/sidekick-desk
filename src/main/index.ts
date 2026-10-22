import { app, BrowserWindow, ipcMain, Menu, screen, shell, type Rectangle } from 'electron';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { EVENTS_FILE, hooksInstalled, setHooks, tailEvents, writeGuardSettings, writeHookScript, type BridgeEvent } from './hooks';
import { Session } from './session';
import { Stoppers, type Alert, type ChatRef } from './stoppers';
import { recentTurns, sessionInfo, type SessionInfo } from './transcript';
import { codexSessionInfo, watchCodex } from './codex';
import { vscodeWindowId } from './vscode';
import { dayKey, ensureWorkspace, handoffPrompt, isInside, kickoff, loadConfig, managerPrompt, resumeKickoff, wrapUpPrompt } from './workspace';
import { IPC, type PetNote, type TileEvent } from '../shared/protocol';

// The pet window is mostly transparent: the octopus sits in its bottom-right
// corner and speech bubbles grow up and to the left of it.
const PET = { width: 300, height: 240, octo: { right: 12, bottom: 10, width: 100, height: 90 } };
const PANEL = { width: 380, height: 560 };
const GAP = 8;
// SIDEKICK_HIDDEN renders windows without showing them (automated checks).
const HIDDEN = !!process.env.SIDEKICK_HIDDEN;

const stateFile = () => join(app.getPath('userData'), 'pet.json');

function loadPetPosition(): { x: number; y: number } | undefined {
  try {
    const p = JSON.parse(readFileSync(stateFile(), 'utf8'));
    const area = screen.getDisplayNearestPoint(p).workArea;
    const onScreen = p.x > area.x - PET.width / 2 && p.x < area.x + area.width - PET.width / 2 && p.y > area.y - PET.height / 2 && p.y < area.y + area.height - PET.height / 2;
    return onScreen ? p : undefined;
  } catch {
    return undefined;
  }
}

function savePetPosition() {
  const [x, y] = pet.getPosition();
  try {
    writeFileSync(stateFile(), JSON.stringify({ x, y }));
  } catch {
    /* not fatal: the pet just starts in the corner next time */
  }
}

function load(win: BrowserWindow, view: 'pet' | 'panel') {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`);
  else void win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)), { query: { view } });
}

function reveal(win: BrowserWindow) {
  if (HIDDEN) console.log(`[hidden] show ${win.getTitle()}`);
  else {
    win.show();
    win.focus();
  }
}

const webPreferences = () => ({
  preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
  contextIsolation: true,
  sandbox: true,
});

let pet: BrowserWindow;
let panel: BrowserWindow;
let session: Session;
let noteId = 0;
/** What clicking a bubble does, for bubbles that are about a Claude Code chat. */
/** A chat's home: the VS Code window (by the folder it was opened on) and, when known, its tab. */
type ChatTarget = { type: 'chat'; agent: ChatRef['agent']; folder: string; session?: string };
type NoteAction = ChatTarget | { type: 'handoff'; cwd: string; transcript: string; tokens: number };
const noteActions = new Map<number, NoteAction>();

function createPet() {
  const area = screen.getPrimaryDisplay().workArea;
  const pos = loadPetPosition() ?? { x: area.x + area.width - PET.width - GAP, y: area.y + area.height - PET.height - GAP };
  pet = new BrowserWindow({
    ...pos,
    width: PET.width,
    height: PET.height,
    title: 'Sidekick pet',
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: webPreferences(),
  });
  // Clicks fall through to the desktop except over the octopus or a bubble (see setInteractive).
  pet.setIgnoreMouseEvents(true, { forward: true });
  load(pet, 'pet');
  pet.once('ready-to-show', () => (HIDDEN ? reveal(pet) : pet.showInactive()));
  let saveTimer: NodeJS.Timeout | undefined;
  pet.on('move', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePetPosition, 400);
  });
}

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL.width,
    height: PANEL.height,
    minWidth: 300,
    minHeight: 360,
    title: 'Sidekick',
    frame: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic', // Windows 11 blur behind the glass theme; ignored elsewhere
    webPreferences: webPreferences(),
  });
  load(panel, 'panel');
  panel.on('blur', () => (panelBlurAt = Date.now()));
  panel.on('close', (e) => {
    // Closing the panel only tucks it away; quitting goes through the pet's menu.
    if (!quitting) {
      e.preventDefault();
      panel.hide();
    }
  });
}

/** Open the panel beside the octopus: to its left if there is room, else to its right. */
function placePanel() {
  const p = pet.getBounds();
  const octo = { x: p.x + p.width - PET.octo.right - PET.octo.width, y: p.y + p.height - PET.octo.bottom - PET.octo.height };
  const area = screen.getDisplayMatching(p).workArea;
  const { width, height } = panel.getBounds();
  let x = octo.x - width - GAP;
  if (x < area.x) x = octo.x + PET.octo.width + GAP;
  const y = octo.y + PET.octo.height - height;
  panel.setBounds({
    x: Math.min(Math.max(x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(y, area.y), area.y + area.height - height),
    width,
    height,
  } satisfies Rectangle);
}

/** When the panel last lost focus: clicking the octopus takes focus a moment before the click arrives. */
let panelBlurAt = 0;

/** Open the chat, or close it if it is open and in use (or was until this very click). */
function togglePanel() {
  const inUse = panel.isFocused() || Date.now() - panelBlurAt < 600;
  if (panel.isVisible() && inUse) return panel.hide();
  if (!panel.isVisible()) placePanel();
  reveal(panel);
}

/** Chat activity the manager has not been told about yet; it rides along with the user's next message. */
const unseen: string[] = [];
const ACTIVITY_LABEL = { done: 'finished', waiting: 'waiting', long: 'long chat', conflict: 'file conflict' } as const;

function notify(kind: PetNote['kind'], title: string, text: string, action?: NoteAction) {
  const note: PetNote = { id: ++noteId, kind, title, text };
  if (action) noteActions.set(note.id, action);
  if (!pet.isDestroyed()) pet.webContents.send(IPC.note, note);
  // Bubbles vanish; the chat keeps a card of every one about the user's chats.
  if (kind !== 'sidekick') {
    toPanel({ t: 'activity', note });
    unseen.push(`- ${title} (${ACTIVITY_LABEL[kind]}): ${text}`);
    if (unseen.length > 12) unseen.shift();
  }
}

/** The user's message, prefixed with what happened in their chats since they last wrote. */
function withActivity(text: string) {
  if (!unseen.length) return text;
  const digest = unseen.splice(0).join('\n');
  return `[Chat activity since the user's last message, as shown to them in bubbles]\n${digest}\n\n[User]\n${text}`;
}

function toPanel(e: TileEvent) {
  if (!panel.isDestroyed()) panel.webContents.send(IPC.event, e);
}

/** Ask the manager to summarize a long chat and write the prompt for a fresh one. */
function handoff(a: Extract<NoteAction, { type: 'handoff' }>) {
  const project = basename(a.cwd);
  toPanel({ t: 'user', text: `Handoff for ${project} (~${Math.round(a.tokens / 1000)}k tokens): summary and a fresh-chat prompt` });
  session.send(handoffPrompt(project, a.cwd, a.tokens, recentTurns(a.transcript)));
  if (!panel.isVisible()) placePanel();
  reveal(panel);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Find a chat's window and tab, and a label that tells apart several chats in one project:
 * "PROJECT · tab title". The window is the folder the chat started in (VS Code's workspace).
 */
function locate(ref: ChatRef): { label: string; target: ChatTarget } {
  const info: SessionInfo = !ref.transcript ? { inVSCode: false } : ref.agent === 'codex' ? codexSessionInfo(ref.transcript) : sessionInfo(ref.transcript);
  const root = info.root ?? ref.cwd;
  const tab = [ref.agent === 'codex' && 'Codex', info.title && clip(info.title, 32)].filter(Boolean).join(': ');
  return {
    label: tab ? `${basename(root)} · ${tab}` : basename(root),
    target: { type: 'chat', agent: ref.agent, folder: root, session: info.inVSCode ? ref.session : undefined },
  };
}

function onAlert(a: Alert) {
  const { label, target } = locate(a);
  if (a.type === 'waiting-long') {
    const text = a.reason === 'permission' ? `Still waiting for your permission (${a.minutes} min)` : `Its answer has been waiting for you ${a.minutes} min`;
    notify('waiting', label, text, target);
  } else {
    const k = Math.round(a.tokens / 1000);
    notify('long', label, `This chat's conversation has grown by ~${k}k tokens. Click for a summary and a prompt to continue in a fresh chat.`, {
      type: 'handoff',
      cwd: a.cwd,
      transcript: a.transcript,
      tokens: a.tokens,
    });
  }
}

/**
 * Deep links the assistants' VS Code extensions handle: open (or bring forward) one chat as a tab.
 * `windowId` makes VS Code deliver the link to that window instead of the last active one.
 */
const TAB_URI = {
  claude: (id: string, win?: number) => `vscode://anthropic.claude-code/open?session=${encodeURIComponent(id)}${win ? `&windowId=${win}` : ''}`,
  codex: (id: string, win?: number) => `vscode://openai.chatgpt/local/${encodeURIComponent(id)}${win ? `?windowId=${win}` : ''}`,
};

/**
 * Take the user back to a chat. `code <folder>` focuses the window that has the folder open
 * (or opens one if it was closed); the extension link then shows that chat's tab in it.
 */
function openChat(t: ChatTarget) {
  const uri = t.session && TAB_URI[t.agent](t.session, vscodeWindowId(t.folder));
  if (HIDDEN) return console.log(`[hidden] open in VS Code ${t.folder}${uri ? ` then ${uri}` : ''}`);
  const child = spawn('code', [`"${t.folder}"`], { shell: true, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('exit', (code) => {
    if (code) return void shell.openPath(t.folder); // no `code` CLI: at least show the folder
    // Links go to the last active window, so wait for the right one to come forward.
    if (uri) setTimeout(() => void shell.openExternal(uri), 700);
  });
  child.unref();
}

function onBridgeEvent(e: BridgeEvent, dir: string, stoppers: Stoppers) {
  if (!e.cwd || resolve(e.cwd) === resolve(dir)) return; // Sidekick's own session
  if (e.event !== 'UserPromptSubmit') {
    const { label, target } = locate({ agent: e.agent ?? 'claude', cwd: e.cwd, session: e.session, transcript: e.transcript });
    if (e.event === 'Stop') notify('done', label, e.last ? summarize(e.last, 140) : 'Answer ready', target);
    // idle_prompt repeats a Stop a minute later; only real requests get a bubble.
    else if (e.event === 'Notification' && e.type !== 'idle_prompt') notify('waiting', label, e.message ?? 'Needs you', target);
    else if (e.event === 'Conflict') {
      const file = basename(e.file ?? '');
      const other = basename(e.other ?? '');
      // Claude is stopped before the edit; Codex is only seen after it.
      const text =
        e.agent === 'codex'
          ? `Edited ${file}, which the chat in ${other} edited minutes ago. Check they did not overwrite each other.`
          : `Stopped an edit of ${file}: the chat in ${other} edited it minutes ago.`;
      notify('conflict', label, text, target);
    }
  }
  stoppers.onEvent(e);
}

/** First lines of a Markdown answer as plain text, for a bubble. */
function summarize(md: string, max = 160) {
  const plain = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
    .replace(/[#>*_`~]|\[ \]|\[x\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length <= max ? plain : `${plain.slice(0, plain.lastIndexOf(' ', max))}…`;
}

/** The manager may read anywhere but writes only to its own folder. */
function writeOnlyInside(dir: string): CanUseTool {
  return async (tool, input) => {
    const path = typeof input.file_path === 'string' ? input.file_path : '';
    if ((tool === 'Edit' || tool === 'Write') && isInside(dir, path)) return { behavior: 'allow', updatedInput: input };
    if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') return { behavior: 'allow', updatedInput: input };
    return { behavior: 'deny', message: `Sidekick may only write inside ${dir}.` };
  };
}

/**
 * In the installed app the SDK's Claude Code binary is unpacked next to app.asar
 * (a process cannot be spawned from inside the archive), so point the SDK at it.
 */
function bundledClaude() {
  if (!app.isPackaged) return undefined;
  const modules = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai');
  const bin = join('claude-agent-sdk-win32-x64', 'claude.exe');
  // electron-builder may hoist the platform package or nest it under the SDK.
  return [join(modules, bin), join(modules, 'claude-agent-sdk', 'node_modules', '@anthropic-ai', bin)].find((p) => existsSync(p));
}

/** Start with Windows: on by default the first time the installed app runs, then the user's choice. */
function initAutostart() {
  if (!app.isPackaged || HIDDEN) return;
  const flag = join(app.getPath('userData'), 'autostart-initialized');
  try {
    readFileSync(flag);
  } catch {
    app.setLoginItemSettings({ openAtLogin: true });
    writeFileSync(flag, '1');
  }
}

// ── The manager's context lifecycle ──────────────────────────────────
// Memory lives in files (tasks.md, journal/), not in the conversation. When the
// context passes its limit, a new day starts, or the user asks, the manager writes
// its notes, the session is closed and a fresh one starts from those files.

type RolloverReason = 'context' | 'new-day' | 'manual';
let sessionDay = dayKey();
/** Set while the manager writes its journal before its context is reset. */
let rolling: RolloverReason | null = null;

function rollover(dir: string, reason: RolloverReason) {
  if (rolling || session.busy) return;
  rolling = reason;
  toPanel({ t: 'notice', text: reason === 'new-day' ? 'New day: saving yesterday to the journal…' : 'Saving notes to the journal and clearing the context…' });
  session.send(wrapUpPrompt(sessionDay));
}

function finishRollover(dir: string) {
  const reason = rolling;
  const old = session;
  startSession(dir);
  old.close();
  rolling = null;
  toPanel({ t: 'notice', text: 'Fresh context' });
  session.send(reason === 'new-day' ? kickoff(dir) : resumeKickoff(dir));
}

/** A refresh must actually free room: the context has to grow this far past its starting size. */
const MIN_GROWTH = 2_000;

function startSession(dir: string) {
  let answer = '';
  let turns = 0;
  let baseline = 0; // context size after the first turn (prompt, tools, files read at start)
  sessionDay = dayKey();
  const s: Session = new Session(
    (e: TileEvent) => {
      if (s !== session) return; // a session being retired
      toPanel(e);
      if (e.t === 'status' && !pet.isDestroyed()) pet.webContents.send(IPC.status, e.status);
      if (e.t === 'status' && e.status === 'thinking') answer = '';
      if (e.t === 'delta') answer += e.text;
      if (e.t === 'done') {
        // Let the session settle (idle) before swapping or rolling it.
        if (rolling) return void setTimeout(() => finishRollover(dir));
        // Tell the user through the octopus when the answer lands out of sight.
        if (answer && !(panel.isVisible() && panel.isFocused())) notify('sidekick', 'Sidekick', summarize(answer));
        if (++turns === 1) baseline = s.contextTokens;
        const limit = Math.max(loadConfig().managerContextLimit, baseline + MIN_GROWTH);
        if (turns > 1 && s.contextTokens > limit) setTimeout(() => rollover(dir, 'context'));
      }
      if (e.t === 'error') notify('sidekick', 'Sidekick', `Something went wrong: ${e.message}`);
    },
    {
      cwd: dir,
      // Its own environment: own prompt, own small tool set, none of the user's Claude Code
      // settings, plugins or CLAUDE.md files, and a lighter model.
      systemPrompt: managerPrompt(dir, EVENTS_FILE),
      model: loadConfig().managerModel,
      settingSources: [],
      tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
      canUseTool: writeOnlyInside(dir),
      // Sidekick's own turns must not come back through the hook as "a chat finished".
      env: { SIDEKICK_SELF: '1' },
      executable: bundledClaude(),
    },
  );
  session = s;
}

let quitting = false;

// Automated checks get their own profile, so they never collide with (or poke) a running Sidekick.
if (HIDDEN) app.setPath('userData', join(app.getPath('temp'), 'sidekick-hidden'));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => togglePanel());
  app.on('before-quit', () => {
    quitting = true;
    session?.close();
  });

  app.whenReady().then(() => {
    const dir = ensureWorkspace();
    initAutostart();

    ipcMain.on(IPC.send, (_e, text: string) => !rolling && typeof text === 'string' && text.trim() && session.send(withActivity(text)));
    ipcMain.on(IPC.interrupt, () => void session.interrupt());
    ipcMain.on(IPC.openFolder, () => void shell.openPath(dir));
    ipcMain.on(IPC.hidePanel, () => panel.hide());
    ipcMain.on(IPC.moveBy, (_e, dx: number, dy: number) => {
      const [x, y] = pet.getPosition();
      pet.setPosition(Math.round(x + dx), Math.round(y + dy));
    });
    ipcMain.on(IPC.interactive, (_e, on: boolean) => pet.setIgnoreMouseEvents(!on, { forward: true }));
    ipcMain.on(IPC.togglePanel, () => togglePanel());
    ipcMain.on(IPC.showPanel, () => {
      if (!panel.isVisible()) placePanel();
      reveal(panel);
    });
    ipcMain.on(IPC.openNote, (_e, id: number) => {
      const action = noteActions.get(id);
      if (action?.type === 'chat') openChat(action);
      else if (action?.type === 'handoff') handoff(action);
      else togglePanel();
    });
    ipcMain.on(IPC.petMenu, () =>
      Menu.buildFromTemplate([
        { label: 'Open chat', click: () => (placePanel(), reveal(panel)) },
        { label: 'Open tasks folder', click: () => void shell.openPath(dir) },
        { label: 'Wrap up now (journal + fresh context)', enabled: !rolling && !session.busy, click: () => rollover(dir, 'manual') },
        { type: 'separator' },
        {
          label: 'Connect Claude Code chats',
          type: 'checkbox',
          checked: hooksInstalled(),
          click: (item) => {
            setHooks(item.checked);
            notify('sidekick', 'Sidekick', item.checked ? 'Connected: I will tell you when a Claude Code chat finishes or needs you.' : 'Disconnected from Claude Code chats.');
          },
        },
        {
          label: app.isPackaged ? 'Start with Windows' : 'Start with Windows (installed app only)',
          type: 'checkbox',
          enabled: app.isPackaged,
          checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        { type: 'separator' },
        { label: 'Quit Sidekick', click: () => app.quit() },
      ]).popup({ window: pet }),
    );

    createPanel();
    createPet();
    startSession(dir);
    if (hooksInstalled()) writeHookScript(); // keep the script current after updates
    const stoppers = new Stoppers(loadConfig, onAlert);
    const syncGuard = () => {
      const c = loadConfig();
      writeGuardSettings({ mode: c.fileGuard, minutes: c.fileGuardMinutes });
    };
    syncGuard();
    tailEvents((e) => onBridgeEvent(e, dir, stoppers));
    // Codex chats join the same log, so everything downstream handles both assistants alike.
    watchCodex((e) => appendFileSync(EVENTS_FILE, `${JSON.stringify(e)}\n`));
    setInterval(() => (stoppers.tick(), syncGuard()), Number(process.env.SIDEKICK_TICK_MS ?? 30_000));
    // Greet once both windows can receive the stream.
    let loaded = 0;
    for (const w of [pet, panel]) w.webContents.once('did-finish-load', () => ++loaded === 2 && session.send(kickoff(dir)));
    // Past midnight, close the old day once the manager is idle.
    setInterval(() => dayKey() !== sessionDay && rollover(dir, 'new-day'), 60_000);
  });
}
