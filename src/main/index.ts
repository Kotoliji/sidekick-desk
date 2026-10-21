import { app, BrowserWindow, ipcMain, Menu, screen, shell, type Rectangle } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { Session } from './session';
import { ensureWorkspace, isInside, kickoff, managerPrompt } from './workspace';
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

function togglePanel() {
  if (panel.isVisible() && panel.isFocused()) return panel.hide();
  if (!panel.isVisible()) placePanel();
  reveal(panel);
}

function notify(title: string, text: string) {
  const note: PetNote = { id: ++noteId, title, text };
  if (!pet.isDestroyed()) pet.webContents.send(IPC.note, note);
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

function startSession(dir: string) {
  let answer = '';
  session = new Session(
    (e: TileEvent) => {
      if (!panel.isDestroyed()) panel.webContents.send(IPC.event, e);
      if (e.t === 'status' && !pet.isDestroyed()) pet.webContents.send(IPC.status, e.status);
      if (e.t === 'status' && e.status === 'thinking') answer = '';
      if (e.t === 'delta') answer += e.text;
      // Tell the user through the octopus when the answer lands out of sight.
      if (e.t === 'done' && answer && !(panel.isVisible() && panel.isFocused())) notify('Sidekick', summarize(answer));
      if (e.t === 'error') notify('Sidekick', `Something went wrong: ${e.message}`);
    },
    {
      cwd: dir,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: managerPrompt(dir) },
      tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
      canUseTool: writeOnlyInside(dir),
    },
  );
}

let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => togglePanel());
  app.on('before-quit', () => {
    quitting = true;
    session?.close();
  });

  app.whenReady().then(() => {
    const dir = ensureWorkspace();

    ipcMain.on(IPC.send, (_e, text: string) => typeof text === 'string' && text.trim() && session.send(text));
    ipcMain.on(IPC.interrupt, () => void session.interrupt());
    ipcMain.on(IPC.openFolder, () => void shell.openPath(dir));
    ipcMain.on(IPC.hidePanel, () => panel.hide());
    ipcMain.on(IPC.moveBy, (_e, dx: number, dy: number) => {
      const [x, y] = pet.getPosition();
      pet.setPosition(Math.round(x + dx), Math.round(y + dy));
    });
    ipcMain.on(IPC.interactive, (_e, on: boolean) => pet.setIgnoreMouseEvents(!on, { forward: true }));
    ipcMain.on(IPC.togglePanel, () => togglePanel());
    ipcMain.on(IPC.petMenu, () =>
      Menu.buildFromTemplate([
        { label: 'Open chat', click: () => (placePanel(), reveal(panel)) },
        { label: 'Open tasks folder', click: () => void shell.openPath(dir) },
        { type: 'separator' },
        { label: 'Quit Sidekick', click: () => app.quit() },
      ]).popup({ window: pet }),
    );

    createPanel();
    createPet();
    startSession(dir);
    // Greet once both windows can receive the stream.
    let loaded = 0;
    for (const w of [pet, panel]) w.webContents.once('did-finish-load', () => ++loaded === 2 && session.send(kickoff()));
  });
}
