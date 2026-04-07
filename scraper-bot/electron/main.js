const { app, BrowserWindow, ipcMain, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const scraperBotRoot = path.join(__dirname, '..');

/** Bundled Chromium lives next to app.asar when packaged (see electron-builder extraResources). */
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
    process.resourcesPath,
    'playwright-browsers',
  );
}

const envFilePath = app.isPackaged
  ? path.join(app.getPath('userData'), '.env')
  : path.join(scraperBotRoot, '.env');
require('dotenv').config({ path: envFilePath });

function readPackageJson() {
  try {
    const raw = fs.readFileSync(path.join(scraperBotRoot, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { name: 'scraper-bot', version: '0.0.0', description: '' };
  }
}

const DEFAULT_MULESOFT_URL = process.env.MULESOFT_URL || 'https://<your-cloudhub-app>.cloudhub.io/sync';

let mainWindow;
let activeChild = null;
let nativeThemeHookInstalled = false;

function childEnv() {
  const env = {
    ...process.env,
    MULESOFT_URL: process.env.MULESOFT_URL || DEFAULT_MULESOFT_URL,
  };
  if (app.isPackaged) {
    env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'playwright-browsers');
  }
  return env;
}

function sendLog(line) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('proc-log', line);
  }
}

function pipeStream(stream, isErr) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const parts = buf.split('\n');
    buf = parts.pop() || '';
    for (const line of parts) {
      sendLog(isErr ? `[stderr] ${line}` : line);
    }
  });
  stream.on('end', () => {
    if (buf.trim()) {
      sendLog(isErr ? `[stderr] ${buf}` : buf);
    }
  });
}

function killActiveChild() {
  if (!activeChild) return;
  try {
    activeChild.kill('SIGTERM');
  } catch (_) {}
  activeChild = null;
}

function spawnNodeScript(scriptFile) {
  killActiveChild();
  const scriptPath = path.join(scraperBotRoot, scriptFile);
  const child = spawn(process.execPath, [scriptPath], {
    cwd: scraperBotRoot,
    env: {
      ...childEnv(),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  activeChild = child;
  pipeStream(child.stdout, false);
  pipeStream(child.stderr, true);
  child.on('close', (code, signal) => {
    if (activeChild === child) activeChild = null;
    if (code === 0 && scriptFile === 'scraper.js') {
      if (process.platform === 'darwin' && app.dock) {
        app.dock.bounce('informational');
      }
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      if (win && !win.isDestroyed() && !win.isFocused()) {
        if (process.platform === 'win32' || process.platform === 'linux') {
          win.flashFrame(true);
          setTimeout(() => {
            if (!win.isDestroyed()) win.flashFrame(false);
          }, 900);
        }
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('proc-exit', { code, signal, script: scriptFile });
    }
  });
  child.on('error', (err) => {
    sendLog(`[error] Failed to start: ${err.message}`);
    if (activeChild === child) activeChild = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('proc-exit', { code: -1, signal: null, script: scriptFile });
    }
  });
  return child;
}

function windowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#0a0c10' : '#eef1f6';
}

function sendShortcut(action) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send('shortcut', action);
  }
}

function buildApplicationMenu() {
  const displayName = 'RTLM Monday Sync';

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.getName(),
            submenu: [
              {
                label: `About ${displayName}`,
                click: () => sendShortcut('open-about'),
              },
              { type: 'separator' },
              { role: 'services', submenu: [] },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : [
          {
            label: 'File',
            submenu: [
              {
                label: `About ${displayName}`,
                click: () => sendShortcut('open-about'),
              },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]),
    {
      label: 'Actions',
      submenu: [
        {
          label: 'Run sync',
          accelerator: 'CommandOrControl+Enter',
          click: () => sendShortcut('run-sync'),
        },
        {
          label: 'Stop',
          accelerator: 'CommandOrControl+.',
          click: () => sendShortcut('stop'),
        },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        { label: 'Run sync', click: () => sendShortcut('run-sync') },
        { label: 'Stop', click: () => sendShortcut('stop') },
      ]),
    );
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 780,
    minWidth: 520,
    minHeight: 560,
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (!nativeThemeHookInstalled) {
    nativeThemeHookInstalled = true;
    nativeTheme.on('updated', () => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.setBackgroundColor(windowBackgroundColor());
      });
    });
  }
}

app.whenReady().then(() => {
  try {
    app.setName('RTLM Monday Sync');
  } catch (_) {}
  createWindow();
  buildApplicationMenu();
});

app.on('window-all-closed', () => {
  killActiveChild();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => killActiveChild());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-mulesoft-url', () => process.env.MULESOFT_URL || DEFAULT_MULESOFT_URL);

ipcMain.handle('get-app-meta', () => {
  const pkg = readPackageJson();
  return {
    name: 'RTLM Monday Sync',
    version: pkg.version || '0.0.0',
    description: pkg.description || '',
  };
});

ipcMain.handle('start-auth', () => {
  spawnNodeScript('auth.js');
  return { ok: true };
});

ipcMain.handle('start-scraper', () => {
  spawnNodeScript('scraper.js');
  return { ok: true };
});

ipcMain.on('auth-enter', () => {
  if (activeChild && activeChild.stdin && !activeChild.stdin.destroyed) {
    activeChild.stdin.write('\n');
  }
});

ipcMain.handle('stop-process', () => {
  killActiveChild();
  return { ok: true };
});
