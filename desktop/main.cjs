'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
} = require('electron');

const DEFAULT_APP_URL = 'http://127.0.0.1:4180/admin';
const CONNECT_PAGE = path.join(__dirname, 'connect.html');
const CONFIG_FILE = 'connection.json';
let mainWindow = null;
let configuredAppUrl = null;

function validAppUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function argumentUrl() {
  const raw = process.argv.find((argument) => argument.startsWith('--westo-url='));
  return validAppUrl(raw ? raw.slice('--westo-url='.length) : '');
}

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function readSavedUrl() {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return validAppUrl(data.url);
  } catch {
    return null;
  }
}

function saveUrl(url) {
  const safeUrl = validAppUrl(url);
  if (!safeUrl) return { ok: false, error: 'آدرس باید با http:// یا https:// شروع شود.' };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ url: safeUrl, updatedAt: new Date().toISOString() }, null, 2));
  configuredAppUrl = safeUrl;
  return { ok: true, url: safeUrl };
}

function currentAppUrl() {
  return configuredAppUrl || argumentUrl() || readSavedUrl() || validAppUrl(process.env.WESTO_APP_URL) || DEFAULT_APP_URL;
}

function allowedOrigin() {
  try { return new URL(currentAppUrl()).origin; } catch { return new URL(DEFAULT_APP_URL).origin; }
}

function isAllowedAppUrl(value) {
  try { return new URL(value).origin === allowedOrigin(); } catch { return false; }
}

function makeWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#081116',
    title: 'وستو · مرکز مدیریت',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAppUrl(url)) {
      mainWindow.loadURL(url);
    } else if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url)) event.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

async function loadConfiguredApp() {
  if (!mainWindow) return;
  configuredAppUrl = currentAppUrl();
  try {
    await mainWindow.loadURL(configuredAppUrl);
  } catch {
    await mainWindow.loadFile(CONNECT_PAGE);
  }
}

function loadConnectPage() {
  if (mainWindow) mainWindow.loadFile(CONNECT_PAGE);
}

function registerIpc() {
  ipcMain.handle('westo:connection-url', () => ({ url: configuredAppUrl || currentAppUrl(), defaultUrl: DEFAULT_APP_URL }));
  ipcMain.handle('westo:save-connection-url', async (_event, url) => {
    const result = saveUrl(url);
    if (result.ok) await loadConfiguredApp();
    return result;
  });
  ipcMain.handle('westo:open-app', () => { loadConfiguredApp(); return { ok: true }; });
  ipcMain.handle('westo:open-external', (_event, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpc();
  makeWindow();
  await loadConfiguredApp();
  app.on('activate', () => { if (!mainWindow) { makeWindow(); loadConfiguredApp(); } });
}).catch((error) => {
  dialog.showErrorBox('وستو', `اجرای اپ ممکن نشد: ${error.message}`);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
