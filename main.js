const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const HEADER_H = 58;
const BG = '#1F2126';
let win = null;
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

function loadBounds() { try { return JSON.parse(fs.readFileSync(boundsFile(), 'utf8')); } catch { return null; } }
function saveBounds() { if (!win || win.isMinimized()) return; try { fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized() })); } catch {} }

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    title: 'M AppHub', backgroundColor: BG,
    width: b?.width || 1100, height: b?.height || 700, x: b?.x, y: b?.y, minWidth: 720, minHeight: 480,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#FFFFFF', height: HEADER_H },
    autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenu(null);
  if (b?.max) win.maximize();
  win.loadFile(path.join(__dirname, 'docs', 'index.html'));
  win.once('ready-to-show', () => win.show());
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, saveBounds);
  win.on('close', saveBounds);
  win.on('closed', () => { win = null; });
  // Mọi link ngoài mở bằng trình duyệt, không mở trong app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

/* ---- auto update: GitHub Releases của satthupc00/M-App-Hub ---- */
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
const send = (state, extra = {}) => { if (win && !win.isDestroyed()) win.webContents.send('upd:status', { state, ...extra }); };
autoUpdater.on('update-available', i => send('available', { version: i.version }));
autoUpdater.on('update-not-available', () => send('none'));
autoUpdater.on('update-downloaded', i => send('downloaded', { version: i.version }));
autoUpdater.on('error', e => send('error', { message: String(e?.message || e).split('\n')[0] }));

ipcMain.handle('upd:check', async () => {
  if (!app.isPackaged) return { state: 'none' };
  try {
    const r = await autoUpdater.checkForUpdates();
    const info = r?.updateInfo;
    if (!info || !r?.isUpdateAvailable) return { state: 'none' };
    return { state: 'available', version: info.version };
  } catch (e) { return { state: 'error', message: String(e?.message || e).split('\n')[0] }; }
});
ipcMain.on('upd:install', () => { setImmediate(() => autoUpdater.quitAndInstall(false, true)); });
ipcMain.handle('app:version', () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
