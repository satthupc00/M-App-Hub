const { app, BrowserWindow, ipcMain, shell, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const HEADER_H = 58;
const BG = '#1F2126';
let win = null;

/* ---- nhật ký khởi động: %APPDATA%\M AppHub\startup.log ---- */
const logFile = () => path.join(app.getPath('userData'), 'startup.log');
function log(...a) { try { fs.appendFileSync(logFile(), new Date().toISOString() + ' ' + a.map(x => (x && x.stack) || String(x)).join(' ') + '\n'); } catch {} }
process.on('uncaughtException', e => { log('uncaughtException', e); try { dialog.showErrorBox('M AppHub', 'Lỗi khi khởi động:\n' + (e && e.stack || e) + '\n\nNhật ký: ' + logFile()); } catch {} });
process.on('unhandledRejection', e => log('unhandledRejection', e));

/* ---- chỉ cho chạy 1 bản; mở lần 2 thì đưa cửa sổ cũ lên ---- */
if (!app.requestSingleInstanceLock()) { app.quit(); }
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

/* ---- nhớ vị trí cửa sổ, nhưng không bao giờ để cửa sổ nằm ngoài màn hình ---- */
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() { try { return JSON.parse(fs.readFileSync(boundsFile(), 'utf8')); } catch { return null; } }
function saveBounds() { if (!win || win.isDestroyed() || win.isMinimized()) return; try { fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized() })); } catch {} }
function safeBounds(b) {
  const out = { width: 1100, height: 700 };
  if (!b) return out;
  out.width = Math.max(720, Math.min(+b.width || 1100, 4000)); out.height = Math.max(480, Math.min(+b.height || 700, 3000));
  if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
    const a = screen.getDisplayMatching({ x: b.x, y: b.y, width: out.width, height: out.height }).workArea;
    const visible = b.x < a.x + a.width - 120 && b.x + out.width > a.x + 120 && b.y >= a.y - 8 && b.y < a.y + a.height - 80;
    if (visible) { out.x = b.x; out.y = b.y; } else log('bỏ vị trí cửa sổ ngoài màn hình', JSON.stringify(b));
  }
  return out;
}

function createWindow() {
  const b = loadBounds(); const sb = safeBounds(b);
  win = new BrowserWindow({
    title: 'M AppHub', backgroundColor: BG, ...sb, minWidth: 720, minHeight: 480,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#FFFFFF', height: HEADER_H },
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenu(null);
  if (b?.max) win.maximize();
  win.once('ready-to-show', () => { win.show(); log('hiện cửa sổ'); });
  // phòng khi ready-to-show không tới: vẫn hiện sau 3 giây
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); log('hiện cửa sổ (dự phòng)'); } }, 3000);
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('did-fail-load', code, desc, url));
  win.webContents.on('render-process-gone', (_e, d) => log('render-process-gone', JSON.stringify(d)));
  win.on('unresponsive', () => log('unresponsive'));
  win.loadFile(path.join(__dirname, 'docs', 'index.html')).catch(e => log('loadFile', e));
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, saveBounds);
  win.on('close', saveBounds);
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

/* ---- auto update: GitHub Releases của satthupc00/M-App-Hub (nạp muộn, lỗi không làm app chết) ---- */
let autoUpdater = null;
function getUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (...a) => log('upd', ...a), warn: (...a) => log('upd', ...a), error: (...a) => log('upd', ...a), debug() {} };
    const send = (state, extra = {}) => { if (win && !win.isDestroyed()) win.webContents.send('upd:status', { state, ...extra }); };
    autoUpdater.on('update-available', i => send('available', { version: i.version }));
    autoUpdater.on('update-not-available', () => send('none'));
    autoUpdater.on('update-downloaded', i => send('downloaded', { version: i.version }));
    autoUpdater.on('error', e => send('error', { message: String(e?.message || e).split('\n')[0] }));
  } catch (e) { log('electron-updater', e); }
  return autoUpdater;
}
ipcMain.handle('upd:check', async () => {
  if (!app.isPackaged) return { state: 'none' };
  const u = getUpdater(); if (!u) return { state: 'error', message: 'Không nạp được bộ cập nhật' };
  try {
    const r = await u.checkForUpdates();
    const info = r?.updateInfo;
    if (!info || !r?.isUpdateAvailable) return { state: 'none' };
    return { state: 'available', version: info.version };
  } catch (e) { return { state: 'error', message: String(e?.message || e).split('\n')[0] }; }
});
ipcMain.on('upd:install', () => { const u = getUpdater(); if (u) setImmediate(() => u.quitAndInstall(false, true)); });
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:open-data', () => shell.openPath(app.getPath('userData')));

app.whenReady().then(() => {
  log('khởi động v' + app.getVersion(), 'packaged=' + app.isPackaged);
  try { createWindow(); } catch (e) { log('createWindow', e); dialog.showErrorBox('M AppHub', 'Không mở được cửa sổ:\n' + (e && e.stack || e)); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
